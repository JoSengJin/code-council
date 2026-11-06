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
    expect(prompt).toContain('질문이 요구한 항목');
    expect(prompt).toContain('그대로 소제목으로');
    expect(prompt).not.toMatch(/## 이점|trpc|tRPC|Cal\.diy/);
    expect(prompt).toContain('구현 계획·파일별 변경·롤백 절차·검증 명령은 쓰지 마라');
    expect(prompt).toContain('토론 과정');
    expect(prompt).toContain('{"index":1}');
  });
  it('asks for file citations only with a project', () => {
    expect(prompt).toContain('`파일:줄`');
    expect(analysisConclusionPrompt('주제', false, [])).not.toContain('`파일:줄`');
  });
  it('requires premises section, labels on every claim, and directly supporting citations', () => {
    expect(prompt).toContain('"미확인·전제" 항목을 반드시 두고');
    expect(prompt).toContain('모든 주장에 라벨을 붙여라');
    expect(prompt).toContain('추정(일반 지식)');
    expect(prompt).toContain('직접 보여 주는 줄에만 붙이고');
  });
  it('retains decision-relevant reference mappings and verified line citations', () => {
    const withEvidence = analysisConclusionPrompt('핵심만', true, [], '[검증됨] src/example.ts:4');
    expect(withEvidence).toContain('결론에 영향을 주는 항목은 유지하고 설명만 줄여라');
    expect(withEvidence).toContain("검증 표시가 '검증됨'으로 시작하는 항목의 `파일:줄`");
    expect(withEvidence).toContain('줄 번호 정정 항목은 정정된 실제 줄을 인용하라');
    expect(withEvidence).toContain('그 외 인용은 미확인으로 표시하라');
    expect(withEvidence).toContain('"저장소에서 확인하지 못했다"처럼 사실만 서술하라');
  });
  it('forbids placeholder citations, keeps external urls and separate headings', () => {
    expect(prompt).toContain('인용은 반드시 `파일명:줄`로 쓰고, 해당하는 검증된 항목이 없으면 인용을 생략하라');
    expect(prompt).toContain('경로 자리표시자나 물음표 같은 임시 표기는 쓰지 마라');
    expect(prompt).not.toContain('전체 경로는 쓰지 않아도 된다');
    expect(prompt).toContain('외부 원문 URL은 해당 항목 끝에 링크로 남기고');
    expect(prompt).toContain('소제목을 합치지 마라');
  });
  it('uses short evidence labels and forbids process wording in the final answer', () => {
    expect(prompt).toContain('"확인"·"추정"·"판단 기준" 같은 짧은 라벨만');
    expect(prompt).toContain('"저장소에서 확인하지 못했다"처럼 사실만 서술하라');
    expect(prompt).toContain('"토론", "제시된 발췌", "제시된 인용", "초안에서"');
    expect(prompt).toContain('항목당 2~3줄로 줄이되');
    expect(prompt).toContain('결론에 영향을 주는 항목은 유지');
    expect(prompt).toContain('구현 계획·파일별 변경·롤백 절차·검증 명령은 쓰지 마라');
  });
});
