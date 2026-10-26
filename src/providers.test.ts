import { afterEach, describe, expect, it, vi } from 'vitest';
import { providers } from './providers.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function streamResponse(frames: string[]) {
  const bytes = new TextEncoder().encode(frames.join(''));
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

describe('provider streaming', () => {
  it('reassembles Gemini chunks and reports usage', async () => {
    vi.stubEnv('MOCK_PROVIDERS', 'false'); vi.stubEnv('GEMINI_API_KEY', 'test'); vi.stubEnv('NVIDIA_API_KEY', 'test');
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '안녕' }] } }] })}\r\n\r\n`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '하세요' }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 } })}\n\n`,
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const chunks: string[] = [];
    const result = await providers().gemini.complete('test', undefined, text => chunks.push(text));
    expect(fetchMock.mock.calls[0][0]).toContain(':streamGenerateContent?alt=sse');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.thinkingConfig.thinkingLevel).toBe('minimal');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.responseSchema).toBeUndefined();
    expect(chunks).toEqual(['안녕', '하세요']);
    expect(result.text).toBe('안녕하세요');
    expect(result.usage).toEqual({ input: 3, output: 4, source: 'provider' });
    expect(result.ttftMs).not.toBeNull();
  });

  it('uses low thinking for non-Lite Gemini models', async () => {
    vi.stubEnv('MOCK_PROVIDERS', 'false'); vi.stubEnv('GEMINI_API_KEY', 'test'); vi.stubEnv('NVIDIA_API_KEY', 'test'); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })));
    vi.stubGlobal('fetch', fetchMock);
    await providers().gemini.complete('test');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.thinkingConfig.thinkingLevel).toBe('low');
  });

  it('requests numeric Judge scores with a structured JSON response', async () => {
    vi.stubEnv('MOCK_PROVIDERS', 'false'); vi.stubEnv('GEMINI_API_KEY', 'test'); vi.stubEnv('NVIDIA_API_KEY', 'test');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] })));
    vi.stubGlobal('fetch', fetchMock);
    await providers().judge.complete('평가');
    const config = JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig;
    expect(config.responseMimeType).toBe('application/json');
    expect(config.responseSchema.properties.evidenceQuality).toEqual({ type: 'INTEGER', minimum: 0, maximum: 5 });
    expect(config.responseSchema.required).toContain('evidenceQuality');
  });

  it('reassembles NVIDIA deltas until DONE', async () => {
    vi.stubEnv('MOCK_PROVIDERS', 'false'); vi.stubEnv('GEMINI_API_KEY', 'test'); vi.stubEnv('NVIDIA_API_KEY', 'test'); vi.stubEnv('OPENROUTER_API_KEY', '');
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([
      `data: ${JSON.stringify({ id: 'req-1', choices: [{ delta: { content: '반' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: '박' } }], usage: { prompt_tokens: 2, completion_tokens: 3 } })}\n\n`,
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const chunks: string[] = [];
    const result = await providers().nemotron.complete('test', undefined, text => chunks.push(text));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
    expect(chunks).toEqual(['반', '박']);
    expect(result.text).toBe('반박');
    expect(result.usage).toEqual({ input: 2, output: 3, source: 'provider' });
  });

  it('routes an existing OpenRouter key only to the free Nemotron model', async () => {
    vi.stubEnv('MOCK_PROVIDERS', 'false'); vi.stubEnv('GEMINI_API_KEY', 'test'); vi.stubEnv('NVIDIA_API_KEY', 'sk-or-v1-test'); vi.stubEnv('OPENROUTER_API_KEY', '');
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: '반박' } }] })}\n\n`,
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const nemotron = providers().nemotron;
    await nemotron.complete('test', undefined, () => {});
    expect(nemotron.model).toBe('nvidia/nemotron-3.5-lightning:free');
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('nvidia/nemotron-3.5-lightning:free');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning).toEqual({ enabled: false });
  });
});
