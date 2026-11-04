import { describe, expect, it } from 'vitest';
import { MAX_MESSAGES, MAX_TOTAL_TEXT_CHARS, validateChatBody } from './validate';

const TOOL = { name: 'find_area', description: 'Find an area', input_schema: { type: 'object', properties: {} } };

function validate(messages: unknown, tools: unknown = []) {
  return validateChatBody({ messages, tools });
}

function messagesOf(result: ReturnType<typeof validateChatBody>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value.messages;
}

describe('validateChatBody: content blocks are rebuilt from known fields', () => {
  it('text blocks keep only type and text', () => {
    const result = validate([
      {
        role: 'user',
        content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral', ttl: '1h' }, citations: [{ a: 1 }], extra: true }],
      },
    ]);
    expect(messagesOf(result)).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
  });

  it('tool_use keeps only type, id, allowlisted name and an input object', () => {
    const result = validate([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_01-A_b', name: 'get_series', input: { code: '13101' }, caller: {}, cache_control: {} }],
      },
    ]);
    expect(messagesOf(result)).toEqual([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_01-A_b', name: 'get_series', input: { code: '13101' } }] },
    ]);
  });

  it('tool_result keeps type, tool_use_id, string-or-text-blocks content and a boolean is_error', () => {
    const asString = validate([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"a":1}', is_error: true, cache_control: {} }] },
    ]);
    expect(messagesOf(asString)).toEqual([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"a":1}', is_error: true }] },
    ]);

    const asBlocks = validate([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'ok', cache_control: {}, citations: [] }] },
        ],
      },
    ]);
    expect(messagesOf(asBlocks)).toEqual([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'ok' }] }] },
    ]);

    const noContent = validate([{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }] }]);
    expect(messagesOf(noContent)).toEqual([{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }] }]);
  });

  it('thinking and redacted_thinking keep only their own fields', () => {
    const result = validate([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hmm', signature: 'sig', cache_control: {} },
          { type: 'redacted_thinking', data: 'abc', extra: 1 },
          { type: 'text', text: 'done' },
        ],
      },
    ]);
    expect(messagesOf(result)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hmm', signature: 'sig' },
          { type: 'redacted_thinking', data: 'abc' },
          { type: 'text', text: 'done' },
        ],
      },
    ]);
  });

  it('message objects keep only role and content', () => {
    const result = validate([{ role: 'user', content: 'hello', cache_control: {}, name: 'x' }]);
    expect(messagesOf(result)).toEqual([{ role: 'user', content: 'hello' }]);
  });
});

describe('validateChatBody: rejected content', () => {
  const image = { type: 'image', source: { type: 'url', url: 'https://x.example/a.png' } };
  const document = { type: 'document', source: { type: 'url', url: 'https://x.example/a.pdf' } };
  const cases: Record<string, unknown[]> = {
    imageInToolResult: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [image] }] }],
    documentInToolResult: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [document] }] }],
    toolResultNestedToolUse: [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'tool_use', id: 'a', name: 'find_area', input: {} }] }] },
    ],
    toolResultEmptyArray: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [] }] }],
    toolResultNumberContent: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 5 }] }],
    toolResultBadIsError: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x', is_error: 'yes' }] }],
    toolResultMissingId: [{ role: 'user', content: [{ type: 'tool_result', content: 'x' }] }],
    toolResultBadId: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'has space', content: 'x' }] }],
    toolUseWebSearch: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'web_search', input: {} }] }],
    toolUseMissingName: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'a', input: {} }] }],
    toolUseBadId: [{ role: 'assistant', content: [{ type: 'tool_use', id: '', name: 'find_area', input: {} }] }],
    toolUseInputArray: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'find_area', input: [] }] }],
    toolUseInputMissing: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'find_area' }] }],
    toolUseInUserMessage: [{ role: 'user', content: [{ type: 'tool_use', id: 'a', name: 'find_area', input: {} }] }],
    toolResultInAssistantMessage: [{ role: 'assistant', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'x' }] }],
    thinkingInUserMessage: [{ role: 'user', content: [{ type: 'thinking', thinking: 'x', signature: 's' }] }],
    thinkingWithoutSignature: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }] }],
    redactedWithoutData: [{ role: 'assistant', content: [{ type: 'redacted_thinking' }] }],
    textWithoutText: [{ role: 'user', content: [{ type: 'text' }] }],
    whitespaceOnlyString: [{ role: 'user', content: ' \n\t　 ' }],
    whitespaceOnlyTextBlock: [{ role: 'user', content: [{ type: 'text', text: '\n ' }] }],
    unknownBlockType: [{ role: 'user', content: [{ type: 'server_tool_use', id: 'a', name: 'web_search', input: {} }] }],
  };
  for (const [name, messages] of Object.entries(cases)) {
    it(`rejects ${name}`, () => {
      expect(validate(messages).ok).toBe(false);
    });
  }
});

describe('validateChatBody: size caps', () => {
  it('caps the total text across messages, blocks, tool results and tool inputs', () => {
    const half = MAX_TOTAL_TEXT_CHARS / 2;
    const atLimit = validate([
      { role: 'user', content: 'a'.repeat(half) },
      { role: 'assistant', content: [{ type: 'text', text: 'b'.repeat(half) }] },
    ]);
    expect(atLimit.ok).toBe(true);

    const over = validate([
      { role: 'user', content: 'a'.repeat(half) },
      { role: 'assistant', content: [{ type: 'text', text: 'b'.repeat(half + 1) }] },
    ]);
    expect(over.ok).toBe(false);

    const viaToolResult = validate([
      { role: 'user', content: 'a'.repeat(half) },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'find_area', input: { q: 'x'.repeat(half) } }] },
    ]);
    expect(viaToolResult.ok).toBe(false);

    const viaResultText = validate([
      { role: 'user', content: 'a'.repeat(half) },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: 'c'.repeat(half + 1) }] }] },
    ]);
    expect(viaResultText.ok).toBe(false);
  });

  it('caps the number of messages', () => {
    const many = (n: number) => Array.from({ length: n }, () => ({ role: 'user', content: 'x' }));
    expect(validate(many(MAX_MESSAGES)).ok).toBe(true);
    expect(validate(many(MAX_MESSAGES + 1)).ok).toBe(false);
  });

  it('caps the size of a tool input_schema and description', () => {
    const big = (n: number) => ({ type: 'object', properties: { x: { type: 'string', description: 'd'.repeat(n) } } });
    const ok = validateChatBody({ messages: [{ role: 'user', content: 'x' }], tools: [{ ...TOOL, input_schema: big(100) }] });
    expect(ok.ok).toBe(true);
    const tooBig = validateChatBody({ messages: [{ role: 'user', content: 'x' }], tools: [{ ...TOOL, input_schema: big(5000) }] });
    expect(tooBig.ok).toBe(false);
    const longDescription = validateChatBody({ messages: [{ role: 'user', content: 'x' }], tools: [{ ...TOOL, description: 'd'.repeat(4001) }] });
    expect(longDescription.ok).toBe(false);
  });
});
