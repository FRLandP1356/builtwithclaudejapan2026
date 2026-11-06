import { describe, expect, it } from 'vitest';
import pagesText from '../wrangler.jsonc?raw';
import workerText from '../worker/wrangler.jsonc?raw';
import chatSource from './api/chat.ts?raw';
import { stripJsonComments } from '../test/helpers/jsonc';

// The Pages deploy configuration is code too: a renamed binding or service deploys fine and then answers 503 or 502 on
// every AI question. These tests read the committed wrangler.jsonc at the repository root (the Pages project) and
// pin it against the Worker's own config and the function that uses the binding.

interface PagesConfig {
  name?: string;
  pages_build_output_dir?: string;
  compatibility_date?: string;
  services?: Array<{ binding?: string; service?: string }>;
  [key: string]: unknown;
}

const pages = JSON.parse(stripJsonComments(pagesText)) as PagesConfig;
const worker = JSON.parse(stripJsonComments(workerText)) as { name?: string; vars?: { ALLOWED_ORIGINS?: string } };

describe('wrangler.jsonc (the Pages project japan2100)', () => {
  it('is the project and build folder the deploy command uses (pages deploy dist --project-name japan2100)', () => {
    expect(pages.name).toBe('japan2100');
    expect(pages.pages_build_output_dir).toBe('./dist');
  });

  it('binds CHAT_API to the Worker by its name in worker/wrangler.jsonc, and to nothing else', () => {
    expect(worker.name).toBe('town-2100-api');
    expect(pages.services).toStrictEqual([{ binding: 'CHAT_API', service: worker.name }]);
  });

  it('the function reads exactly that binding', () => {
    expect(chatSource).toContain('context.env.CHAT_API');
  });

  it('the page origin the Worker allows is the Pages project\'s own address (a same-origin call carries it)', () => {
    expect(worker.vars?.ALLOWED_ORIGINS).toBe(`https://${pages.name}.pages.dev`);
  });

  it('holds no account id, key or address of the account', () => {
    const text = JSON.stringify(pages);
    expect(text).not.toMatch(/account_id|api[_-]?key|token|secret|workers\.dev/i);
    expect(Object.keys(pages).sort()).toEqual(['$schema', 'compatibility_date', 'name', 'pages_build_output_dir', 'services']);
  });
});
