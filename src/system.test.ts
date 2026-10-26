import { describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { graph } from './debate.js';
import { deleteSession, getSession, metrics, saveEvent, saveSession, events } from './db.js';
import { performance, writeReports } from './reports.js';
import { SqliteCheckpoint } from './checkpoint.js';
import { resolve } from 'node:path';
import type { Session } from './types.js';

describe('mock workflow',()=>{
  it('runs multi-turn debate, measures Nemotron, checkpoints, and waits for approval',async()=>{
    process.env.MOCK_PROVIDERS='true';
    const id=randomUUID();const session:Session={id,projectId:randomUUID(),projectPath:resolve('.'),topic:'Next.js SSR/CSR Tail Latency 방어 프레임워크',status:'debating',createdAt:new Date().toISOString(),rounds:[],decision:'',plan:'',execution:'',codexThreadId:null,codexTurnId:null,mode:'mock'};
    saveSession(session);
    const streamed: unknown[]=[];
    await graph((_sessionId,event)=>streamed.push(event)).invoke({session,proposal:'',criticism:'',rebuttal:'',unresolved:[],route:'CONTINUE'},{configurable:{thread_id:id}});
    const done=getSession(id)!;
    expect(done.rounds).toHaveLength(3);
    expect(streamed.some(event=>(event as {type?:string}).type==='message-start')).toBe(true);
    expect(streamed.some(event=>(event as {type?:string}).type==='message-delta')).toBe(true);
    expect(streamed.some(event=>(event as {type?:string}).type==='message')).toBe(true);
    expect((streamed.filter(event=>(event as {type?:string;phase?:string}).type==='message-start'&&(event as {phase?:string}).phase==='proposal') as {role:string}[]).map(e=>e.role)).toEqual(['codex','gemini','gemini']);
    expect(done.status).toBe('awaiting_approval');
    expect(done.codexThreadId).toBeNull();
    expect(metrics(id).filter(m=>m.provider==='nemotron')).toHaveLength(3);
    expect(metrics(id).filter(m=>m.provider==='codex')).toHaveLength(3);
    expect(performance(id).calls).toBe(3);
    expect(performance(id).inputTokens).toBeNull();
    const restored=await new SqliteCheckpoint(resolve('data/graph.sqlite')).getTuple({configurable:{thread_id:id}});
    expect(restored?.checkpoint.channel_values).toBeDefined();
    writeReports(done);
  });
  it('completes a discussion without a project or execution approval',async()=>{
    process.env.MOCK_PROVIDERS='true';
    const id=randomUUID();const session:Session={id,topic:'LangGraph와 하네스 비교',status:'debating',createdAt:new Date().toISOString(),rounds:[],decision:'',plan:'',execution:'',codexThreadId:null,codexTurnId:null,mode:'mock'};
    saveSession(session);
    await graph(()=>{}).invoke({session,proposal:'',criticism:'',rebuttal:'',unresolved:[],route:'CONTINUE'},{configurable:{thread_id:id}});
    expect(getSession(id)?.status).toBe('completed');
    expect(getSession(id)?.projectPath).toBeUndefined();
  });
  it('deletes a session and its events and metrics without deleting other sessions',()=>{
    const id=randomUUID();const other=randomUUID();
    const session:Session={id,topic:'삭제 대상',status:'stopped',createdAt:new Date().toISOString(),rounds:[],decision:'',plan:'',execution:'',codexThreadId:null,codexTurnId:null,mode:'mock'};
    saveSession(session);saveSession({...session,id:other});saveEvent(id,{type:'test'});
    deleteSession(id);
    expect(getSession(id)).toBeNull();expect(events(id)).toHaveLength(0);expect(metrics(id)).toHaveLength(0);expect(getSession(other)).not.toBeNull();
    deleteSession(other);
  });
});
