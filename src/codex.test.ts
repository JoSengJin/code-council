import { describe, expect, it, vi } from 'vitest';
import { CodexBridge } from './codex.js';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { deleteSession } from './db.js';
import type { Session } from './types.js';

describe('Codex read-only proposal',()=>{
  it('uses the final answer and records token usage after streamed commentary',async()=>{
    const bridge=new CodexBridge(()=>{});
    vi.spyOn(bridge,'connect').mockResolvedValue();
    const rpc=vi.spyOn(bridge as any,'rpc').mockImplementation(async(method:unknown)=>method==='account/read'?{account:{type:'chatgpt'}}:method==='thread/start'?{thread:{id:'test-thread'}}:{turn:{id:'test-turn'}});
    const cwd=resolve('.');
    const proposal=bridge.propose('설계하라',cwd);
    await vi.waitFor(()=>expect(rpc).toHaveBeenCalledWith('turn/start',expect.objectContaining({cwd,approvalPolicy:'never',sandboxPolicy:{type:'readOnly'}})));
    const receive=(method:string,params:unknown)=>(bridge as any).onMessage({method,params});
    receive('item/agentMessage/delta',{threadId:'test-thread',delta:'진행 중',itemId:'a'});
    receive('item/completed',{threadId:'test-thread',item:{type:'agentMessage',phase:'commentary',text:'진행 중'}});
    receive('item/agentMessage/delta',{threadId:'test-thread',delta:'최종 설계',itemId:'b'});
    receive('item/completed',{threadId:'test-thread',item:{type:'agentMessage',phase:'final_answer',text:'최종 설계'}});
    receive('thread/tokenUsage/updated',{threadId:'test-thread',tokenUsage:{total:{inputTokens:30,outputTokens:10}}});
    receive('turn/completed',{threadId:'test-thread',turn:{status:'completed'}});
    expect((await proposal).text).toBe('최종 설계');
    expect((await proposal).usage).toEqual({input:30,output:10,source:'provider'});
  });
  it('executes in the session project rather than the server directory',async()=>{
    const bridge=new CodexBridge(()=>{});
    vi.spyOn(bridge,'connect').mockResolvedValue();
    const rpc=vi.spyOn(bridge as any,'rpc').mockImplementation(async(method:unknown)=>method==='account/read'?{account:{type:'chatgpt'}}:method==='thread/start'?{thread:{id:'project-thread'}}:{turn:{id:'project-turn'}});
    const cwd=realpathSync(resolve('src'));
    const session:Session={id:randomUUID(),projectId:randomUUID(),projectPath:cwd,topic:'프로젝트 경로 확인',status:'awaiting_approval',createdAt:new Date().toISOString(),rounds:[],decision:'결정',plan:'계획',execution:'',codexThreadId:null,codexTurnId:null,mode:'live'};
    try {
      await bridge.execute(session);
      expect(rpc).toHaveBeenCalledWith('thread/start',expect.objectContaining({cwd}));
      expect(rpc).toHaveBeenCalledWith('turn/start',expect.objectContaining({cwd,sandboxPolicy:expect.objectContaining({writableRoots:[cwd]})}));
    } finally {deleteSession(session.id);}
  });
  it('does not start a paid API-key Codex session',async()=>{
    const bridge=new CodexBridge(()=>{});
    vi.spyOn(bridge,'connect').mockResolvedValue();
    const rpc=vi.spyOn(bridge as any,'rpc').mockResolvedValue({account:{type:'apiKey'}});
    await expect(bridge.propose('설계하라',realpathSync(resolve('src')))).rejects.toThrow('ChatGPT 계정 로그인');
    expect(rpc).not.toHaveBeenCalledWith('thread/start',expect.anything());
  });
});
