import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { SqliteCheckpoint } from './checkpoint.js';
import { attachScore, measured, providers } from './providers.js';
import { Score, type Round, type Session } from './types.js';
import { saveSession } from './db.js';
import { writeReports } from './reports.js';
import { CodexBridge } from './codex.js';
import { collectReferences } from './references.js';
import { firstDraftPrompt } from './draft-prompt.js';
import type { Provider } from './types.js';

const State = Annotation.Root({ session: Annotation<Session>, proposal: Annotation<string>, criticism: Annotation<string>, rebuttal: Annotation<string>, score: Annotation<Round['score']>, unresolved: Annotation<string[]>, route: Annotation<Round['route']> });
const checkpointer = new SqliteCheckpoint(resolve('data/graph.sqlite'));
export const deleteGraphThread = (id:string) => checkpointer.deleteThread(id);
const json = (text: string) => { const start=text.indexOf('{'), end=text.lastIndexOf('}'); if(start<0||end<start) throw new Error('Judge did not return JSON'); return JSON.parse(text.slice(start,end+1)); };
export function graph(onEvent: (sessionId:string,event:unknown)=>void, signal?: AbortSignal, bridge?: CodexBridge) {
  const {gemini,nemotron,judge} = providers();
  const codex=(session:Session):Provider=>({name:'codex',model:'Codex App Server',complete:(prompt,signal,onChunk)=>
    process.env.MOCK_PROVIDERS==='true'?gemini.complete(prompt,signal,onChunk):bridge!.propose(prompt,session.projectPath,signal,onChunk)});
  const call = async (provider: Provider,prompt:string,s:Session,round:number,phase:string) => {
    const messageId=randomUUID();
    onEvent(s.id,{type:'message-start',messageId,role:phase==='judge'?'judge':provider.name,round,phase});
    const value=await measured(provider,prompt,s.id,round,signal,phase==='judge'?undefined:text=>onEvent(s.id,{type:'message-delta',messageId,text}));
    if(phase!=='judge')onEvent(s.id,{type:'message',messageId,role:provider.name,round,phase,text:value.result.text});
    return value;
  };
  return new StateGraph(State)
    .addNode('proposalNode',async state=>{
      const first=state.session.rounds.length===0;
      const references=first&&process.env.MOCK_PROVIDERS!=='true'?await collectReferences(state.session.topic,signal):'';
      const prompt=first
        ?firstDraftPrompt(state.session.topic,state.session.projectPath,references)
        :`개발 주제: ${state.session.topic}\n이전 라운드: ${JSON.stringify(state.session.rounds.at(-1))}\n남은 쟁점: ${state.unresolved.join('; ')||'없음'}\nCodex의 첫 초안을 출발점으로 반박과 재반론을 반영해 개선안을 제안하라.`;
      return {proposal:(await call(first?codex(state.session):gemini,prompt,state.session,state.session.rounds.length+1,'proposal')).result.text};
    })
    .addNode('criticismNode',async state=>({criticism:(await call(nemotron,`원래 질문: ${state.session.topic}\n아래 설계가 원래 질문에 직접 답하는지 먼저 판단하고, 벗어났으면 그 점을 첫 반박으로 제시하라. 이어서 기술적 결함, 보안, 성능, 반례를 구체적으로 반박하라. 초안의 "확인한 사실"과 "추정"을 구분해 점검하고, 근거 없이 단정한 외부 오픈소스 주장과 "추정"으로 표시된 주장을 우선 반박하라. 새 논거가 없으면 반복이라고 밝혀라.\n${state.proposal}`,state.session,state.session.rounds.length+1,'criticism')).result.text}))
    .addNode('rebuttalNode',async state=>({rebuttal:(await call(gemini,`원래 질문: ${state.session.topic}\n제안: ${state.proposal}\n반박: ${state.criticism}\n수용 여부와 수정된 설계를 명확히 답하라. 설계는 원래 질문에 직접 답해야 하며, 확인하지 못한 외부 내용은 계속 "추정"으로 표시하라.`,state.session,state.session.rounds.length+1,'rebuttal')).result.text}))
    .addNode('judge',async state=>{
      const n=state.session.rounds.length+1;
      const response=await call(judge,`독립 평가자 역할. 같은 Gemini 모델을 사용하므로 독립성에 한계가 있다. 실제 검증이 없으면 verification=unverified. evidenceLevel은 none,claim,document,test 중 하나만 사용하고 인용 문서나 실제 테스트 출력이 없으면 claim을 사용하라. 아래 반박을 6개 기준 0~5점으로 평가하라. JSON만 반환: technicalAccuracy,logicalValidity,counterexampleQuality,evidenceQuality,novelty,practicalValue,rationale,evidenceLevel(none|claim|document|test),verification(unverified|documented|tested),valid,accepted,changedDesign,newCounterexamples(새 반례 개수인 정수),errorsFound(발견한 오류 개수인 정수),unsupported(근거 없는 주장 존재 여부인 boolean),duplicate,geminiAccepted,finalIncluded,unresolved(string[]),route(CONTINUE|REVISE|ACCEPT|STOP). 최소 3라운드, 최대 5라운드를 고려하라. 제안이 원래 질문에 직접 답하지 않으면 practicalValue를 낮추고 unresolved에 그 사실을 적어라. 출처 없이 단정한 외부 오픈소스 주장은 unsupported=true로 처리하라.\n원래 질문: ${state.session.topic}\n제안:${state.proposal}\n반박:${state.criticism}\n재반론:${state.rebuttal}`,state.session,n,'judge');
      const parsed=json(response.result.text); const score=Score.parse(parsed); const unresolved=Array.isArray(parsed.unresolved)?parsed.unresolved.filter((v:unknown)=>typeof v==='string'):[];
      const route: Round['route']= n>=5?'STOP': n>=3 && (parsed.route==='ACCEPT'||score.duplicate||unresolved.length===0)?'ACCEPT':parsed.route==='REVISE'?'REVISE':'CONTINUE';
      const metric=(await import('./db.js')).metrics(state.session.id).filter(m=>m.provider==='nemotron'&&m.round===n).at(-1); if(metric) attachScore(metric,score);
      const session={...state.session,rounds:[...state.session.rounds,{index:n,proposal:state.proposal,criticism:state.criticism,rebuttal:state.rebuttal,score,unresolved,route}]}; saveSession(session); onEvent(session.id,{type:'round',round:n,route,score,unresolved});
      return {session,score,unresolved,route};
    })
    .addNode('final',async state=>{
      const session={...state.session};
      session.decision=(await call(codex(session),`원래 질문: ${session.topic}\n다음 토론에서 검증 상태와 미해결 위험을 구분하며 ${session.projectPath?'저장소에 근거한':'일반적인'} 최종 기술 결정을 작성하라. 원래 질문에 직접 답하고, 토론에서 "추정"으로 남은 외부 내용은 최종에서도 추정으로 표시하라:\n${JSON.stringify(session.rounds)}`,session,session.rounds.length,'decision')).result.text;
      session.plan=(await call(codex(session),`다음 결정에 대한 ${session.projectPath?'파일·테스트·롤백이 포함된 실행계획':'검증 방법과 적용 단계를 포함한 제안'}을 작성하라. 사용자 승인 전 실행하지 않는다:\n${session.decision}`,session,session.rounds.length,'plan')).result.text;
      session.status=state.route==='STOP'?'stopped':session.projectPath?'awaiting_approval':'completed'; saveSession(session); writeReports(session); onEvent(session.id,{type:'ready',session}); return {session};
    })
    .addEdge(START,'proposalNode').addEdge('proposalNode','criticismNode').addEdge('criticismNode','rebuttalNode').addEdge('rebuttalNode','judge')
    .addConditionalEdges('judge',state=>state.route==='CONTINUE'||state.route==='REVISE'?'proposalNode':'final')
    .addEdge('final',END).compile({checkpointer});
}
