import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { missingKeys, saveKeys, saveLead } from './setup.js';

const dir = mkdtempSync(join(tmpdir(), 'code-council-setup-'));
afterEach(() => rmSync(join(dir, '.env'), { force: true }));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('API key setup', () => {
  it('saves missing keys and applies them without a restart', () => {
    const env: NodeJS.ProcessEnv = { MOCK_PROVIDERS: 'false' };
    const path = join(dir, '.env');
    writeFileSync(path, 'PORT=3001\nGEMINI_API_KEY=\n');
    expect(missingKeys(env)).toEqual({ gemini: true, nemotron: true });
    expect(saveKeys({ GEMINI_API_KEY: 'gemini-key', OPENROUTER_API_KEY: 'router-key' }, env, path)).toEqual({ gemini: false, nemotron: false });
    expect(readFileSync(path, 'utf8')).toBe('PORT=3001\nGEMINI_API_KEY="gemini-key"\nOPENROUTER_API_KEY="router-key"\n');
    expect(env.GEMINI_API_KEY).toBe('gemini-key');
  });

  it('rejects incomplete or multiline keys without changing the file', () => {
    const env: NodeJS.ProcessEnv = { MOCK_PROVIDERS: 'false' };
    const path = join(dir, '.env');
    writeFileSync(path, 'PORT=3001\n');
    expect(() => saveKeys({ GEMINI_API_KEY: 'gemini-key' }, env, path)).toThrow();
    expect(() => saveKeys({ GEMINI_API_KEY: 'gemini\nkey', NVIDIA_API_KEY: 'nvidia-key' }, env, path)).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('PORT=3001\n');
  });

  it('saves the lead agent to DEFAULT_LEAD atomically and applies it', () => {
    const env: NodeJS.ProcessEnv = {};
    const path = join(dir, '.env');
    writeFileSync(path, 'PORT=3001\nDEFAULT_LEAD="codex"\n');
    expect(saveLead('claude', env, path)).toBe('claude');
    expect(readFileSync(path, 'utf8')).toBe('PORT=3001\nDEFAULT_LEAD="claude"\n');
    expect(env.DEFAULT_LEAD).toBe('claude');
    expect(readdirSync(dir).filter(name => name.endsWith('.tmp'))).toEqual([]);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('creates .env when missing and rejects invalid leads without changes', () => {
    const env: NodeJS.ProcessEnv = {};
    const path = join(dir, '.env');
    saveLead('codex', env, path);
    expect(readFileSync(path, 'utf8')).toBe('DEFAULT_LEAD="codex"\n');
    delete env.DEFAULT_LEAD;
    for (const bad of ['gpt', '', 'claude\nGEMINI_API_KEY=x', undefined, 1]) expect(() => saveLead(bad, env, path)).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('DEFAULT_LEAD="codex"\n');
    expect(env.DEFAULT_LEAD).toBeUndefined();
  });
});
