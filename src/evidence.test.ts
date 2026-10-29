import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analysisConclusionPrompt, firstDraftPrompt } from './draft-prompt.js';
import { checkEntry, parseEvidence, topicRoots, verifyEvidence } from './evidence.js';

const fence = '```';
let root: string, outside: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'evidence-project-'));
  outside = mkdtempSync(join(tmpdir(), 'evidence-outside-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'client.ts'), ['import x from "x";', '', 'export function call() {', '  return fetch(url);', '}', ''].join('\n'));
  writeFileSync(join(root, '.env'), 'SECRET=1\n');
  writeFileSync(join(outside, 'other.ts'), 'const leaked = true;\n');
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });

const draft = (...entries: string[]) => `본문\n\n## 로컬 근거\n${entries.join('\n')}\n`;
const entry = (path: string, range: string, claim: string, code: string[]) => `- \`${path}:${range}\` — ${claim}\n${fence}ts\n${code.join('\n')}\n${fence}`;

describe('parseEvidence', () => {
  it('reads path, range, claim and excerpt, including Windows drive paths', () => {
    const parsed = parseEvidence(draft(entry('C:\\work\\app\\src\\a.ts', '10-12', '호출 지점', ['a();', 'b();']), entry('src/b.ts', '3', '단일 줄', ['c();'])));
    expect(parsed).toEqual([
      { path: 'C:\\work\\app\\src\\a.ts', start: 10, end: 12, claim: '호출 지점', excerpt: ['a();', 'b();'] },
      { path: 'src/b.ts', start: 3, end: 3, claim: '단일 줄', excerpt: ['c();'] },
    ]);
  });

  it('returns nothing without a local evidence section and ignores citations above it', () => {
    expect(parseEvidence('`src/a.ts:1` 본문 인용만 있음')).toEqual([]);
    expect(parseEvidence(`- \`src/a.ts:1\` 헤딩 위\n\n## 로컬 근거\n없음`)).toEqual([]);
  });
});

describe('checkEntry', () => {
  const file = ['import x from "x";', '', 'export function call() {', '  return fetch(url);', '}'];
  const make = (start: number, end: number, excerpt: string[]) => ({ path: 'f', start, end, claim: '', excerpt });

  it('verifies an excerpt inside the cited range, ignoring indentation and blank lines', () => {
    expect(checkEntry(make(3, 5, ['export function call() {', 'return fetch(url);']), file).status).toBe('verified');
  });
  it('reports the real location when the line numbers are wrong', () => {
    const check = checkEntry(make(1, 2, ['return fetch(url);']), file);
    expect(check).toMatchObject({ status: 'relocated', start: 4, end: 4 });
  });
  it('flags content that is not in the file and returns the actual cited lines', () => {
    const check = checkEntry(make(1, 1, ['somethingElse();']), file);
    expect(check.status).toBe('mismatch');
    expect(check.lines).toEqual(['import x from "x";']);
  });
  it('marks missing excerpts and out-of-range lines', () => {
    expect(checkEntry(make(3, 3, []), file).status).toBe('no-excerpt');
    expect(checkEntry(make(99, 99, ['x']), file).status).toBe('out-of-range');
  });
});

describe('verifyEvidence', () => {
  it('annotates verified and mismatched entries with real file content', async () => {
    const result = await verifyEvidence(draft(
      entry('src/client.ts', '3-4', '호출', ['export function call() {', '  return fetch(url);']),
      entry('src/client.ts', '1', '틀린 인용', ['return nothing;']),
    ), root);
    expect(result).toContain('검증됨 1/2');
    expect(result).toMatch(/\[검증됨\]/);
    expect(result).toContain('[불일치]');
    expect(result).toContain('import x from "x";');
  });

  it('does not read secret files or paths outside the allowed roots', async () => {
    const result = await verifyEvidence(draft(
      entry('.env', '1', '비밀', ['SECRET=1']),
      entry(join(outside, 'other.ts'), '1', '밖', ['const leaked = true;']),
    ), root);
    expect(result).not.toContain('SECRET=1\n  ```');
    expect(result).not.toContain('leaked = true;\n  ```');
    expect(result.match(/읽기 제외/g)).toHaveLength(2);
  });

  it('allows a reference path that the topic itself names', async () => {
    const result = await verifyEvidence(draft(entry(join(outside, 'other.ts'), '1', '참고', ['const leaked = true;'])), root, topicRoots(`비교 (참고: ${outside})`));
    expect(result).toMatch(/\[검증됨\]/);
  });

  it('reports missing files and returns empty when there is no project or no block', async () => {
    expect(await verifyEvidence(draft(entry('src/none.ts', '1', '없음', ['x'])), root)).toContain('[파일 없음]');
    expect(await verifyEvidence(draft(entry('src/client.ts', '1', 'x', ['x'])), undefined)).toBe('');
    expect(await verifyEvidence('본문만', root)).toBe('');
  });
});

describe('prompts', () => {
  it('asks for a separate local evidence block only when a project is selected', () => {
    for (const kind of ['analysis', 'implementation'] as const) {
      expect(firstDraftPrompt('주제', 'C:\\work\\app', '', kind)).toContain('## 로컬 근거');
      expect(firstDraftPrompt('주제', undefined, '', kind)).not.toContain('## 로컬 근거');
    }
  });
  it('keeps full paths in the block only and pairs reference parts with local counterparts', () => {
    const analysis = firstDraftPrompt('A를 참고해 B를 개선', 'C:\\work\\app', '', 'analysis');
    expect(analysis).toContain('본문에서는 전체경로 대신');
    expect(analysis).toContain('구성 요소마다 우리 쪽에서 대응하는 부분');
    expect(analysis).toContain('더 작은 안이 있으면 함께 비교');
    expect(analysis).not.toMatch(/trpc|cal\.diy|api-client/i);
  });
  it('passes verified evidence into the analysis conclusion', () => {
    expect(analysisConclusionPrompt('주제', true, [], '시스템이 디스크와 대조한 로컬 근거')).toContain('[검증됨] 항목만 사실로');
    expect(analysisConclusionPrompt('주제', true, [])).not.toContain('[검증됨]');
  });
});
