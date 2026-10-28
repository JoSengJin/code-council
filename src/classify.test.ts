import { describe, expect, it } from 'vitest';
import { classifyTopic, parseKind } from './classify.js';
import { analysisConclusionPrompt } from './draft-prompt.js';
import type { Provider } from './types.js';

const provider = (text: string | Error): Provider => ({ name: 'p', model: 'm', async complete() { if (text instanceof Error) throw text; return { text, usage: { input: null, output: null, source: 'unavailable' }, requestId: null, ttftMs: null }; } });

describe('topic classification', () => {
  it.each([['implementation', 'implementation'], [' Implementation\n', 'implementation'], ['analysis', 'analysis'], ['모르겠음', 'analysis'], ['analysis or implementation', 'analysis']])('parses %j', (text, kind) => {
    expect(parseKind(text)).toBe(kind);
  });

  it('classifies through the provider', async () => {
    expect(await classifyTopic(provider('implementation'), '이 함수를 리팩토링해줘')).toBe('implementation');
  });

  it('falls back to analysis when classification fails', async () => {
    expect(await classifyTopic(provider(new Error('boom')), '주제')).toBe('analysis');
  });

  it('rethrows when aborted', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(classifyTopic(provider(new Error('aborted')), '주제', controller.signal)).rejects.toThrow('aborted');
  });
});

describe('analysisConclusionPrompt', () => {
  const prompt = analysisConclusionPrompt('A와 B를 대조해 이점과 주의점', true, [{ index: 1 }]);
  it('answers the question and excludes implementation plan material', () => {
    expect(prompt).toContain('원래 질문: A와 B를 대조해 이점과 주의점');
    expect(prompt).toContain('## 이점');
    expect(prompt).toContain('## 고민할 점과 주의점');
    expect(prompt).toContain('구현 계획·파일별 변경·롤백 절차·검증 명령은 쓰지 마라');
    expect(prompt).toContain('토론 과정');
    expect(prompt).toContain('{"index":1}');
  });
  it('asks for file citations only with a project', () => {
    expect(prompt).toContain('`경로`');
    expect(analysisConclusionPrompt('주제', false, [])).not.toContain('`경로`');
  });
});
