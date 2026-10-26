import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import ReactMarkdown from 'react-markdown';
import { keepHref, linkTarget } from './link-target.js';

describe('linkTarget', () => {
  it('keeps web links clickable', () => {
    expect(linkTarget('https://github.com/a/b/blob/abc/x.tsx')).toEqual({ kind: 'external', href: 'https://github.com/a/b/blob/abc/x.tsx' });
  });
  it.each(['C:/Users/me/app/package.json:7', 'C:\Users\me\app\a.ts:3', 'src/app/layout.tsx:11', '/etc/x', 'javascript:alert(1)'])('shows %s as a plain path', value => {
    expect(linkTarget(value)).toEqual({ kind: 'path', path: value });
  });
});

describe('markdown rendering', () => {
  const render = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, {
    urlTransform: keepHref,
    components: { a: ({ href, children }) => { const t = linkTarget(href); return t.kind === 'external' ? createElement('a', { href: t.href }, children) : createElement('code', { 'data-path': t.path }, t.path); } },
    children: text,
  }));
  it('does not turn a local file citation into a link to the page root', () => {
    const html = render('[package.json](C:/Users/me/app/package.json:7)');
    expect(html).not.toContain('<a');
    expect(html).toContain('C:/Users/me/app/package.json:7');
  });
  it('documents the failure of the default transform', () => {
    const html = renderToStaticMarkup(createElement(ReactMarkdown, { children: '[x](C:/Users/me/a.ts:7)' }));
    expect(html).not.toContain('C:/Users/me/a.ts:7');
  });
  it('keeps external links', () => {
    expect(render('[s](https://example.com/a)')).toContain('<a href="https://example.com/a">');
  });
});
