import { describe, expect, it } from 'vitest';
import { firstDraftPrompt } from './draft-prompt.js';

const topic = 'scripts/test3를 기점으로 공통 Shell처럼 SSR/CSR 구조를 재설계 (참고 저장소: C:\\work\\shell-repo)';

describe('firstDraftPrompt', () => {
  const prompt = firstDraftPrompt(topic, 'C:\\work\\app', '');

  it('requires checking boundaries before proposing, in order', () => {
    const order = ['관련 파일 확인', '경계 확인', '설계 대상 명시', '외부 원문 비교', '제안:'].map(k => prompt.indexOf(k));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('derives boundaries from the design target kind, not a fixed web-app checklist', () => {
    const rules = prompt.slice(prompt.indexOf('경계 확인'), prompt.indexOf('설계 대상 명시'));
    expect(rules).toContain('설계 대상의 종류');
    expect(rules).toContain('소유 단위(모듈·프로세스·배포 단위 등)');
    expect(rules).toContain('호출자와 데이터 흐름');
    expect(rules).toContain('주제에 해당하는 것만');
    expect(rules).not.toMatch(/rewrite|라우팅|SSR|CSR/);
  });

  it('keeps interpretations open when the target is ambiguous', () => {
    expect(prompt).toContain('조용히 좁히지 말고');
    expect(prompt).toContain('로컬 경로');
    expect(prompt).toContain('영향받는 범위');
  });

  it.each(['데이터 모델의 상태 전이 설계', '정렬 알고리즘의 시간 복잡도 개선'])('selects relevant evidence without mandatory rewrite analysis: %s', subject => {
    const p = firstDraftPrompt(subject, 'C:\\work\\app', '');
    expect(p).toContain('호출자와 데이터 흐름');
    expect(p).toContain('입력·성능·호환성 제약');
    expect(p).toContain('주제와 무관한 경계 분석은 요구하지 마라');
    expect(p).not.toMatch(/rewrite|라우팅|SSR|CSR/);
  });

  it('keeps ambiguity undecided with criteria and no pre-selected reading', () => {
    expect(prompt).toContain('선택 기준');
    expect(prompt).toContain('"미결정"');
    expect(prompt).toContain('확정된 요구처럼');
    expect(prompt).toContain('같은 비중의 대안');
  });

  it('cites local files as plain verified paths, not markdown links', () => {
    expect(prompt).toContain('실제로 열어 확인한 줄만 적어라');
    expect(prompt).toContain('백틱 안의 `전체경로:줄번호`');
    expect(prompt).toContain('링크는 http(s) 외부 원문에만');
  });

  it('has no project-specific hardcoding', () => {
    expect(firstDraftPrompt('neutral topic', 'C:\\work\\app', '')).not.toMatch(/test3|cal.diy|shr-ffw|Shell.tsx/i);
  });

  it('forbids claiming full redesign from one interpretation', () => {
    expect(prompt).toContain('끝났다고 결론 내리지 마라');
  });

  it('keeps evidence separation, topic and references', () => {
    const p = firstDraftPrompt(topic, 'C:\\work\\app', '출처: X');
    expect(p).toContain(topic);
    expect(p).toContain('로컬 파일·외부 원문·추정으로 구분');
    expect(p.endsWith('출처: X')).toBe(true);
  });

  it('does not claim repo verification without a project', () => {
    const p = firstDraftPrompt(topic, undefined, '');
    expect(p).toContain('저장소 검증을 주장하지 마라');
    expect(p).not.toContain('관련 파일 확인');
  });
});
