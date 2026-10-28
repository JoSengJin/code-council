import { z } from 'zod';

const scoreNumber = z.preprocess(v => typeof v === 'string' && /^[0-5]$/.test(v.trim()) ? Number(v.trim()) : v, z.number().int().min(0).max(5));
export const Score = z.object({
  technicalAccuracy: scoreNumber, logicalValidity: scoreNumber,
  counterexampleQuality: scoreNumber, evidenceQuality: scoreNumber,
  novelty: scoreNumber, practicalValue: scoreNumber,
  rationale: z.string(), evidenceLevel: z.preprocess(v => typeof v === 'string' && !['none', 'claim', 'document', 'test'].includes(v) ? 'claim' : v, z.enum(['none', 'claim', 'document', 'test'])),
  verification: z.preprocess(v => typeof v === 'string' && !['unverified', 'documented', 'tested'].includes(v) ? 'unverified' : v, z.enum(['unverified', 'documented', 'tested'])), valid: z.boolean(), accepted: z.boolean(),
  changedDesign: z.boolean(), newCounterexamples: z.preprocess(v => Array.isArray(v) ? v.length : v, z.number().int().min(0)), errorsFound: z.preprocess(v => Array.isArray(v) ? v.length : v, z.number().int().min(0)),
  unsupported: z.preprocess(v => Array.isArray(v) ? v.length > 0 : v, z.boolean()), duplicate: z.boolean(), geminiAccepted: z.boolean(), finalIncluded: z.boolean(),
});
export type Score = z.infer<typeof Score>;
export type Usage = { input: number | null; output: number | null; source: 'provider' | 'unavailable' };
export type CallMetric = { id: string; sessionId: string; round: number; provider: string; model: string; startedAt: string; endedAt: string; latencyMs: number; ttftMs: number | null; usage: Usage; error: string | null; rateLimited: boolean; timedOut: boolean; criticismId: string | null; score: Score | null };
export type Round = { index: number; proposal: string; criticism: string; rebuttal: string; score: Score; unresolved: string[]; route: 'CONTINUE' | 'REVISE' | 'ACCEPT' | 'STOP' };
export type Project = { id: string; name: string; path: string; archivedAt?: string | null };
export type TopicKind = 'analysis' | 'implementation';
export type Session = { id: string; kind?: TopicKind; projectId?: string; projectPath?: string; topic: string; status: 'debating' | 'awaiting_approval' | 'running' | 'completed' | 'stopped' | 'failed'; createdAt: string; archivedAt?: string | null; rounds: Round[]; decision: string; plan: string; execution: string; codexThreadId: string | null; codexTurnId: string | null; mode: 'mock' | 'live' };
export type ProviderResult = { text: string; usage: Usage; requestId: string | null; ttftMs: number | null };
export interface Provider { name: string; model: string; complete(prompt: string, signal?: AbortSignal, onChunk?: (text: string) => void): Promise<ProviderResult> }
