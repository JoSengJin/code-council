import type { Provider, TopicKind } from './types.js';

export function parseKind(text: string): TopicKind {
  return /implementation/i.test(text) && !/analysis/i.test(text) ? 'implementation' : 'analysis';
}

// 애매하거나 분류에 실패하면 analysis: 구현형은 실제 변경으로 이어지는 경로라 오분류 비용이 더 크다.
export async function classifyTopic(provider: Provider, topic: string, signal?: AbortSignal): Promise<TopicKind> {
  try {
    const prompt = `다음 개발 주제를 둘 중 하나로 분류하라.\nanalysis: 이점·주의점·비교·검토·전략·설명을 묻는 질문\nimplementation: 코드나 파일을 실제로 만들거나 수정·적용해 달라는 요청\n애매하면 analysis. 영어 한 단어만 답하라.\n주제: ${topic}`;
    return parseKind((await provider.complete(prompt, signal)).text);
  } catch (e) {
    if (signal?.aborted) throw e;
    return 'analysis';
  }
}
