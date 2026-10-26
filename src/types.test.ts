import { describe, expect, it } from 'vitest';
import { Score } from './types.js';

const base = {
  technicalAccuracy: 4, logicalValidity: 4, counterexampleQuality: 3,
  evidenceQuality: 2, novelty: 3, practicalValue: 4,
  rationale: 'AI estimate', evidenceLevel: 'claim', verification: 'unverified',
  valid: true, accepted: false, changedDesign: true,
  newCounterexamples: 1, errorsFound: 0, unsupported: false,
  duplicate: false, geminiAccepted: true, finalIncluded: true,
};

describe('Judge score', () => {
  it('counts list answers while retaining numeric and boolean score fields', () => {
    const score = Score.parse({ ...base, newCounterexamples: ['case A', 'case B'], errorsFound: [], unsupported: ['claim without evidence'] });
    expect([score.newCounterexamples, score.errorsFound, score.unsupported]).toEqual([2, 0, true]);
  });

  it('rejects unrelated invalid values', () => {
    expect(() => Score.parse({ ...base, newCounterexamples: 'two' })).toThrow();
  });

  it('downgrades an unknown evidence label to an unverified claim', () => {
    const score = Score.parse({ ...base, evidenceLevel: 'reasoned', verification: 'code-reviewed' });
    expect(score.evidenceLevel).toBe('claim');
    expect(score.verification).toBe('unverified');
  });
  it('accepts only unambiguous numeric score strings', () => {
    expect(Score.parse({ ...base, evidenceQuality: '4' }).evidenceQuality).toBe(4);
    expect(() => Score.parse({ ...base, evidenceQuality: 'high' })).toThrow();
    expect(() => Score.parse({ ...base, evidenceQuality: '' })).toThrow();
  });
});
