import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listDirectories } from './directories.js';

describe('directory browser', () => {
  it('lists child directories for selection without reading files', () => {
    const root = mkdtempSync(join(tmpdir(), 'code-council-folders-'));
    try {
      mkdirSync(join(root, 'project'));
      writeFileSync(join(root, 'notes.txt'), 'text');
      const listing = listDirectories(root);
      expect(listing.path).toBe(root);
      expect(listing.directories).toEqual([{ name: 'project', path: join(root, 'project') }]);
      expect(listDirectories(join(root, 'project')).parent).toBe(root);
      expect(() => listDirectories('relative')).toThrow('절대 경로');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
