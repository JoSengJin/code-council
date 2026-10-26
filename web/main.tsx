import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {keepHref,linkTarget} from './link-target.js';
import './style.css';
type Score={rationale:string;technicalAccuracy:number;logicalValidity:number;counterexampleQuality:number;evidenceQuality:number;novelty:number;practicalValue:number;verification:string};
type Round={index:number;proposal:string;criticism:string;rebuttal:string;score:Score;unresolved:string[];route:string};
type Project={id:string;name:string;path:string;archivedAt?:string|null};
type DirectoryListing={path:string;parent:string|null;home:string;root:string;directories:{name:string;path:string}[]};
type Session={id:string;projectId?:string;projectPath?:string;topic:string;status:string;archivedAt?:string|null;rounds:Round[];decision:string;plan:string;execution:string;mode:string};
type Perf={calls:number;success:number;errors:number;meanLatencyMs:number|null;meanQuality:number|null;validRatio:number|null;inputTokens:number|null;outputTokens:number|null;raw:{sessionId:string;latencyMs:number;score:Score|null;error:string|null}[]};
type AgentUsage={provider:string;calls:number;inputTokens:number|null;outputTokens:number|null};
type Limits={codex:{primary?:{usedPercent:number;windowDurationMins?:number|null};secondary?:{usedPercent:number;windowDurationMins?:number|null}}|null;openrouter:{limit:number|null;remaining:number|null;reset:string|null;freeRequests:{limit:number;used:number;remaining:number}|null}|null};
type ChatMessage={id:string;role:string;phase:string;round:number;text:string;done:boolean};
const phaseLabel:Record<string,string>={proposal:'제안',criticism:'반박',rebuttal:'재반론',judge:'평가',decision:'기술 결정',plan:'실행계획'};
const fmt=(n:number|null|undefined,suffix='')=>n==null?'N/A':`${n.toFixed(2)}${suffix}`;
const markdownPlugins=[remarkGfm];
const markdownComponents={a:({href,children}:{href?:string;children?:React.ReactNode})=>{const t=linkTarget(href);return t.kind==='external'?<a href={t.href} target="_blank" rel="noreferrer">{children}</a>:<code title="로컬 경로 (링크 아님)">{t.path}</code>;}};
function Markdown({text}:{text:string}){return <div className="markdown"><ReactMarkdown remarkPlugins={markdownPlugins} urlTransform={keepHref} components={markdownComponents}>{text}</ReactMarkdown></div>}
function App(){
  const [view,setView]=useState<'chat'|'performance'|'archive'>('chat');const [projects,setProjects]=useState<Project[]>([]);const [selectedProjectId,setSelectedProjectId]=useState<string|null>(null);const [projectPath,setProjectPath]=useState('');const [showProjectForm,setShowProjectForm]=useState(false);const [directoryBrowserOpen,setDirectoryBrowserOpen]=useState(false);const [directoryListing,setDirectoryListing]=useState<DirectoryListing|null>(null);const [directoryPath,setDirectoryPath]=useState('');const [directoryError,setDirectoryError]=useState('');const [selectingDirectory,setSelectingDirectory]=useState(false);const [sessions,setSessions]=useState<Session[]>([]);const [current,setCurrent]=useState<Session|null>(null);const [topic,setTopic]=useState('');const [events,setEvents]=useState<any[]>([]);const [chat,setChat]=useState<ChatMessage[]>([]);const [streamStatus,setStreamStatus]=useState<'connected'|'reconnecting'>('connected');const [perf,setPerf]=useState<Perf|null>(null);const [usage,setUsage]=useState<AgentUsage[]>([]);const [limits,setLimits]=useState<Limits|null>(null);const [error,setError]=useState('');
  const [completedNotice,setCompletedNotice]=useState<Session|null>(null);
  const loadSet=(key:string)=>{try{return new Set<string>(JSON.parse(localStorage.getItem(key)||'[]'));}catch{return new Set<string>();}};
  const [collapsed,setCollapsed]=useState<Set<string>>(()=>loadSet('collapsedProjects'));const [recentOpen,setRecentOpen]=useState(()=>localStorage.getItem('recentOpen')!=='0');
  const saveCollapsed=(next:Set<string>)=>{setCollapsed(next);try{localStorage.setItem('collapsedProjects',JSON.stringify([...next]));}catch{/* storage unavailable */}};
  const toggleProject=(id:string)=>{const next=new Set(collapsed);if(!next.delete(id))next.add(id);saveCollapsed(next);};
  const toggleRecent=()=>{const next=!recentOpen;setRecentOpen(next);try{localStorage.setItem('recentOpen',next?'1':'0');}catch{/* storage unavailable */}};
  const [notificationPermission,setNotificationPermission]=useState(()=>typeof Notification==='undefined'?'unsupported':Notification.permission);
  const notifiedSessions=useRef(new Set<string>());
  const titleTimer=useRef<ReturnType<typeof setInterval>|null>(null);
  const [setup,setSetup]=useState<{gemini:boolean;nemotron:boolean}|null>(null);const [geminiKey,setGeminiKey]=useState('');const [nemotronKey,setNemotronKey]=useState('');const [nemotronProvider,setNemotronProvider]=useState<'OPENROUTER_API_KEY'|'NVIDIA_API_KEY'>('OPENROUTER_API_KEY');
  const conversationRef=useRef<HTMLDivElement>(null);const followRef=useRef(true);const startingRef=useRef(false);const [starting,setStarting]=useState(false);
  const refresh=async()=>{const [projectResponse,sessionResponse,perfResponse,usageResponse]=await Promise.all([fetch('/api/projects'),fetch('/api/sessions'),fetch('/api/performance'),fetch('/api/usage')]);setProjects(await projectResponse.json());setSessions(await sessionResponse.json());setPerf(await perfResponse.json());setUsage(await usageResponse.json());};
  const load=async(id:string)=>{const s=await (await fetch(`/api/sessions/${id}`)).json();setCurrent(s);};
  const notifyReady=(session:Session)=>{
    if(notifiedSessions.current.has(session.id))return;
    notifiedSessions.current.add(session.id);
    setCompletedNotice(session);
    if(document.hidden&&!titleTimer.current){
      document.title='● 토론 완료 · Code Council';
      titleTimer.current=setInterval(()=>{document.title=document.title.startsWith('●')?'Debate Dev System':'● 토론 완료 · Code Council';},1000);
    }
    if(typeof Notification!=='undefined'&&Notification.permission==='granted'){
      try {
        const notification=new Notification('토론 완료',{body:session.topic});
        notification.onclick=()=>{window.focus();setSelectedProjectId(session.projectId||null);setCurrent(session);setView('chat');notification.close();};
      } catch { /* 화면 알림과 탭 제목은 계속 표시된다. */ }
    }
  };
  const enableNotifications=async()=>setNotificationPermission(await Notification.requestPermission());
  useEffect(()=>{void refresh();void fetch('/api/setup').then(async response=>{if(!response.ok)throw new Error('설정 상태를 확인할 수 없습니다.');setSetup(await response.json());}).catch(e=>setError(String(e)));},[]);
  useEffect(()=>{const clearTitle=()=>{if(!document.hidden){if(titleTimer.current)clearInterval(titleTimer.current);titleTimer.current=null;document.title='Debate Dev System';}};document.addEventListener('visibilitychange',clearTitle);return()=>{document.removeEventListener('visibilitychange',clearTitle);if(titleTimer.current)clearInterval(titleTimer.current);};},[]);
  useEffect(()=>{if(view==='performance')void fetch('/api/limits').then(response=>response.json()).then(setLimits).catch(()=>setLimits(null));},[view]);
  const backgroundSessionIds=sessions.filter(s=>s.status==='debating'&&s.id!==current?.id).map(s=>s.id).join(',');
  useEffect(()=>{
    const streams=backgroundSessionIds.split(',').filter(Boolean).map(id=>{
      const stream=new EventSource(`/api/sessions/${id}/events`);
      stream.onmessage=e=>{const value=JSON.parse(e.data);if(value.type==='ready'){notifyReady(value.session);void refresh();}if(value.type==='error')void refresh();};
      return stream;
    });
    return()=>streams.forEach(stream=>stream.close());
  },[backgroundSessionIds]);
  useEffect(()=>{
    if(!current)return;
    setEvents([]);setChat([]);followRef.current=true;
    const stream=new EventSource(`/api/sessions/${current.id}/events`);
    stream.onopen=()=>setStreamStatus('connected');
    stream.onerror=()=>setStreamStatus('reconnecting');
    stream.onmessage=e=>{
      const value=JSON.parse(e.data);
      if(value.type!=='message-delta')setEvents(old=>[...old,value]);
      if(value.type==='message-start')setChat(old=>old.some(m=>m.id===value.messageId)?old:[...old,{id:value.messageId,role:value.role,phase:value.phase,round:value.round,text:'',done:false}]);
      if(value.type==='message-delta')setChat(old=>old.map(m=>m.id===value.messageId?{...m,text:m.text+value.text}:m));
      if(value.type==='message')setChat(old=>{
        const id=value.messageId||`legacy-${old.length}`;
        const message:ChatMessage={id,role:value.role,phase:value.phase||'',round:value.round,text:value.text,done:true};
        return old.some(m=>m.id===id)?old.map(m=>m.id===id?message:m):[...old,message];
      });
      if(value.type==='round')setChat(old=>{
        const text=`${value.score.rationale}\n정확성 ${value.score.technicalAccuracy} · 논리 ${value.score.logicalValidity} · 반례 ${value.score.counterexampleQuality} · 근거 ${value.score.evidenceQuality} · 신규성 ${value.score.novelty} · 실용성 ${value.score.practicalValue}\n검증: ${value.score.verification} · 결론: ${value.route}`;
        const index=old.findIndex(m=>m.role==='judge'&&m.round===value.round);
        if(index<0)return [...old,{id:`judge-${value.round}`,role:'judge',phase:'judge',round:value.round,text,done:true}];
        return old.map((m,i)=>i===index?{...m,text,done:true}:m);
      });
      if(value.type==='error'||value.type==='execution-error')setChat(old=>old.map(m=>m.done?m:{...m,text:m.text||`응답 실패: ${value.message}`,done:true}));
      if(value.type==='ready'&&current.status==='debating')notifyReady(value.session);
      if(['round','ready','execution-finished','error','execution-error'].includes(value.type)){void load(current.id);void refresh();}
    };
    return()=>stream.close();
  },[current?.id]);
  useEffect(()=>{if(followRef.current&&conversationRef.current)conversationRef.current.scrollTop=conversationRef.current.scrollHeight;},[chat,current?.decision,current?.execution]);
  const post=async(url:string,body?:unknown)=>{setError('');try{const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});const data=await res.json();if(!res.ok){setError(data.error||data.message||'Request failed');return null;}return data;}catch(e){setError(`서버 요청 실패: ${e instanceof Error?e.message:String(e)}`);return null;}};
  const remove=async(s:Session)=>{if(!window.confirm(`"${s.topic}" 세션과 기록을 영구 삭제할까요?`))return;setError('');const response=await fetch(`/api/sessions/${s.id}`,{method:'DELETE'});if(!response.ok){const data=await response.json();setError(data.error||'삭제 실패');return;}if(current?.id===s.id)setCurrent(null);void refresh();};
  const archive=async(s:Session)=>{const result=await post(`/api/sessions/${s.id}/${s.archivedAt?'restore':'archive'}`);if(result){if(current?.id===s.id)setCurrent(result);void refresh();}};
  const archiveProject=async(p:Project)=>{const result=await post(`/api/projects/${p.id}/${p.archivedAt?'restore':'archive'}`);if(result){if(!p.archivedAt&&selectedProjectId===p.id){setSelectedProjectId(null);setCurrent(null);}void refresh();}};
  const removeProject=async(p:Project)=>{const count=sessions.filter(s=>s.projectId===p.id).length;if(!window.confirm(`"${p.name}" 프로젝트와 소속 세션 ${count}개(기록·보고서 포함)를 영구 삭제할까요? 폴더 자체는 삭제되지 않습니다.`))return;setError('');const response=await fetch(`/api/projects/${p.id}`,{method:'DELETE'});if(!response.ok){const data=await response.json();setError(data.error||'삭제 실패');return;}if(selectedProjectId===p.id)setSelectedProjectId(null);if(current?.projectId===p.id)setCurrent(null);void refresh();};
  const addProject=async(e:React.FormEvent)=>{e.preventDefault();const result=await post('/api/projects',{path:projectPath});if(result){setProjectPath('');setShowProjectForm(false);setSelectedProjectId(result.id);setCurrent(null);setView('chat');void refresh();}};
  const browseProject=async(path?:string)=>{setSelectingDirectory(true);setDirectoryError('');try{const response=await fetch(`/api/projects/directories${path?`?${new URLSearchParams({path})}`:''}`);const result=await response.json();if(!response.ok)throw new Error(result.error||'폴더를 열 수 없습니다.');setDirectoryListing(result);setDirectoryPath(result.path);}catch(e){setDirectoryError(e instanceof Error?e.message:String(e));}finally{setSelectingDirectory(false);}};
  const start=async()=>{if(startingRef.current)return;startingRef.current=true;setStarting(true);try{const result=await post('/api/sessions',{topic,projectId:selectedProjectId});if(result){setTopic('');setCurrent(result);void refresh();}}finally{startingRef.current=false;setStarting(false);}};
  const saveSetup=async(e:React.FormEvent)=>{e.preventDefault();const result=await post('/api/setup',{...(setup?.gemini?{GEMINI_API_KEY:geminiKey}:{}),...(setup?.nemotron?{[nemotronProvider]:nemotronKey}:{})});if(result){setGeminiKey('');setNemotronKey('');setSetup(result);}};
  const composer=<form className="composer" onSubmit={e=>{e.preventDefault();if(topic.trim().length>=3)void start();}}><textarea aria-label="개발 주제" placeholder="개발 주제나 기술적 문제를 입력하세요" value={topic} onChange={e=>setTopic(e.target.value)}/><button className="primary" type="submit" disabled={topic.trim().length<3||starting}>{starting?'시작 중…':'토론 시작'}</button></form>;
  const approvals=events.filter(e=>e.type==='approval-request'&&!events.some(x=>x.type==='approval-resolved'&&x.key===e.key));
  const selectedPerf=current&&perf?perf.raw.filter(m=>m.sessionId===current.id):[];
  const activeProjects=projects.filter(p=>!p.archivedAt);const archivedProjects=projects.filter(p=>p.archivedAt);const allCollapsed=activeProjects.length>0&&activeProjects.every(p=>collapsed.has(p.id));
  const selectedProject=projects.find(p=>p.id===selectedProjectId);
  const showSession=(s:Session)=>{setSelectedProjectId(s.projectId||null);setCurrent(s);setView('chat');};
  if (!setup || setup.gemini || setup.nemotron) return <main className="setup-page"><div className="setup-card"><h1>Code Council 설정</h1>{!setup?<p>설정 상태를 확인하는 중입니다…</p>:<><p>멀티 턴 토론에 사용할 API 키를 등록하세요. 키는 이 컴퓨터의 <code>.env</code>에 저장되고 현재 서버에 바로 적용됩니다.</p><form onSubmit={e=>void saveSetup(e)}>{setup.gemini&&<label>Gemini API 키<input type="password" autoComplete="off" required value={geminiKey} onChange={e=>setGeminiKey(e.target.value)}/></label>}{setup.nemotron&&<><label>Nemotron 제공자<select value={nemotronProvider} onChange={e=>setNemotronProvider(e.target.value as 'OPENROUTER_API_KEY'|'NVIDIA_API_KEY')}><option value="OPENROUTER_API_KEY">OpenRouter</option><option value="NVIDIA_API_KEY">NVIDIA Build</option></select></label><label>{nemotronProvider==='OPENROUTER_API_KEY'?'OpenRouter':'NVIDIA Build'} API 키<input type="password" autoComplete="off" required value={nemotronKey} onChange={e=>setNemotronKey(e.target.value)}/></label></>}<button className="primary" type="submit">키 저장하고 시작</button></form></>}{error&&<div className="error" role="alert">{error}</div>}</div></main>;
  return <div className="shell">
    <aside>
      <h1>Code Council</h1>
      {notificationPermission==='default'&&<button className="nav" onClick={()=>void enableNotifications()}>🔔 데스크톱 알림 켜기</button>}
      <button className="nav" onClick={()=>{setSelectedProjectId(null);setView('chat');setCurrent(null)}}>＋ 새 토론</button>
      <button className="nav" onClick={()=>setView('performance')}>에이전트 사용량 · 성능</button>
      <button className="nav" onClick={()=>setView('archive')}>보관함 ({sessions.filter(s=>s.archivedAt).length+archivedProjects.length})</button>
      <div className="sidebar-heading"><h2>프로젝트</h2><span className="heading-actions"><button aria-label={allCollapsed?'모두 펼치기':'모두 접기'} title={allCollapsed?'모두 펼치기':'모두 접기'} onClick={()=>saveCollapsed(allCollapsed?new Set():new Set(activeProjects.map(p=>p.id)))}>{allCollapsed?'▸▸':'▾▾'}</button></span><button aria-label="프로젝트 추가" title="프로젝트 추가" onClick={()=>setShowProjectForm(value=>!value)}>＋</button></div>
      {showProjectForm&&<form className="project-form" onSubmit={e=>void addProject(e)}><div className="project-path-input"><input aria-label="프로젝트 폴더 절대 경로" placeholder="프로젝트 폴더의 절대 경로" value={projectPath} onChange={e=>setProjectPath(e.target.value)}/><button type="button" onClick={()=>{setDirectoryBrowserOpen(true);void browseProject(projectPath||undefined);}}>폴더 선택</button></div><button type="submit" disabled={!projectPath.trim()}>프로젝트 추가</button><small>폴더 등록은 토큰을 사용하지 않습니다.</small></form>}
      <nav aria-label="프로젝트 목록">{activeProjects.map(p=>{const open=!collapsed.has(p.id);const list=sessions.filter(s=>!s.archivedAt&&s.projectId===p.id);return <div className="project-group" key={p.id}><div className="project-row"><button className="chevron" aria-expanded={open} aria-label={`${p.name} ${open?'접기':'펼치기'}`} onClick={()=>toggleProject(p.id)}>{open?'▾':'▸'}</button><button className={`nav project ${selectedProjectId===p.id?'selected':''}`} title={p.path} onClick={()=>{setSelectedProjectId(p.id);setCurrent(null);setView('chat')}}><span className="folder-icon" aria-hidden="true">▱</span><strong>{p.name}</strong>{!open&&list.length>0&&<small className="count">{list.length}</small>}</button><div className="row-actions"><button aria-label={`${p.name} 보관`} title="프로젝트 보관" onClick={()=>void archiveProject(p)}>보관</button><button aria-label={`${p.name} 삭제`} title="프로젝트 삭제" onClick={()=>void removeProject(p)}>삭제</button></div></div>{open&&list.map(s=><div className="session-row project-session-row" key={s.id}><button className={`project-session ${current?.id===s.id?'active':''}`} onClick={()=>showSession(s)} title={s.topic}>{s.topic}</button><div className="row-actions"><button aria-label={`${s.topic} 보관`} title="보관" onClick={()=>void archive(s)}>보관</button><button aria-label={`${s.topic} 삭제`} title="삭제" onClick={()=>void remove(s)}>삭제</button></div></div>)}</div>})}</nav>
      <div className="sidebar-heading"><h2>최근</h2><button className="chevron" aria-expanded={recentOpen} aria-label={recentOpen?'최근 접기':'최근 펼치기'} onClick={toggleRecent}>{recentOpen?'▾':'▸'}</button></div>
      <nav aria-label="최근 세션">{recentOpen&&sessions.filter(s=>!s.archivedAt).map(s=><div className="session-row" key={s.id}><button className={`session ${current?.id===s.id?'active':''}`} onClick={()=>showSession(s)} title={s.topic}><strong>{s.topic}</strong><small>{projects.find(p=>p.id===s.projectId)?.name||'프로젝트 없음'} · {s.status}</small></button><div className="session-actions"><button aria-label={`${s.topic} 보관`} title="보관" onClick={()=>void archive(s)}>보관</button><button aria-label={`${s.topic} 삭제`} title="삭제" onClick={()=>void remove(s)}>삭제</button></div></div>)}</nav>
    </aside>
    <main className={view==='chat'?'chat-main':''}>{view==='chat'?<>
      <header><div><h2 title={current?.topic}>{current?.topic||'새 개발 주제'}</h2><small className="project-path">{current?.projectPath||selectedProject?.path||'프로젝트 없이 토론 가능 · 실행하려면 프로젝트를 선택하세요'}</small></div><span>{current?.status||'대기'}</span></header>
      {!current?<div className="empty-chat"><div className="welcome"><h2>기술 결정을 토론하세요</h2><p>Codex 제안, Nemotron 반박, Gemini 재반론과 Judge 평가를 진행합니다. 프로젝트를 선택하면 실행계획 승인 후 코드를 수정할 수 있습니다.</p></div>{composer}</div>:
      <div className="chat-pane"><div className="chat-scroll" ref={conversationRef} onScroll={e=>{const el=e.currentTarget;followRef.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}}><div className="content">
        <p className="notice">{current.mode==='mock'?'Mock Provider 검증 세션: 실제 API 결과가 아닙니다.':'Judge가 Gemini일 경우 평가 독립성에 한계가 있습니다. AI 평가는 실제 테스트 검증이 아닙니다.'}</p>
        {streamStatus==='reconnecting'&&<p className="notice">서버 연결을 다시 시도하는 중입니다.</p>}
        <div className="conversation" aria-live="polite">
          {chat.length===0&&current.status==='debating'&&<p className="notice">Codex가 첫 설계 초안을 준비하고 있습니다. 프로젝트를 읽는 경우 첫 응답까지 최대 10분 걸릴 수 있습니다.</p>}
          {chat.map(m=><article className={`bubble ${m.role}`} key={m.id}>
            <div className="bubble-head"><strong>{m.role==='nemotron'?'Nemotron':m.role==='judge'?'Judge':m.role==='codex'?'Codex':'Gemini'}</strong><small>Round {m.round} · {phaseLabel[m.phase]||m.phase}</small></div>
            {m.text?<Markdown text={m.text}/>:<p>{m.role==='codex'&&m.phase==='proposal'?'Codex가 프로젝트를 읽고 첫 초안을 작성 중입니다. 첫 응답까지 최대 10분 걸릴 수 있습니다.':'응답을 기다리는 중…'}</p>}{!m.done&&m.text&&<span className="typing">▍</span>}
          </article>)}
        </div>
        {current.decision&&<section><h3>기술 결정</h3><Markdown text={current.decision}/><h3>실행계획</h3><Markdown text={current.plan}/></section>}
        {current.status==='awaiting_approval'&&<section><h3>실행 대상 확인</h3><p className="project-path">{current.projectPath||'프로젝트 미지정: 이 세션은 실행할 수 없습니다. 프로젝트를 선택해 새 세션을 시작하세요.'}</p><button className="primary" disabled={!current.projectPath} onClick={()=>void post(`/api/sessions/${current.id}/approve`).then(()=>load(current.id))}>이 프로젝트에서 계획 승인 및 Codex 실행</button></section>}
        {approvals.map(a=><section key={a.key} className="approval"><h3>Codex 실행 승인 요청</h3><pre>{JSON.stringify(a.params,null,2)}</pre><button onClick={()=>void post(`/api/sessions/${current.id}/approval`,{key:a.key,decision:'accept'})}>승인</button><button onClick={()=>void post(`/api/sessions/${current.id}/approval`,{key:a.key,decision:'decline'})}>거절</button></section>)}
        {current.execution&&<section><h3>실행 결과</h3><pre>{current.execution}</pre></section>}
        {['debating','running'].includes(current.status)&&<button onClick={()=>void post(`/api/sessions/${current.id}/stop`).then(()=>load(current.id))}>중단</button>}
      </div></div><div className="composer-dock">{composer}</div></div>}
    </>:view==='archive'?<><header><h2>보관함</h2><span>{sessions.filter(s=>s.archivedAt).length}개 세션</span></header><div className="content"><p className="notice">보관한 세션은 기록과 보고서를 유지합니다.</p>{archivedProjects.length>0&&<><h3>프로젝트</h3>{archivedProjects.map(p=><div className="archive-row" key={p.id}><div className="archive-main"><strong>{p.name}</strong><small>{p.path}</small></div><button onClick={()=>void archiveProject(p)}>복원</button><button onClick={()=>void removeProject(p)}>삭제</button></div>)}<h3>세션</h3></>}{sessions.filter(s=>s.archivedAt).map(s=><div className="archive-row" key={s.id}><button onClick={()=>showSession(s)}><strong>{s.topic}</strong><small>{projects.find(p=>p.id===s.projectId)?.name||'프로젝트 미지정'} · {s.status} · {s.mode}</small></button><button onClick={()=>void archive(s)}>복원</button><button onClick={()=>void remove(s)}>삭제</button></div>)}</div></>:<>
      <header><h2>에이전트 사용량 · Nemotron 성능</h2><span>{perf?.calls||0} calls</span></header>
      <div className="content">
        <p className="notice">호출 기록은 이 앱에서 관측한 값입니다. Mock 세션의 수치는 실측 성능으로 해석하지 마세요.</p>
        <div className="cards"><div><b>평균 응답</b><strong>{fmt(perf?.meanLatencyMs,'ms')}</strong></div><div><b>평균 품질</b><strong>{fmt(perf?.meanQuality,' / 5')}</strong></div><div><b>유효 반박</b><strong>{fmt(perf?.validRatio==null?null:perf.validRatio*100,'%')}</strong></div><div><b>오류율</b><strong>{fmt(!perf?.calls?null:perf.errors/perf.calls*100,'%')}</strong></div><div><b>Nemotron 입력 / 출력 토큰</b><strong>{perf?.inputTokens??'N/A'} / {perf?.outputTokens??'N/A'}</strong></div></div>
        <h3>에이전트 토큰 사용량</h3><p className="notice">앱에 기록된 성공 호출의 누계입니다. 계정 전체 사용량이나 무료 한도가 아닙니다.</p>
        <div className="cards">{usage.map(a=><div key={a.provider}><b>{a.provider==='codex'?'Codex':a.provider==='gemini'?'Gemini':'Nemotron'} · {a.calls}회</b><strong>{a.inputTokens??'N/A'} / {a.outputTokens??'N/A'}</strong><small>입력 / 출력 토큰</small></div>)}</div>
        <h3>제공자 한도</h3><p className="notice">Codex는 계정 사용률, OpenRouter는 무료 모델 일일 요청 수입니다. 토큰 누계와 같은 단위로 나눈 비율이 아닙니다.</p>
        <p>Codex: {limits?.codex?.primary?`${limits.codex.primary.windowDurationMins??'?'}분 창 ${limits.codex.primary.usedPercent}% 사용`: '조회 불가'}{limits?.codex?.secondary?` · ${limits.codex.secondary.windowDurationMins??'?'}분 창 ${limits.codex.secondary.usedPercent}% 사용`:''}</p>
        <p>Gemini: 이 앱에서 계정 한도 조회 불가 · <a href="https://aistudio.google.com/rate-limit" target="_blank" rel="noreferrer">AI Studio에서 확인</a></p>
        <p>Nemotron: 토큰 한도 조회 불가{limits?.openrouter?.freeRequests?` · OpenRouter 무료 모델 요청 ${limits.openrouter.freeRequests.used} / ${limits.openrouter.freeRequests.limit}회 (일일)`:''}{limits?.openrouter?.limit!=null&&limits.openrouter.remaining!=null&&<> · 키 지출 ${(limits.openrouter.limit-limits.openrouter.remaining).toFixed(2)} / ${limits.openrouter.limit.toFixed(2)} (USD){limits.openrouter.reset?` · ${limits.openrouter.reset}`:''}</>}</p>
        <h3>세션별 응답 시간</h3>
        {sessions.map(s=>{const calls=perf?.raw.filter(m=>m.sessionId===s.id)||[];const avg=calls.length?calls.reduce((n,m)=>n+m.latencyMs,0)/calls.length:0;return <div className="barrow" key={s.id}><span>{s.topic.slice(0,28)}</span><div className="bar" style={{width:`${Math.min(100,avg/100)}%`}}/><small>{fmt(calls.length?avg:null,'ms')}</small></div>})}
        <h3>주요 사례</h3>{(current?selectedPerf:perf?.raw||[]).filter(m=>m.score).slice(-10).map((m,i)=><p key={i}>{m.score?.rationale} · {m.score?.verification}</p>)}
        {current&&<div className="downloads"><a href={`/api/reports/${current.id}/md`}>세션 Markdown</a><a href={`/api/reports/${current.id}/json`}>세션 JSON</a></div>}
        <a href="/api/reports/aggregate" target="_blank">누적 보고서</a>
      </div>
    </>}
    {error&&<div className="error" role="alert">{error}</div>}
    </main>
    {completedNotice&&<div className="completion-notice" role="status"><strong>토론 완료</strong><span>{completedNotice.topic}</span><button onClick={()=>{showSession(completedNotice);setCompletedNotice(null);}}>결과 보기</button><button aria-label="알림 닫기" onClick={()=>setCompletedNotice(null)}>×</button></div>}
    {directoryBrowserOpen&&<div className="directory-backdrop" onClick={()=>setDirectoryBrowserOpen(false)}><div className="directory-dialog" role="dialog" aria-modal="true" aria-label="프로젝트 폴더 선택" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape')setDirectoryBrowserOpen(false);}}><div className="directory-heading"><h2>프로젝트 폴더 선택</h2><button type="button" aria-label="닫기" onClick={()=>setDirectoryBrowserOpen(false)}>✕</button></div><div className="directory-location"><input autoFocus aria-label="탐색할 폴더 경로" value={directoryPath} onChange={e=>setDirectoryPath(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void browseProject(directoryPath);}}}/><button type="button" disabled={selectingDirectory} onClick={()=>void browseProject(directoryPath)}>이동</button></div><div className="directory-shortcuts"><button type="button" disabled={selectingDirectory||!directoryListing} onClick={()=>void browseProject(directoryListing?.home)}>내 폴더</button><button type="button" disabled={selectingDirectory||!directoryListing} onClick={()=>void browseProject(directoryListing?.root)}>루트</button>{directoryListing?.parent&&<button type="button" disabled={selectingDirectory} onClick={()=>void browseProject(directoryListing.parent!)}>상위 폴더</button>}</div><div className="directory-list">{selectingDirectory&&!directoryListing?<p>폴더를 읽는 중…</p>:directoryListing?.directories.length?directoryListing.directories.map(folder=><button type="button" key={folder.path} disabled={selectingDirectory} onClick={()=>void browseProject(folder.path)}>▱ {folder.name}</button>):<p>하위 폴더가 없습니다.</p>}</div>{directoryError&&<p className="directory-error" role="alert">{directoryError}</p>}<div className="directory-actions"><button type="button" onClick={()=>setDirectoryBrowserOpen(false)}>취소</button><button type="button" className="primary" disabled={!directoryListing||selectingDirectory} onClick={()=>{setProjectPath(directoryListing!.path);setDirectoryBrowserOpen(false);}}>현재 폴더 선택</button></div></div></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
