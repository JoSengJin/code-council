import { describe, expect, it } from 'vitest';
import { claudeArgs, claudeExecutable, isClaudeApiKeyBilled, parseClaudeLine } from './claude.js';
import { join } from 'node:path';

describe('Claude bridge', () => {
  it('reads text deltas and the final result with usage', () => {
    expect(parseClaudeLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '안녕' } } })).toEqual({ delta: '안녕' });
    expect(parseClaudeLine({ type: 'assistant' })).toEqual({});
    const { result } = parseClaudeLine({ type: 'result', result: '최종', is_error: false, usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 7 } });
    expect(result).toEqual({ text: '최종', error: false, usage: { input: 15, output: 7, source: 'provider' } });
    expect(parseClaudeLine({ type: 'result', result: 'x', is_error: true }).result?.usage.source).toBe('unavailable');
  });
  it('blocks API-key billing but not subscription login', () => {
    expect(isClaudeApiKeyBilled({ type: 'system', subtype: 'init', apiKeySource: 'none' })).toBe(false);
    expect(isClaudeApiKeyBilled({ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' })).toBe(true);
    expect(isClaudeApiKeyBilled({ type: 'system', subtype: 'init' })).toBe(false);
    expect(isClaudeApiKeyBilled({ type: 'result', apiKeySource: 'ANTHROPIC_API_KEY' })).toBe(false);
  });
  it('is read-only and honors env overrides', () => {
    const args = claudeArgs({ CLAUDE_MODEL: 'opus', CLAUDE_EFFORT: 'high' });
    expect(args).toContain('--disallowedTools');
    expect(args[args.indexOf('--disallowedTools') + 1]).toMatch(/Bash,Edit,Write/);
    expect(args[args.indexOf('--allowedTools') + 1]).not.toMatch(/Bash|Edit|Write/);
    expect(args).toEqual(expect.arrayContaining(['--model', 'opus', '--effort', 'high']));
    expect(claudeExecutable({ CLAUDE_BIN: 'C:\\x\\claude.exe' })).toBe('C:\\x\\claude.exe');
    const found = join('bin', 'claude.cmd');
    expect(claudeExecutable({ PATH: 'bin' }, 'win32', p => p === found)).toBe(found);
    expect(claudeExecutable({ PATH: 'bin' }, 'win32', () => false)).toBeNull();
  });
});
