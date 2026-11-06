import { describe, expect, it } from 'vitest';
import { onRequest } from './chat';

// The page's /api/chat only hands the request to the Worker. What the Worker needs from the request (Origin, the client
// address header, the method and the body) must arrive as the browser sent it.

const PAGE_ORIGIN = 'https://japan2100.pages.dev';

function fakeWorker(respond: (request: Request) => Response | Promise<Response>) {
  const received: Request[] = [];
  return {
    received,
    binding: {
      fetch: async (request: Request): Promise<Response> => {
        received.push(request);
        return respond(request);
      },
    },
  };
}

function chatRequest(method = 'POST', body: string | undefined = '{"messages":[]}'): Request {
  return new Request(`${PAGE_ORIGIN}/api/chat`, {
    method,
    headers: { origin: PAGE_ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });
}

describe('functions/api/chat.ts: the page hands /api/chat to the Worker through the binding CHAT_API', () => {
  it('returns exactly what the Worker answered (status, headers and body untouched)', async () => {
    const answer = new Response('{"stop_reason":"end_turn"}', { status: 200, headers: { 'x-from-worker': 'yes' } });
    const worker = fakeWorker(() => answer);

    const response = await onRequest({ request: chatRequest(), env: { CHAT_API: worker.binding } });

    expect(response).toBe(answer);
    expect(worker.received).toHaveLength(1);
  });

  it('passes the Origin header, the client address header, the method, the path and the body on unchanged', async () => {
    const worker = fakeWorker(() => new Response('ok'));
    const body = '{"messages":[{"role":"user","content":"東京は?"}]}';

    await onRequest({ request: chatRequest('POST', body), env: { CHAT_API: worker.binding } });

    const seen = worker.received[0]!;
    expect(seen.method).toBe('POST');
    expect(new URL(seen.url).pathname).toBe('/api/chat');
    expect(seen.headers.get('origin')).toBe(PAGE_ORIGIN);
    expect(seen.headers.get('cf-connecting-ip')).toBe('203.0.113.7');
    expect(seen.headers.get('content-type')).toBe('application/json');
    expect(await seen.text()).toBe(body);
  });

  it('hands every method to the Worker (it answers the preflight and the 405 itself)', async () => {
    for (const method of ['OPTIONS', 'GET', 'PUT', 'DELETE']) {
      const worker = fakeWorker(() => new Response(null, { status: method === 'OPTIONS' ? 204 : 405 }));
      const response = await onRequest({ request: chatRequest(method), env: { CHAT_API: worker.binding } });
      expect(worker.received.map((r) => r.method)).toEqual([method]);
      expect(response.status).toBe(method === 'OPTIONS' ? 204 : 405);
    }
  });

  it('without the binding it answers 503 server_misconfigured in the Worker\'s error shape, and does not throw', async () => {
    const response = await onRequest({ request: chatRequest(), env: {} });

    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ error: 'server_misconfigured' });
  });

  it('when the Worker call fails it answers 502 bad_gateway and leaks nothing of the failure', async () => {
    const worker = fakeWorker(() => {
      throw new Error('secret detail: Worker town-2100-api is not deployed');
    });

    const response = await onRequest({ request: chatRequest(), env: { CHAT_API: worker.binding } });

    expect(response.status).toBe(502);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: 'bad_gateway' });
    expect(text).not.toContain('secret detail');
    expect(text).not.toContain('town-2100-api');
  });

  it('does not call the Worker twice for one request', async () => {
    const worker = fakeWorker(() => new Response('ok'));
    await onRequest({ request: chatRequest(), env: { CHAT_API: worker.binding } });
    expect(worker.received).toHaveLength(1);
  });
});
