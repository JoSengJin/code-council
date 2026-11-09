import { describe, expect, it } from 'vitest';
import { checkAgentsWith, isChatGptLogin, leadInstalled, leadMissingMessage, recommend, runVersion, type AgentDeps } from './agents.js';

const fake = (codex: { installed: boolean; loggedIn: boolean | null }, claude: boolean, env: NodeJS.ProcessEnv = {}): Partial<AgentDeps> => ({
  env: { CODEX_BIN: 'C:\\fake\\codex.exe', CLAUDE_BIN: 'C:\\fake\\claude.exe', ...env },
  platform: 'win32',
  exists: () => false,
  runVersion: async exe => (exe.includes('codex') ? codex.installed : claude),
  codexLogin: async () => codex.loggedIn,
});

describe('agent status', () => {
  const cases: Array<[string, { installed: boolean; loggedIn: boolean | null }, boolean, 'codex' | 'claude' | null]> = [
    ['Codex 설치+로그인', { installed: true, loggedIn: true }, false, 'codex'],
    ['Codex 설치+미로그인, Claude 있음', { installed: true, loggedIn: false }, true, 'claude'],
    ['Codex 설치+미로그인, Claude 없음', { installed: true, loggedIn: false }, false, null],
    ['Codex 설치+판별불가', { installed: true, loggedIn: null }, false, 'codex'],
    ['Codex 미설치+Claude 설치', { installed: false, loggedIn: null }, true, 'claude'],
    ['둘 다 미설치', { installed: false, loggedIn: null }, false, null],
    ['둘 다 설치', { installed: true, loggedIn: true }, true, 'codex'],
  ];
  for (const [name, codex, claude, recommended] of cases) {
    it(name, async () => {
      const status = await checkAgentsWith(fake(codex, claude));
      expect(status.codex).toEqual({ installed: codex.installed, loggedIn: codex.installed ? codex.loggedIn : null });
      expect(status.claude).toEqual({ installed: claude });
      expect(status.recommended).toBe(recommended);
      expect(recommend(status.codex, claude)).toBe(recommended);
    });
  }

  it('미설치 Codex는 로그인 조회를 하지 않는다', async () => {
    let called = false;
    await checkAgentsWith({ ...fake({ installed: false, loggedIn: true }, true), codexLogin: async () => { called = true; return true; } });
    expect(called).toBe(false);
  });

  it('로그인 조회 예외는 null로 처리한다', async () => {
    const status = await checkAgentsWith({ ...fake({ installed: true, loggedIn: true }, false), codexLogin: async () => { throw new Error('x'); } });
    expect(status.codex).toEqual({ installed: true, loggedIn: null });
  });

  it('실행 실패·타임아웃은 installed=false', async () => {
    expect((await checkAgentsWith({ ...fake({ installed: true, loggedIn: true }, true), runVersion: async () => false })).recommended).toBeNull();
    expect(await runVersion('C:\\no\\such\\codex.exe', 2000, 'win32')).toBe(false);
    expect(await runVersion(process.execPath, 2000, 'linux')).toBe(true);
  });

  it('Claude 경로를 못 찾으면 미설치', async () => {
    const status = await checkAgentsWith({ ...fake({ installed: false, loggedIn: null }, true), env: { CODEX_BIN: 'codex' }, exists: () => false });
    expect(status.claude.installed).toBe(false);
  });

  it('DEFAULT_LEAD를 반영한다', async () => {
    expect((await checkAgentsWith(fake({ installed: true, loggedIn: true }, true, { DEFAULT_LEAD: 'claude' }))).lead).toBe('claude');
    expect((await checkAgentsWith(fake({ installed: true, loggedIn: true }, true))).lead).toBe('codex');
  });

  it('MOCK_PROVIDERS=true면 점검을 건너뛴다', async () => {
    const run = async () => { throw new Error('should not run'); };
    const status = await checkAgentsWith({ ...fake({ installed: false, loggedIn: null }, false, { MOCK_PROVIDERS: 'true' }), runVersion: run, codexLogin: run });
    expect(status).toEqual({ codex: { installed: true, loggedIn: true }, claude: { installed: true }, lead: 'codex', recommended: 'codex' });
    expect(await leadInstalled('claude', fake({ installed: false, loggedIn: null }, false, { MOCK_PROVIDERS: 'true' }))).toBe(true);
  });

  it('CODEX_DISABLED=true면 Codex 미설치로 본다', async () => {
    expect((await checkAgentsWith(fake({ installed: true, loggedIn: true }, true, { CODEX_DISABLED: 'true' }))).codex.installed).toBe(false);
  });

  it('leadInstalled는 선택된 에이전트만 확인한다', async () => {
    expect(await leadInstalled('codex', fake({ installed: false, loggedIn: null }, true))).toBe(false);
    expect(await leadInstalled('claude', fake({ installed: false, loggedIn: null }, true))).toBe(true);
  });

  it('응답과 안내문에 API 키가 없다', async () => {
    const env = { GEMINI_API_KEY: 'secret-gemini', OPENROUTER_API_KEY: 'secret-router', NVIDIA_API_KEY: 'secret-nv' };
    const text = JSON.stringify(await checkAgentsWith(fake({ installed: true, loggedIn: true }, true, env))) + leadMissingMessage('codex') + leadMissingMessage('claude');
    expect(text).not.toMatch(/secret-/);
  });

  it('미설치 안내는 한국어이고 설치·BIN 지정을 포함한다', () => {
    expect(leadMissingMessage('claude')).toMatch(/npm i -g @anthropic-ai\/claude-code.*CLAUDE_BIN/);
    expect(leadMissingMessage('codex')).toMatch(/CODEX_BIN/);
  });

  it('account/read 결과는 ChatGPT 로그인만 true', () => {
    expect(isChatGptLogin({ account: { type: 'chatgpt' } })).toBe(true);
    expect(isChatGptLogin({ account: { type: 'apiKey' } })).toBe(false);
    expect(isChatGptLogin({ account: null })).toBe(false);
  });
});
