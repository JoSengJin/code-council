import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync, rmSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { z } from 'zod';
import { deleteGraphThread, graph } from './debate.js';
import { CodexBridge } from './codex.js';
import { deleteProject, deleteSession, events, getProject, getSession, projectByPath, projects, saveEvent, saveProject, saveSession, sessions } from './db.js';
import { agentUsage, performance, writeAggregate } from './reports.js';
import type { Session } from './types.js';
import { missingKeys, saveKeys } from './setup.js';
import { listDirectories } from './directories.js';

if (existsSync(resolve('.env'))) loadEnvFile(resolve('.env'));
setDefaultCACertificates([...getCACertificates('default'), ...getCACertificates('system')]);

for (const session of sessions()) {
  if (session.status !== 'debating' && session.status !== 'running') continue;
  session.status = 'failed';
  session.execution = '서버가 재시작되어 작업이 중단되었습니다. 새 세션을 시작하세요.';
  saveSession(session);
  saveEvent(session.id, { type: 'error', message: session.execution });
}

const app=Fastify({logger:true});
const listeners=new Map<string,Set<(event:unknown)=>void>>();
const controllers=new Map<string,AbortController>();
const emit=(id:string,event:unknown)=>{if((event as {type?:string}).type!=='message-delta')saveEvent(id,event);for(const fn of listeners.get(id)||[])fn(event);};
const codex=new CodexBridge(emit);
app.get('/api/health',async()=>({ok:true,codexInstalled:process.env.CODEX_DISABLED!=='true',mode:process.env.MOCK_PROVIDERS==='true'?'mock':'live'}));
app.get('/api/setup',async()=>missingKeys());
app.post('/api/setup',async(req,reply)=>{
  const input=z.object({GEMINI_API_KEY:z.string().optional(),OPENROUTER_API_KEY:z.string().optional(),NVIDIA_API_KEY:z.string().optional()}).strict().parse(req.body);
  try {return saveKeys(input);} catch(error) {return reply.code(400).send({error:error instanceof Error?error.message:String(error)});}
});
app.get('/api/projects',async()=>projects());
app.get('/api/projects/directories',async(req,reply)=>{
  const {path}=z.object({path:z.string().optional()}).parse(req.query);
  try {return listDirectories(path);} catch {return reply.code(400).send({error:'폴더를 열 수 없습니다. 경로와 접근 권한을 확인하세요.'});}
});
app.post('/api/projects',async(req,reply)=>{
  const input=z.object({path:z.string().trim().min(1)}).parse(req.body);
  if(!isAbsolute(input.path))return reply.code(400).send({error:'프로젝트 폴더의 절대 경로를 입력하세요.'});
  let path:string;
  try {path=realpathSync(input.path);if(!statSync(path).isDirectory())throw new Error('Not a directory');}
  catch {return reply.code(400).send({error:'존재하는 프로젝트 폴더를 지정하세요.'});}
  const existing=projectByPath(path);if(existing)return existing;
  const project={id:randomUUID(),name:basename(path),path};saveProject(project);return reply.code(201).send(project);
});
app.get('/api/sessions',async()=>sessions());
app.get<{Params:{id:string}}>('/api/sessions/:id',async(req,reply)=>getSession(req.params.id)||reply.code(404).send({error:'Session not found'}));
app.get<{Params:{id:string}}>('/api/sessions/:id/events',async(req,reply)=>{
  const id=req.params.id;if(!getSession(id))return reply.code(404).send({error:'Session not found'});
  reply.hijack();reply.raw.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','x-accel-buffering':'no'});reply.raw.flushHeaders();
  const send=(event:unknown)=>reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  for(const event of events(id))send(event);
  const set=listeners.get(id)||new Set();set.add(send);listeners.set(id,set);
  const heartbeat=setInterval(()=>reply.raw.write(': keep-alive\n\n'),15_000);
  reply.raw.on('close',()=>{clearInterval(heartbeat);set.delete(send);if(!set.size)listeners.delete(id);});
});
app.post('/api/sessions',async(req,reply)=>{
  if(Object.values(missingKeys()).some(Boolean))return reply.code(409).send({error:'먼저 Gemini와 Nemotron API 키를 등록하세요.'});
  const input=z.object({topic:z.string().trim().min(3).max(4000),projectId:z.string().uuid().nullable().optional()}).parse(req.body);
  const project=input.projectId?getProject(input.projectId):null;if(input.projectId&&!project)return reply.code(404).send({error:'프로젝트를 찾을 수 없습니다.'});
  if(project)try {if(realpathSync(project.path)!==project.path||!statSync(project.path).isDirectory())throw new Error('Project path changed');}
  catch {return reply.code(409).send({error:'프로젝트 폴더가 이동되었거나 변경되었습니다. 다시 등록하세요.'});}
  const id=randomUUID();const session:Session={id,...(project?{projectId:project.id,projectPath:project.path}:{}),topic:input.topic,status:'debating',createdAt:new Date().toISOString(),rounds:[],decision:'',plan:'',execution:'',codexThreadId:null,codexTurnId:null,mode:process.env.MOCK_PROVIDERS==='true'?'mock':'live'};
  saveSession(session);const controller=new AbortController();controllers.set(id,controller);
  void Promise.resolve().then(()=>graph(emit,controller.signal,codex).invoke({session,proposal:'',criticism:'',rebuttal:'',unresolved:[],route:'CONTINUE'},{configurable:{thread_id:id}})).catch(e=>{const current=getSession(id)||session;current.status=controller.signal.aborted?'stopped':'failed';current.execution=String(e);saveSession(current);emit(id,{type:'error',message:String(e)});}).finally(()=>controllers.delete(id));
  return reply.code(202).send(session);
});
app.post<{Params:{id:string}}>('/api/sessions/:id/stop',async(req,reply)=>{const s=getSession(req.params.id);if(!s)return reply.code(404).send();controllers.get(s.id)?.abort();if(s.status==='running')await codex.interrupt(s);else {s.status='stopped';saveSession(s);}return {ok:true};});
app.post<{Params:{id:string}}>('/api/sessions/:id/archive',async(req,reply)=>{const s=getSession(req.params.id);if(!s)return reply.code(404).send({error:'Session not found'});s.archivedAt=new Date().toISOString();saveSession(s);return s;});
app.post<{Params:{id:string}}>('/api/sessions/:id/restore',async(req,reply)=>{const s=getSession(req.params.id);if(!s)return reply.code(404).send({error:'Session not found'});s.archivedAt=null;saveSession(s);return s;});
const busy=(s:Session)=>s.status==='debating'||s.status==='running'||controllers.has(s.id);
const purgeSession=async(s:Session)=>{await deleteGraphThread(s.id);deleteSession(s.id);for(const part of ['debate','execution','nvidia-performance'])for(const ext of ['md','json'])rmSync(resolve('reports',part,`${s.id}.${ext}`),{force:true});};
app.delete<{Params:{id:string}}>('/api/sessions/:id',async(req,reply)=>{const s=getSession(req.params.id);if(!s)return reply.code(404).send({error:'Session not found'});if(busy(s))return reply.code(409).send({error:'진행 중인 세션은 먼저 중단하고 완료될 때까지 기다리세요.'});await purgeSession(s);writeAggregate();return {ok:true};});
app.post<{Params:{id:string}}>('/api/projects/:id/archive',async(req,reply)=>{const p=getProject(req.params.id);if(!p)return reply.code(404).send({error:'프로젝트를 찾을 수 없습니다.'});p.archivedAt=new Date().toISOString();saveProject(p);return p;});
app.post<{Params:{id:string}}>('/api/projects/:id/restore',async(req,reply)=>{const p=getProject(req.params.id);if(!p)return reply.code(404).send({error:'프로젝트를 찾을 수 없습니다.'});p.archivedAt=null;saveProject(p);return p;});
app.delete<{Params:{id:string}}>('/api/projects/:id',async(req,reply)=>{const p=getProject(req.params.id);if(!p)return reply.code(404).send({error:'프로젝트를 찾을 수 없습니다.'});const owned=sessions().filter(s=>s.projectId===p.id);if(owned.some(busy))return reply.code(409).send({error:'진행 중인 세션이 있는 프로젝트는 삭제할 수 없습니다. 먼저 중단하세요.'});for(const s of owned)await purgeSession(s);deleteProject(p.id);writeAggregate();return {ok:true,deletedSessions:owned.length};});
app.post<{Params:{id:string}}>('/api/sessions/:id/approve',async(req,reply)=>{const s=getSession(req.params.id);if(!s)return reply.code(404).send();if(s.status!=='awaiting_approval')return reply.code(409).send({error:'Plan is not awaiting approval'});if(!s.projectId||!s.projectPath||getProject(s.projectId)?.path!==s.projectPath)return reply.code(409).send({error:'실행 대상 프로젝트가 지정되지 않았습니다. 프로젝트를 선택해 새 세션을 시작하세요.'});await codex.execute(s);return {ok:true};});
app.post<{Params:{id:string}}>('/api/sessions/:id/approval',async(req,reply)=>{const body=z.object({key:z.string().uuid(),decision:z.enum(['accept','decline'])}).parse(req.body);codex.decide(req.params.id,body.key,body.decision);return {ok:true};});
app.get('/api/performance',async()=>performance());
app.get('/api/usage',async()=>agentUsage());
app.get('/api/limits',async()=>{
  const result:{codex:unknown;openrouter:unknown}={codex:null,openrouter:null};
  try {const limits=await codex.rateLimits();result.codex=limits.rateLimitsByLimitId?.codex||limits.rateLimits;} catch { /* account limits unavailable */ }
  const key=process.env.OPENROUTER_API_KEY||(process.env.NVIDIA_API_KEY?.startsWith('sk-or-v1-')?process.env.NVIDIA_API_KEY:undefined);
  if(key)try {const response=await fetch('https://openrouter.ai/api/v1/key',{headers:{authorization:`Bearer ${key}`},signal:AbortSignal.timeout(5000)});if(response.ok){const data=(await response.json() as {data?:{limit?:number|null;limit_remaining?:number|null;limit_reset?:string|null;free_model_daily_requests?:{limit:number;used:number;remaining:number}}}).data;result.openrouter=data?{limit:data.limit??null,remaining:data.limit_remaining??null,reset:data.limit_reset??null,freeRequests:data.free_model_daily_requests??null}:null;}} catch { /* account limits unavailable */ }
  return result;
});
app.get<{Params:{id:string}}>('/api/performance/:id',async(req)=>performance(req.params.id));
app.get<{Params:{id:string;format:string}}>('/api/reports/:id/:format',async(req,reply)=>{const format=z.enum(['md','json']).parse(req.params.format);const s=getSession(req.params.id);if(!s)return reply.code(404).send();const path=resolve('reports','nvidia-performance',`${s.id}.${format}`);if(!existsSync(path))return reply.code(404).send();reply.header('content-type',format==='json'?'application/json':'text/markdown; charset=utf-8');reply.header('content-disposition',`attachment; filename="${s.id}.${format}"`);return readFileSync(path);});
app.get('/api/reports/aggregate',async(req,reply)=>{const path=resolve('reports/nvidia-performance/aggregate.md');if(!existsSync(path))return reply.code(404).send();reply.header('content-type','text/markdown; charset=utf-8');return readFileSync(path);});
app.setErrorHandler((error,req,reply)=>{req.log.error(error);reply.code(error instanceof z.ZodError?400:500).send({error:error instanceof Error?error.message:String(error)});});
await app.listen({host:'127.0.0.1',port:Number(process.env.PORT||3001)});
