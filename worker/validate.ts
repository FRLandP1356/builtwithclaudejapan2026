import { isAllowedToolName } from './allowlist';

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_MESSAGES = 40;
const MAX_TOOL_DESCRIPTION_CHARS = 4000;

// Content block types the app legitimately sends back: its own text, the model's tool calls
// (and thinking blocks, which must be echoed unchanged) and the tool results.
const ALLOWED_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'text',
  'tool_use',
  'tool_result',
  'thinking',
  'redacted_thinking',
]);

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools: ToolDef[];
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

function validateMessage(raw: unknown): ChatMessage | null {
  if (!isPlainObject(raw)) return null;
  const { role, content } = raw;
  if (role !== 'user' && role !== 'assistant') return null;

  if (typeof content === 'string') {
    return content.length > 0 ? { role, content } : null;
  }
  if (!Array.isArray(content) || content.length === 0) return null;
  for (const block of content) {
    if (!isPlainObject(block)) return null;
    if (typeof block.type !== 'string' || !ALLOWED_BLOCK_TYPES.has(block.type)) return null;
  }
  return { role, content: content as Array<Record<string, unknown>> };
}

type ToolResult = { ok: true; tool: ToolDef } | { ok: false; error: string };

function validateTool(raw: unknown): ToolResult {
  if (!isPlainObject(raw)) return fail('invalid_tools');
  const { name, description, input_schema } = raw;
  if (typeof name !== 'string') return fail('invalid_tools');
  if (!isAllowedToolName(name)) return fail('unknown_tool');
  if (typeof description !== 'string' || description.length === 0 || description.length > MAX_TOOL_DESCRIPTION_CHARS) {
    return fail('invalid_tools');
  }
  if (!isPlainObject(input_schema)) return fail('invalid_tools');
  // Rebuilt from the three validated fields, so nothing else the client sent (type, cache_control, ...) survives.
  return { ok: true, tool: { name, description, input_schema } };
}

/** Validates the parsed JSON body and returns a copy built only from validated fields. */
export function validateChatBody(body: unknown): ValidationResult {
  if (!isPlainObject(body)) return fail('invalid_body');

  const { messages: rawMessages, tools: rawTools } = body;

  if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > MAX_MESSAGES) {
    return fail('invalid_messages');
  }
  const messages: ChatMessage[] = [];
  for (const raw of rawMessages) {
    const message = validateMessage(raw);
    if (!message) return fail('invalid_messages');
    messages.push(message);
  }

  if (!Array.isArray(rawTools)) return fail('invalid_tools');
  const tools: ToolDef[] = [];
  const seen = new Set<string>();
  for (const raw of rawTools) {
    const result = validateTool(raw);
    if (!result.ok) return fail(result.error);
    if (seen.has(result.tool.name)) return fail('invalid_tools');
    seen.add(result.tool.name);
    tools.push(result.tool);
  }

  return { ok: true, value: { messages, tools } };
}
