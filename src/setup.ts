import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

type Keys = Partial<Record<'GEMINI_API_KEY' | 'OPENROUTER_API_KEY' | 'NVIDIA_API_KEY', string>>;

export function missingKeys(env: NodeJS.ProcessEnv = process.env) {
  return {
    gemini: env.MOCK_PROVIDERS !== 'true' && !env.GEMINI_API_KEY,
    nemotron: env.MOCK_PROVIDERS !== 'true' && !env.OPENROUTER_API_KEY && !env.NVIDIA_API_KEY,
  };
}

export function saveKeys(keys: Keys, env: NodeJS.ProcessEnv = process.env, path = resolve('.env')) {
  if (Object.entries(keys).some(([, value]) => typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value))) {
    throw new Error('API 키를 한 줄로 입력하세요.');
  }
  const next = { ...env, ...keys };
  if (Object.values(missingKeys(next)).some(Boolean)) throw new Error('Gemini 키와 OpenRouter 또는 NVIDIA 키가 필요합니다.');
  let content = existsSync(path) ? readFileSync(path, 'utf8') : '';
  for (const [name, value] of Object.entries(keys)) {
    const line = `${name}=${JSON.stringify(value.trim())}`;
    const pattern = new RegExp(`^${name}=.*$`, 'gm');
    content = pattern.test(content) ? content.replace(pattern, line) : `${content}${content && !content.endsWith('\n') ? '\n' : ''}${line}\n`;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  Object.assign(env, keys);
  return missingKeys(env);
}
