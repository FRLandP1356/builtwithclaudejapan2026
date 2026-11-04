// The tool names come from the one shared, data-only module that also holds the definitions the Worker sends.
import { TOOL_NAMES } from '../src/ai/toolDefs';

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_MESSAGES = 40;
/** Cap on all text the client can make us pay for: strings, text blocks, tool results, tool inputs, thinking. */
export const MAX_TOTAL_TEXT_CHARS = 48_000;
const ALLOWED_TOOL_NAMES: ReadonlySet<string> = new Set(TOOL_NAMES);
// The Messages API requires tool_use ids to match this pattern.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface TextBlock {
  type: 'text';
  text: string;
}
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | TextBlock[];
  is_error?: boolean;
}
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}
export interface RedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string;
}
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock | RedactedThinkingBlock;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/** The request body is `{ messages }` and nothing else. Tool definitions are server-owned (see index.ts). */
export interface ChatRequest {
  messages: ChatMessage[];
}

export type ValidationResult =
  | { ok: true; value: ChatRequest }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Counts every character the client can make us forward, so one cap covers all block kinds. */
class TextBudget {
  private used = 0;
  spend(chars: number): boolean {
    this.used += chars;
    return this.used <= MAX_TOTAL_TEXT_CHARS;
  }
}

/** A text block must carry something other than whitespace (the API rejects it otherwise). */
function readText(value: unknown, budget: TextBudget): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return budget.spend(value.length) ? value : null;
}

/** Strings that are only passed along (signatures, ids) are checked for type only. */
function readString(value: unknown, budget: TextBudget): string | null {
  if (typeof value !== 'string') return null;
  return budget.spend(value.length) ? value : null;
}

function readId(value: unknown): string | null {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null;
}

function rebuildTextBlock(raw: unknown, budget: TextBudget): TextBlock | null {
  if (!isPlainObject(raw) || raw.type !== 'text') return null;
  const text = readText(raw.text, budget);
  return text === null ? null : { type: 'text', text };
}

function rebuildToolResult(raw: Record<string, unknown>, budget: TextBudget): ToolResultBlock | null {
  const toolUseId = readId(raw.tool_use_id);
  if (toolUseId === null) return null;
  const block: ToolResultBlock = { type: 'tool_result', tool_use_id: toolUseId };

  if (raw.content !== undefined) {
    if (typeof raw.content === 'string') {
      const content = readString(raw.content, budget);
      if (content === null) return null;
      block.content = content;
    } else if (Array.isArray(raw.content) && raw.content.length > 0) {
      // Only text blocks: images and documents would be fetched and billed upstream.
      const blocks: TextBlock[] = [];
      for (const inner of raw.content) {
        const rebuilt = rebuildTextBlock(inner, budget);
        if (rebuilt === null) return null;
        blocks.push(rebuilt);
      }
      block.content = blocks;
    } else {
      return null;
    }
  }

  if (raw.is_error !== undefined) {
    if (typeof raw.is_error !== 'boolean') return null;
    block.is_error = raw.is_error;
  }
  return block;
}

function rebuildBlock(role: 'user' | 'assistant', raw: unknown, budget: TextBudget): ContentBlock | null {
  if (!isPlainObject(raw) || typeof raw.type !== 'string') return null;

  switch (raw.type) {
    case 'text':
      return rebuildTextBlock(raw, budget);

    case 'tool_result':
      return role === 'user' ? rebuildToolResult(raw, budget) : null;

    case 'tool_use': {
      if (role !== 'assistant') return null;
      const id = readId(raw.id);
      if (id === null || typeof raw.name !== 'string' || !ALLOWED_TOOL_NAMES.has(raw.name)) return null;
      if (!isPlainObject(raw.input)) return null;
      if (!budget.spend(JSON.stringify(raw.input).length)) return null;
      return { type: 'tool_use', id, name: raw.name, input: raw.input };
    }

    case 'thinking': {
      if (role !== 'assistant') return null;
      const thinking = readString(raw.thinking, budget);
      const signature = readString(raw.signature, budget);
      return thinking === null || signature === null ? null : { type: 'thinking', thinking, signature };
    }

    case 'redacted_thinking': {
      if (role !== 'assistant') return null;
      const data = readString(raw.data, budget);
      return data === null ? null : { type: 'redacted_thinking', data };
    }

    default:
      return null;
  }
}

function rebuildMessage(raw: unknown, budget: TextBudget): ChatMessage | null {
  if (!isPlainObject(raw)) return null;
  const { role, content } = raw;
  if (role !== 'user' && role !== 'assistant') return null;

  if (typeof content === 'string') {
    const text = readText(content, budget);
    return text === null ? null : { role, content: text };
  }
  if (!Array.isArray(content) || content.length === 0) return null;
  const blocks: ContentBlock[] = [];
  for (const rawBlock of content) {
    const block = rebuildBlock(role, rawBlock, budget);
    if (block === null) return null;
    blocks.push(block);
  }
  return { role, content: blocks };
}

/**
 * Validates the parsed JSON body and returns a copy rebuilt from known fields only:
 * every message and content block is reconstructed, so unknown or nested client fields never leave this Worker.
 * Only `messages` is read. A client `tools` field (or any other unknown top-level field) is ignored, not rejected:
 * the tool definitions are sent from the shared module on every request.
 */
export function validateChatBody(body: unknown): ValidationResult {
  if (!isPlainObject(body)) return fail('invalid_body');

  const { messages: rawMessages } = body;

  if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > MAX_MESSAGES) {
    return fail('invalid_messages');
  }
  const budget = new TextBudget();
  const messages: ChatMessage[] = [];
  for (const raw of rawMessages) {
    const message = rebuildMessage(raw, budget);
    if (!message) return fail('invalid_messages');
    messages.push(message);
  }

  return { ok: true, value: { messages } };
}
