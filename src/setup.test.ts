import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { missingKeys, saveKeys } from './setup.js';

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
});
