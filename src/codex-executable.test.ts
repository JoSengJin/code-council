import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { codexExecutable } from './codex-executable.js';

describe('Codex executable discovery',()=>{
  it('uses an explicit path first, then the Windows desktop install',()=>{
    const root=mkdtempSync(join(tmpdir(),'code-council-codex-'));
    try {
      const folder=join(root,'OpenAI','Codex','bin','installed');
      mkdirSync(folder,{recursive:true});
      const executable=join(folder,'codex.exe');
      writeFileSync(executable,'');
      expect(existsSync(executable)).toBe(true);
      expect(codexExecutable({LOCALAPPDATA:root},'win32')).toBe(executable);
      expect(codexExecutable({CODEX_BIN:'C:\\custom\\codex.exe',LOCALAPPDATA:root},'win32')).toBe('C:\\custom\\codex.exe');
    } finally {rmSync(root,{recursive:true,force:true});}
  });
});
