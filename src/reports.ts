import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { metrics, sessions } from './db.js';
import type { CallMetric, Session } from './types.js';

const mean = (xs: number[]) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const percentile = (xs: number[], p: number) => xs.length >= 20 ? [...xs].sort((a,b)=>a-b)[Math.ceil(p*xs.length)-1] : null;
const ratio = (n: number, d: number) => d ? n/d : null;
const fmt = (n: number|null) => n === null ? 'N/A' : n.toFixed(2);
const dir = (part: string) => { const path = resolve('reports',part); mkdirSync(path,{recursive:true}); return path; };

export function performance(sessionId?: string) {
  const all = metrics(sessionId).filter(m=>m.provider==='nemotron');
  const success = all.filter(m=>!m.error);
  const scored = success.filter(m=>m.score);
  const latencies = success.map(m=>m.latencyMs);
  const tokenInput = success.some(m=>m.usage.input !== null) ? success.reduce((n,m)=>n+(m.usage.input||0),0) : null;
  const tokenOutput = success.some(m=>m.usage.output !== null) ? success.reduce((n,m)=>n+(m.usage.output||0),0) : null;
  const quality = scored.map(m=>Object.values(m.score!).filter(v=>typeof v==='number').slice(0,6).reduce((a,b)=>a+b,0)/6);
  return { calls:all.length, success:success.length, errors:all.filter(m=>m.error).length, rateLimits:all.filter(m=>m.rateLimited).length, timeouts:all.filter(m=>m.timedOut).length,
    meanLatencyMs:mean(latencies), meanTtftMs:mean(success.map(m=>m.ttftMs).filter((n):n is number=>n!==null)), p50Ms:percentile(latencies,.5), p95Ms:percentile(latencies,.95), p99Ms:percentile(latencies,.99),
    inputTokens:tokenInput, outputTokens:tokenOutput, tokensPerSecond:tokenOutput===null ? null : ratio(tokenOutput,success.reduce((n,m)=>n+m.latencyMs,0)/1000),
    meanQuality:mean(quality), validRatio:ratio(scored.filter(m=>m.score!.valid).length,scored.length), acceptedRatio:ratio(scored.filter(m=>m.score!.accepted).length,scored.length),
    changedRatio:ratio(scored.filter(m=>m.score!.changedDesign).length,scored.length), unsupportedRatio:ratio(scored.filter(m=>m.score!.unsupported).length,scored.length),
    duplicateRatio:ratio(scored.filter(m=>m.score!.duplicate).length,scored.length), counterexamples:scored.reduce((n,m)=>n+m.score!.newCounterexamples,0), errorsFound:scored.reduce((n,m)=>n+m.score!.errorsFound,0),
    samples:scored.map(m=>({ criticismId:m.criticismId, score:m.score, latencyMs:m.latencyMs })), raw:all };
}
export function agentUsage() {
  return ['codex','gemini','nemotron'].map(provider=>{
    const calls=metrics().filter(m=>m.provider===provider&&!m.error);
    const sum=(kind:'input'|'output')=>calls.some(m=>m.usage[kind]!==null)?calls.reduce((total,m)=>total+(m.usage[kind]||0),0):null;
    return {provider,calls:calls.length,inputTokens:sum('input'),outputTokens:sum('output')};
  });
}
export function writeReports(session: Session) {
  const report = performance(session.id);
  const nem = report.raw[0];
  const note = session.mode==='mock' ? 'Mock fixture. 실제 모델 성능이 아닙니다.' : 'Judge 점수는 LLM 정성 평가이며 객관적 정확도가 아닙니다.';
  const markdown = `# NVIDIA Performance — ${session.id}\n\n- 주제: ${session.topic}\n- 모델: ${nem?.model ?? 'N/A'}\n- 환경: ${session.mode}\n- 호출: ${report.calls} (성공 ${report.success}, 오류 ${report.errors}, rate limit ${report.rateLimits}, timeout ${report.timeouts})\n- 평균/p50/p95/p99 응답 시간(ms): ${fmt(report.meanLatencyMs)} / ${fmt(report.p50Ms)} / ${fmt(report.p95Ms)} / ${fmt(report.p99Ms)}\n- 평균 TTFT(ms): ${fmt(report.meanTtftMs)}\n- 입력/출력 토큰: ${report.inputTokens ?? 'N/A'} / ${report.outputTokens ?? 'N/A'}\n- Tokens/sec: ${fmt(report.tokensPerSecond)}\n- 평균 품질(0~5): ${fmt(report.meanQuality)}\n- 유효/수용/설계 반영 비율: ${fmt(report.validRatio)} / ${fmt(report.acceptedRatio)} / ${fmt(report.changedRatio)}\n- 근거 없음/중복 비율: ${fmt(report.unsupportedRatio)} / ${fmt(report.duplicateRatio)}\n- 새 반례/오류 탐지: ${report.counterexamples} / ${report.errorsFound}\n\n${note}\n\n${report.success<20?'표본이 20개 미만이므로 분위수와 일반화 가능한 성능 결론은 표시하지 않습니다.\n':''}\n## 사례와 평가 근거\n${report.raw.map(m=>`- ${m.criticismId ?? m.id}: ${m.score?.rationale ?? m.error ?? '평가 미완료'} (${m.score?.verification ?? '미검증'})`).join('\n')}\n\n## 권고\n측정된 품질과 실제 테스트 검증을 분리해 비교하고, 실패·중복 사례가 누적되면 프롬프트 또는 모델을 재검토하세요.\n`;
  writeFileSync(resolve(dir('nvidia-performance'),`${session.id}.md`),markdown);
  writeFileSync(resolve(dir('nvidia-performance'),`${session.id}.json`),JSON.stringify({sessionId:session.id,topic:session.topic,mode:session.mode,...report},null,2));
  writeFileSync(resolve(dir('debate'),`${session.id}.md`),`# Debate — ${session.topic}\n\n${session.rounds.map(r=>`## Round ${r.index}\n\n### ${r.index===1?'Codex':'Gemini'} proposal\n${r.proposal}\n\n### Nemotron criticism\n${r.criticism}\n\n### Gemini rebuttal\n${r.rebuttal}\n\n### Judge\n${r.score.rationale}\n\nUnresolved: ${r.unresolved.join(', ') || 'none'}\n`).join('\n')}\n## Decision\n${session.decision}\n\n## Plan\n${session.plan}\n`);
  writeAggregate();
}
export function writeExecutionReport(session: Session) { writeFileSync(resolve(dir('execution'),`${session.id}.md`),`# Execution — ${session.topic}\n\nStatus: ${session.status}\n\n${session.execution}\n`); }
export function writeAggregate() {
  const all = sessions(); const p = performance();
  writeFileSync(resolve(dir('nvidia-performance'),'aggregate.md'),`# Aggregate NVIDIA Performance\n\n- 세션: ${all.length}\n- Nemotron 호출: ${p.calls}\n- 평균 응답 시간(ms): ${fmt(p.meanLatencyMs)}\n- 평균 품질(0~5): ${fmt(p.meanQuality)}\n- 유효 반박 비율: ${fmt(p.validRatio)}\n- 오류율: ${fmt(ratio(p.errors,p.calls))}\n\n${all.map(s=>`- ${s.id}: ${s.topic} — ${fmt(performance(s.id).meanLatencyMs)}ms`).join('\n')}\n\n표본 및 모델별 분포는 각 JSON 보고서의 실측 원자료를 참고하세요. Mock 세션은 실제 성능 근거가 아닙니다.\n`);
}
