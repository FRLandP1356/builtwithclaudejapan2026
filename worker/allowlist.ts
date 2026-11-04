// The only tools the proxy will forward to Claude.
//
// This is deliberately its own copy (Ruling 12): the Worker must not import from src/.
// A test added in Task 13 asserts that this list equals the one exported by src/ai/toolNames.ts.
export const TOOL_NAMES = [
  'find_area',
  'get_series',
  'compare_sources',
  'run_projection',
  'facility_check',
  'run_allocation',
  'find_similar_now',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const ALLOWED: ReadonlySet<string> = new Set(TOOL_NAMES);

export function isAllowedToolName(name: string): name is ToolName {
  return ALLOWED.has(name);
}
