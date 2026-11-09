import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { codexExecutable } from './codex-executable.js';
import { claudeExecutable } from './claude.js';

export type Lead = 'codex' | 'claude';
export type AgentStatus = {
  codex: { installed: boolean; loggedIn: boolean | null };
  claude: { installed: boolean };
  lead: Lead;
  recommended: Lead | null;
};

export type AgentDeps = {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  exists: (path: string) => boolean;
  // `<exe> --version` 실행 성공 여부. 실패·타임아웃은 false.
  runVersion: (exe: string, timeoutMs: number) => Promise<boolean>;
  // Codex 계정 조회. 조회 불가·타임아웃이면 null.
  codexLogin: (exe: string, timeoutMs: number, env: NodeJS.ProcessEnv) => Promise<boolean | null>;
  timeoutMs: number;
};

export function runVersion(exe: string, timeoutMs: number, platform = process.platform): Promise<boolean> {
  // npm 설치 shim(.cmd)은 Windows에서 shell이 필요하다. 공백 경로를 위해 따옴표로 감싼다.
  const shell = platform === 'win32' && !/\.exe$/i.test(exe);
  return new Promise(resolve => {
    try {
      execFile(shell ? `"${exe}"` : exe, ['--version'], { timeout: timeoutMs, windowsHide: true, shell }, error => resolve(!error));
    } catch {
      resolve(false);
    }
  });
}

// account/read 결과가 ChatGPT 로그인인지. codex.ts의 requireChatGptLogin과 같은 기준이다.
export function isChatGptLogin(result: unknown) {
  return (result as { account?: { type?: string } | null } | null)?.account?.type === 'chatgpt';
}

// 상주 app-server와 별개인 일회성 프로세스로 account/read만 호출한다.
export function codexLogin(exe: string, timeoutMs: number, env: NodeJS.ProcessEnv = process.env): Promise<boolean | null> {
  return new Promise(resolve => {
    let done = false;
    let proc: ReturnType<typeof spawn>;
    const finish = (value: boolean | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { proc?.kill(); } catch { /* already exited */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      proc = spawn(exe, ['app-server', '--listen', 'stdio://'], { stdio: 'pipe', windowsHide: true, env: { ...env, OPENAI_API_KEY: '', GEMINI_API_KEY: '', NVIDIA_API_KEY: '', OPENROUTER_API_KEY: '' } });
    } catch {
      return finish(null);
    }
    proc.on('error', () => finish(null));
    proc.on('exit', () => finish(null));
    const write = (message: unknown) => proc.stdin?.write(`${JSON.stringify(message)}\n`);
    createInterface({ input: proc.stdout! }).on('line', line => {
      try {
        const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
        if (message.id === 1 && message.result !== undefined) {
          write({ method: 'initialized', params: {} });
          write({ id: 2, method: 'account/read', params: { refreshToken: false } });
        } else if (message.id === 2) finish(message.error ? null : isChatGptLogin(message.result));
      } catch { /* malformed line is ignored */ }
    });
    write({ id: 1, method: 'initialize', params: { clientInfo: { name: 'debate_dev_system', title: 'Debate Dev System', version: '0.1.0' } } });
  });
}

export function defaultLead(env: NodeJS.ProcessEnv = process.env): Lead {
  return env.DEFAULT_LEAD === 'claude' ? 'claude' : 'codex';
}

const defaultDeps = (): AgentDeps => ({ env: process.env, platform: process.platform, exists: existsSync, runVersion, codexLogin, timeoutMs: 8000 });

async function codexInstalled(deps: AgentDeps) {
  if (deps.env.CODEX_DISABLED === 'true') return { installed: false, exe: null };
  const exe = codexExecutable(deps.env, deps.platform);
  return { installed: await deps.runVersion(exe, deps.timeoutMs), exe };
}

async function claudeInstalled(deps: AgentDeps) {
  const exe = claudeExecutable(deps.env, deps.platform, deps.exists);
  return exe ? await deps.runVersion(exe, deps.timeoutMs) : false;
}

export function recommend(codex: { installed: boolean; loggedIn: boolean | null }, claudeIsInstalled: boolean): Lead | null {
  if (codex.installed && codex.loggedIn !== false) return 'codex';
  return claudeIsInstalled ? 'claude' : null;
}

export async function leadInstalled(lead: Lead, overrides: Partial<AgentDeps> = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  if (deps.env.MOCK_PROVIDERS === 'true') return true;
  return lead === 'codex' ? (await codexInstalled(deps)).installed : claudeInstalled(deps);
}

export async function checkAgentsWith(overrides: Partial<AgentDeps> = {}): Promise<AgentStatus> {
  const deps = { ...defaultDeps(), ...overrides };
  const lead = defaultLead(deps.env);
  if (deps.env.MOCK_PROVIDERS === 'true') return { codex: { installed: true, loggedIn: true }, claude: { installed: true }, lead, recommended: 'codex' };
  const [codexResult, claude] = await Promise.all([codexInstalled(deps), claudeInstalled(deps)]);
  const loggedIn = codexResult.installed && codexResult.exe ? await deps.codexLogin(codexResult.exe, deps.timeoutMs, deps.env).catch(() => null) : null;
  const codex = { installed: codexResult.installed, loggedIn };
  return { codex, claude: { installed: claude }, lead, recommended: recommend(codex, claude) };
}

// 동시 호출은 하나로 합친다. UI는 폴링하지 않고 "다시 확인"에서만 호출한다.
let inflight: Promise<AgentStatus> | null = null;
export function checkAgents(): Promise<AgentStatus> {
  inflight ??= checkAgentsWith().finally(() => { inflight = null; });
  return inflight;
}

export function leadMissingMessage(lead: Lead) {
  return lead === 'claude'
    ? 'Claude Code(claude CLI)를 찾을 수 없어 토론 주관으로 쓸 수 없습니다. npm i -g @anthropic-ai/claude-code로 설치하고 서버를 재시작하거나, .env의 CLAUDE_BIN에 claude 실행 파일 절대 경로를 지정하세요.'
    : 'Codex CLI를 찾을 수 없어 토론 주관으로 쓸 수 없습니다. Codex CLI를 설치하고 서버를 재시작하거나, .env의 CODEX_BIN에 codex 실행 파일 절대 경로를 지정하세요. 다른 에이전트를 주관으로 선택할 수도 있습니다.';
}
