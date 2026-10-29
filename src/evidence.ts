import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';

const MAX_ENTRIES = 20, MAX_RANGE = 40, MAX_SHOWN = 20, MAX_BYTES = 2_000_000;

export type EvidenceEntry = { path: string; start: number; end: number; claim: string; excerpt: string[] };
export type EvidenceCheck = { status: 'verified' | 'relocated' | 'mismatch' | 'no-excerpt' | 'out-of-range'; start: number; end: number; lines: string[] };

const trim = (line: string) => line.trim();
const significant = (lines: string[]) => lines.map(trim).filter(Boolean);

/** 초안 끝의 "## 로컬 근거" 블록에서 `경로:줄` 항목과 코드 발췌를 읽는다. */
export function parseEvidence(draft: string): EvidenceEntry[] {
  const heading = [...draft.matchAll(/^#{1,6}\s*로컬 근거.*$/gm)].at(-1);
  if (!heading) return [];
  const entries: EvidenceEntry[] = [];
  let current: EvidenceEntry | undefined, fence = false;
  for (const line of draft.slice(heading.index! + heading[0].length).split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) { current?.excerpt.push(line); continue; }
    const match = line.match(/^\s*(?:[-*]\s*)?`(.+):(\d+)(?:\s*[-–]\s*(\d+))?`\s*(?:[—–-]+\s*)?(.*)$/);
    if (!match) continue;
    if (entries.length >= MAX_ENTRIES) break;
    const start = Number(match[2]);
    const end = Math.min(Math.max(Number(match[3] ?? start), start), start + MAX_RANGE - 1);
    current = { path: match[1], start, end, claim: match[4].trim(), excerpt: [] };
    entries.push(current);
  }
  return entries;
}

/** 발췌(공백 무시)가 연속으로 나타나는 첫 위치를 찾는다. 없으면 null. */
function locate(file: string[], excerpt: string[]): { start: number; end: number } | null {
  const want = significant(excerpt);
  if (!want.length) return null;
  for (let i = 0; i < file.length; i++) {
    if (trim(file[i]) !== want[0]) continue;
    let j = i, k = 0;
    while (k < want.length && j < file.length) {
      if (!trim(file[j])) { j++; continue; }
      if (trim(file[j]) !== want[k]) break;
      j++; k++;
    }
    if (k === want.length) return { start: i, end: j };
  }
  return null;
}

export function checkEntry(entry: EvidenceEntry, file: string[]): EvidenceCheck {
  if (entry.start > file.length) return { status: 'out-of-range', start: entry.start, end: entry.end, lines: [] };
  const cited = file.slice(entry.start - 1, entry.end);
  if (!significant(entry.excerpt).length) return { status: 'no-excerpt', start: entry.start, end: entry.end, lines: cited };
  if (locate(cited, entry.excerpt)) return { status: 'verified', start: entry.start, end: entry.end, lines: cited };
  const found = locate(file, entry.excerpt);
  if (found) return { status: 'relocated', start: found.start + 1, end: found.end, lines: file.slice(found.start, found.end) };
  return { status: 'mismatch', start: entry.start, end: entry.end, lines: cited };
}

const blocked = (path: string) => /^\.env/i.test(basename(path)) || /\.(pem|key|p12|pfx)$/i.test(path) || /^id_(rsa|ed25519|ecdsa)/.test(basename(path));
const inside = (root: string, path: string) => { const rel = relative(resolve(root), path); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };

/** 주제 문장에 직접 적힌 로컬 절대경로(참고 저장소 등)를 읽기 허용 범위로 추가한다. */
export function topicRoots(topic: string): string[] {
  return [...topic.matchAll(/[A-Za-z]:[\\/][^\s"'`,;)]+/g)].map(m => m[0]);
}

const STATUS: Record<EvidenceCheck['status'], string> = {
  verified: '검증됨',
  relocated: '줄 번호 불일치',
  mismatch: '불일치',
  'no-excerpt': '발췌 없음, 줄 내용 미검증',
  'out-of-range': '줄 범위 초과',
};

const fenced = (lines: string[]) => lines.length ? `\n  \`\`\`\n${lines.slice(0, MAX_SHOWN).map(l => `  ${l}`).join('\n')}\n  \`\`\`` : '';

/**
 * 다른 에이전트는 저장소를 볼 수 없으므로, 초안이 인용한 로컬 근거를 디스크와 대조한 결과(실제 줄 내용 포함)를 돌려준다.
 * 읽기 허용 범위는 projectPath와 roots로 제한하고, 비밀 파일은 읽지 않는다. 항목이 없으면 빈 문자열.
 */
export async function verifyEvidence(draft: string, projectPath: string | undefined, roots: string[] = []): Promise<string> {
  const entries = parseEvidence(draft);
  if (!entries.length || !projectPath) return '';
  const allowed = [projectPath, ...roots];
  const out: string[] = [];
  let verified = 0;
  for (const entry of entries) {
    const path = isAbsolute(entry.path) ? resolve(entry.path) : resolve(projectPath, entry.path);
    const head = `- \`${entry.path}:${entry.start}${entry.end > entry.start ? `-${entry.end}` : ''}\`${entry.claim ? ` — ${entry.claim}` : ''}`;
    if (blocked(path) || !allowed.some(root => inside(root, path))) { out.push(`${head} [읽기 제외: 허용 범위 밖이거나 비밀 파일]`); continue; }
    let file: string[];
    try {
      if ((await stat(path)).size > MAX_BYTES) { out.push(`${head} [검증 불가: 파일이 너무 큼]`); continue; }
      file = (await readFile(path, 'utf8')).split(/\r?\n/);
    } catch { out.push(`${head} [파일 없음]`); continue; }
    const check = checkEntry(entry, file);
    if (check.status === 'verified') verified++;
    const at = check.status === 'relocated' ? ` (발췌는 ${check.start}-${check.end}줄에 있음)` : check.status === 'mismatch' ? ' (인용한 줄의 실제 내용은 아래와 같음)' : '';
    out.push(`${head} [${STATUS[check.status]}]${at}${fenced(check.lines)}`);
  }
  return `시스템이 디스크와 대조한 로컬 근거 (검증됨 ${verified}/${entries.length}):\n${out.join('\n')}`;
}
