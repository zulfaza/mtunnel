export function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function jsonError(status: number, error: string, message?: string): Response {
  const body = message === undefined ? { error } : { error, message };
  return jsonResponse(body, status);
}
