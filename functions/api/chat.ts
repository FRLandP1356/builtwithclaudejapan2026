// The page's own /api/chat (Cloudflare Pages Function). It hands the browser's request to the Worker `town-2100-api`
// through the service binding CHAT_API (wrangler.jsonc at the repository root), so the page calls its own address and
// the Worker has no public address of its own (worker/wrangler.jsonc: workers_dev false).
//
// The request is passed on as it is. That keeps the three things the Worker checks:
// - Origin: a same-origin POST from the page carries `Origin: https://japan2100.pages.dev`, the one allowed origin.
// - The client address: CF-Connecting-IP reaches the Worker through the binding (checked on 2026-11-06 with a throwaway
//   Worker behind the same kind of binding: it saw the visitor's address). A client cannot forge it, because
//   Cloudflare's edge refuses a request that arrives with its own CF-Connecting-IP header (error 1000).
// - Method and body: OPTIONS, GET and the rest go to the Worker too, which answers 405 or the preflight itself.
//
// Nothing is logged here and nothing is added to the request or the response.

interface Env {
  CHAT_API?: { fetch(request: Request): Promise<Response> };
}

function plainError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const worker = context.env.CHAT_API;
  // Without the binding nothing can answer. Say so in the Worker's own error shape (the page treats any non-answer as
  // "the AI is not reachable" and shows the saved answers).
  if (!worker) return plainError(503, 'server_misconfigured');
  try {
    return await worker.fetch(context.request);
  } catch {
    return plainError(502, 'bad_gateway');
  }
}
