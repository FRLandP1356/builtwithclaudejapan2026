import { describe, expect, it } from 'vitest';
import { TOOL_DEFS, TOOL_NAMES } from '../src/ai/toolDefs';

// The Worker sends TOOL_DEFS to Claude on every request. These budgets keep that upstream request small
// (and so cheap): 8 tools at most 400 + 2,000 characters each.
const MAX_DESCRIPTION_CHARS = 400;
const MAX_SCHEMA_CHARS = 2000;

describe('shared tool definitions (src/ai/toolDefs.ts) as the Worker uses them', () => {
  it('TOOL_NAMES equals the names in TOOL_DEFS, in the same order', () => {
    expect([...TOOL_NAMES]).toEqual(TOOL_DEFS.map((tool) => tool.name));
  });

  it('has at least one tool, with unique names the Messages API accepts', () => {
    expect(TOOL_DEFS.length).toBeGreaterThan(0);
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    for (const name of TOOL_NAMES) expect(name, name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });

  it('keeps every description under 400 characters', () => {
    for (const tool of TOOL_DEFS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(0);
      expect(tool.description.length, tool.name).toBeLessThan(MAX_DESCRIPTION_CHARS);
    }
  });

  it('keeps every serialised input_schema under 2,000 characters and shaped as an object schema', () => {
    for (const tool of TOOL_DEFS) {
      expect(tool.input_schema.type, tool.name).toBe('object');
      expect(JSON.stringify(tool.input_schema).length, tool.name).toBeLessThan(MAX_SCHEMA_CHARS);
    }
  });

  it('serialises to plain JSON without losing anything (no undefined, functions or cycles)', () => {
    expect(JSON.parse(JSON.stringify(TOOL_DEFS))).toEqual(TOOL_DEFS);
  });
});
