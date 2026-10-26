import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function codexExecutable(env: NodeJS.ProcessEnv = process.env, platform = process.platform) {
  if (env.CODEX_BIN?.trim()) return env.CODEX_BIN.trim();
  if (platform === 'win32' && env.LOCALAPPDATA) {
    const root = join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    if (existsSync(root)) {
      const installed = readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => join(root, entry.name, 'codex.exe'))
        .filter(existsSync)
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      if (installed.length) return installed[0];
    }
  }
  return platform === 'win32' ? 'codex.exe' : 'codex';
}
