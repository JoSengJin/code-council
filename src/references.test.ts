import { afterEach, expect, it, vi } from 'vitest';
import { collectReferences } from './references.js';

afterEach(() => vi.unstubAllGlobals());

it('pins a GitHub blob link to a commit and includes its source once', async () => {
  const sha = 'a'.repeat(40);
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ sha })))
    .mockResolvedValueOnce(new Response('export default function Shell() {}'));
  vi.stubGlobal('fetch', fetchMock);

  const link = 'https://github.com/calcom/cal.diy/blob/main/apps/web/modules/shell/Shell.tsx';
  const result = await collectReferences(`[${link}](${link})`);

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toBe(`https://raw.githubusercontent.com/calcom/cal.diy/${sha}/apps/web/modules/shell/Shell.tsx`);
  expect(result).toContain(`커밋: ${sha}`);
  expect(result).toContain('export default function Shell() {}');
});

it('reports unavailable or unsupported references without inventing source content', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 403 })));

  const result = await collectReferences('https://github.com/calcom/cal.diy/blob/main/Shell.tsx https://example.com/guide');

  expect(result.match(/원문 확인 실패/g)).toHaveLength(2);
  expect(result).not.toContain('--- 원문 시작');
});
