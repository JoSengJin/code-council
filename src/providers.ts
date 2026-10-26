import { randomUUID } from 'node:crypto';
import { saveMetric } from './db.js';
import type { CallMetric, Provider, ProviderResult, Score } from './types.js';

const timeoutMs = 180_000;
const rating = { type: 'INTEGER', minimum: 0, maximum: 5 };
const judgeProperties = {
  technicalAccuracy: rating, logicalValidity: rating, counterexampleQuality: rating,
  evidenceQuality: rating, novelty: rating, practicalValue: rating,
  rationale: { type: 'STRING' },
  evidenceLevel: { type: 'STRING', enum: ['none', 'claim', 'document', 'test'] },
  verification: { type: 'STRING', enum: ['unverified', 'documented', 'tested'] },
  valid: { type: 'BOOLEAN' }, accepted: { type: 'BOOLEAN' }, changedDesign: { type: 'BOOLEAN' },
  newCounterexamples: { type: 'INTEGER', minimum: 0 }, errorsFound: { type: 'INTEGER', minimum: 0 },
  unsupported: { type: 'BOOLEAN' }, duplicate: { type: 'BOOLEAN' },
  geminiAccepted: { type: 'BOOLEAN' }, finalIncluded: { type: 'BOOLEAN' },
  unresolved: { type: 'ARRAY', items: { type: 'STRING' } },
  route: { type: 'STRING', enum: ['CONTINUE', 'REVISE', 'ACCEPT', 'STOP'] },
};
const judgeResponseSchema = { type: 'OBJECT', properties: judgeProperties, required: Object.keys(judgeProperties) };
async function request(url: string, headers: Record<string,string>, body: unknown, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]) });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw error;
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
      throw new Error(`Provider connection to ${new URL(url).hostname} failed: ${cause}`, { cause: error });
    }
    if (response.status === 429) throw new Error('FREE_TIER_LIMIT: provider returned 429; stopped without paid fallback');
    if (response.status >= 500 && attempt === 0) { await new Promise(r => setTimeout(r, 800)); continue; }
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return response;
  }
  throw new Error('Provider request failed');
}
async function readSse(response: Response, onData: (data: any) => void) {
  if (!response.body) throw new Error('Provider returned no stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const consume = (frame: string) => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (data === '[DONE]') return true;
    if (data) onData(JSON.parse(data));
    return false;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + buffer.slice(boundary).match(/^\r?\n\r?\n/)![0].length);
        if (consume(frame)) { await reader.cancel(); return; }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
  } finally { reader.releaseLock(); }
}
export function providers(): { gemini: Provider; nemotron: Provider; judge: Provider; mode: 'mock'|'live' } {
  if (process.env.MOCK_PROVIDERS === 'true') {
    const mock = (name: string): Provider => ({ name, model: 'test-fixture', async complete(prompt, _signal, onChunk) {
      const text = name === 'nemotron' ? 'SSR 요청 타임아웃과 CSR AbortController를 분리하고 공유 예산을 명시해야 한다.' : prompt.includes('JSON') ? JSON.stringify({technicalAccuracy:4,logicalValidity:4,counterexampleQuality:3,evidenceQuality:2,novelty:3,practicalValue:4,rationale:'Mock fixture; external verification absent',evidenceLevel:'claim',verification:'unverified',valid:true,accepted:true,changedDesign:true,newCounterexamples:1,errorsFound:0,unsupported:false,duplicate:false,geminiAccepted:true,finalIncluded:true,unresolved:[],route:'ACCEPT'}) : `${name} mock response: ${prompt.slice(0, 100)}`;
      onChunk?.(text);
      return { text, usage: { input: null, output: null, source: 'unavailable' }, requestId: null, ttftMs: null };
    }});
    return { gemini: mock('gemini'), nemotron: mock('nemotron'), judge: mock('judge'), mode: 'mock' };
  }
  if (process.env.PAID_API_ENABLED !== 'false' && process.env.PAID_API_ENABLED !== undefined) throw new Error('Paid API mode is unsupported');
  const openrouterKey = process.env.OPENROUTER_API_KEY || (process.env.NVIDIA_API_KEY?.startsWith('sk-or-v1-') ? process.env.NVIDIA_API_KEY : undefined);
  if (!process.env.GEMINI_API_KEY || (!openrouterKey && !process.env.NVIDIA_API_KEY)) throw new Error('Set GEMINI_API_KEY and either OPENROUTER_API_KEY or NVIDIA_API_KEY, or MOCK_PROVIDERS=true');
  const gemini = { name: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', async complete(prompt: string, signal?: AbortSignal, onChunk?: (text: string) => void, structured = false): Promise<ProviderResult> {
    const model = encodeURIComponent(this.model);
    const started = performance.now();
    const res = await request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:${onChunk ? 'streamGenerateContent?alt=sse' : 'generateContent'}`, { 'x-goog-api-key': process.env.GEMINI_API_KEY! }, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { thinkingConfig: { thinkingLevel: this.model.includes('flash-lite') ? 'minimal' : 'low' }, ...(structured ? { responseMimeType: 'application/json', responseSchema: judgeResponseSchema } : {}) } }, signal);
    if (onChunk) {
      let text = ''; let ttftMs: number | null = null;
      let usage: ProviderResult['usage'] = { input: null, output: null, source: 'unavailable' };
      await readSse(res, json => {
        const delta = json.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
        if (delta) { if (ttftMs === null) ttftMs = performance.now() - started; text += delta; onChunk(delta); }
        if (json.usageMetadata) usage = { input: json.usageMetadata.promptTokenCount ?? null, output: json.usageMetadata.candidatesTokenCount ?? null, source: 'provider' };
      });
      if (!text) throw new Error('Empty Gemini response');
      return { text, usage, requestId: res.headers.get('x-request-id'), ttftMs };
    }
    const json = await res.json() as any;
    const text = json.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
    if (!text) throw new Error('Empty Gemini response');
    return { text, usage: { input: json.usageMetadata?.promptTokenCount ?? null, output: json.usageMetadata?.candidatesTokenCount ?? null, source: json.usageMetadata ? 'provider' : 'unavailable' }, requestId: res.headers.get('x-request-id'), ttftMs: null };
  }};
  const nemotron: Provider = { name: 'nemotron', model: openrouterKey ? 'nvidia/nemotron-3.5-lightning:free' : process.env.NVIDIA_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b', async complete(prompt, signal, onChunk) {
    const started = performance.now();
    const res = await request(openrouterKey ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://integrate.api.nvidia.com/v1/chat/completions', { authorization: `Bearer ${openrouterKey || process.env.NVIDIA_API_KEY}` }, { model: this.model, messages: [{ role: 'user', content: prompt }], stream: !!onChunk, max_tokens: 2048, ...(openrouterKey ? { reasoning: { enabled: false } } : {}) }, signal);
    if (onChunk) {
      let text = ''; let ttftMs: number | null = null;
      let usage: ProviderResult['usage'] = { input: null, output: null, source: 'unavailable' };
      let requestId = res.headers.get('x-request-id');
      await readSse(res, json => {
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) { if (ttftMs === null) ttftMs = performance.now() - started; text += delta; onChunk(delta); }
        if (json.usage) usage = { input: json.usage.prompt_tokens ?? null, output: json.usage.completion_tokens ?? null, source: 'provider' };
        requestId = json.id || requestId;
      });
      if (!text) throw new Error('Empty NVIDIA response');
      return { text, usage, requestId, ttftMs };
    }
    const json = await res.json() as any;
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text) throw new Error('Empty NVIDIA response');
    return { text, usage: { input: json.usage?.prompt_tokens ?? null, output: json.usage?.completion_tokens ?? null, source: json.usage ? 'provider' : 'unavailable' }, requestId: json.id || res.headers.get('x-request-id'), ttftMs: null };
  }};
  const judge: Provider = { name: 'gemini', model: gemini.model, complete: (prompt, signal, onChunk) => gemini.complete(prompt, signal, onChunk, true) };
  return { gemini, nemotron, judge, mode: 'live' };
}
export async function measured(provider: Provider, prompt: string, sessionId: string, round: number, signal?: AbortSignal, onChunk?: (text: string) => void): Promise<{ result: ProviderResult; metric: CallMetric }> {
  const start = performance.now(); const startedAt = new Date().toISOString(); const id = randomUUID();
  try {
    const result = await provider.complete(prompt, signal, onChunk);
    const metric: CallMetric = { id, sessionId, round, provider: provider.name, model: provider.model, startedAt, endedAt: new Date().toISOString(), latencyMs: performance.now()-start, ttftMs: result.ttftMs, usage: result.usage, error: null, rateLimited: false, timedOut: false, criticismId: provider.name === 'nemotron' ? id : null, score: null };
    saveMetric(metric); return { result, metric };
  } catch (e) {
    const error = String(e); saveMetric({ id, sessionId, round, provider: provider.name, model: provider.model, startedAt, endedAt: new Date().toISOString(), latencyMs: performance.now()-start, ttftMs: null, usage: { input:null,output:null,source:'unavailable' }, error, rateLimited: error.includes('429'), timedOut: error.includes('Timeout'), criticismId: null, score: null }); throw e;
  }
}
export function attachScore(metric: CallMetric, score: Score) { metric.score = score; saveMetric(metric); }
