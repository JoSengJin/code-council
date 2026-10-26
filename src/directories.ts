import { readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse } from 'node:path';

export function listDirectories(requested = homedir()) {
  if (!isAbsolute(requested)) throw new Error('절대 경로를 입력하세요.');
  const path = realpathSync(requested);
  if (!statSync(path).isDirectory()) throw new Error('폴더를 선택하세요.');
  return {
    path,
    parent: dirname(path) === path ? null : dirname(path),
    home: homedir(),
    root: parse(path).root,
    directories: readdirSync(path, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => ({ name: entry.name, path: join(path, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
