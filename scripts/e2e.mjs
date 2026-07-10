import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";

const root = new URL("..", import.meta.url).pathname;
const edgePort = Number.parseInt(process.env.MTUNNEL_E2E_EDGE_PORT ?? "18787", 10);
const upstreamPort = Number.parseInt(process.env.MTUNNEL_E2E_UPSTREAM_PORT ?? "18788", 10);
const tunnelId = `local-test-${process.pid}`;
const secret = "development-token";
const publicBase = `http://127.0.0.1:${edgePort}/t/${tunnelId}`;
const children = new Set();

function checked(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function child(command, args, options = {}) {
  const proc = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], ...options });
  children.add(proc);
  proc.once("exit", () => children.delete(proc));
  proc.stdout.pipe(process.stdout);
  proc.stderr.pipe(process.stderr);
  return proc;
}

async function waitFor(label, probe, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- readiness probes must be sequential.
      if (await probe()) return;
    } catch (error) {
      lastError = error;
    }
    // oxlint-disable-next-line no-await-in-loop -- polling intentionally waits between attempts.
    await delay(100);
  }
  throw new Error(`timed out waiting for ${label}`, { cause: lastError });
}

function startEdge() {
  return child(
    "pnpm",
    [
      "--dir",
      "apps/edge",
      "exec",
      "wrangler",
      "dev",
      "--port",
      String(edgePort),
      "--var",
      `AUTH_SECRET:${secret}`,
      "--var",
      "AUTH_MODE:development",
      "--var",
      "DEV_ROUTING:true",
      "--var",
      "REQUEST_TIMEOUT_MS:500",
    ],
    { env: { ...process.env, WRANGLER_LOG: "error" } },
  );
}

async function stop(proc) {
  if (proc.exitCode !== null) return;
  proc.kill("SIGTERM");
  await Promise.race([once(proc, "exit"), delay(3_000)]);
  if (proc.exitCode === null) proc.kill("SIGKILL");
}

const upstream = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const url = new URL(request.url ?? "/", "http://upstream.test");
  if (url.pathname === "/slow") {
    await delay(2_000);
    response.end("late");
    return;
  }
  if (url.pathname === "/large-response") {
    response.end(Buffer.alloc(700_000, "r"));
    return;
  }
  if (url.pathname === "/cookies") {
    response.setHeader("set-cookie", ["a=1; Path=/", "b=2; Path=/"]);
    response.end("cookies");
    return;
  }
  response.setHeader("content-type", "application/octet-stream");
  response.end(body.length === 0 ? url.pathname : body);
});

let edge;
let agent;
try {
  checked("make", ["-C", "agents/tunnel", "build"]);
  checked("pnpm", [
    "--dir",
    "apps/edge",
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "mtunnel-domains",
    "--local",
  ]);
  upstream.listen(upstreamPort, "127.0.0.1");
  await once(upstream, "listening");

  edge = startEdge();
  await waitFor(
    "Worker health",
    async () => (await fetch(`http://127.0.0.1:${edgePort}/health`)).ok,
  );
  agent = child("agents/tunnel/bin/mt", [
    "http",
    String(upstreamPort),
    "--server",
    `http://127.0.0.1:${edgePort}`,
    "--token",
    secret,
    "--name",
    tunnelId,
  ]);
  await waitFor("agent connection", async () => {
    const response = await fetch(`http://127.0.0.1:${edgePort}/api/v1/tunnels/${tunnelId}/status`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(`status endpoint returned ${response.status}: ${JSON.stringify(body)}`);
    return body.connected === true;
  });

  const concurrent = await Promise.all(
    Array.from({ length: 8 }, async (_, index) => {
      const response = await fetch(`${publicBase}/concurrent-${index}`);
      assert.equal(response.status, 200);
      return response.text();
    }),
  );
  assert.deepEqual(
    concurrent,
    Array.from({ length: 8 }, (_, index) => `/concurrent-${index}`),
  );

  const requestBody = Buffer.alloc(700_000, "q");
  const echoed = await fetch(`${publicBase}/echo`, { method: "POST", body: requestBody });
  assert.equal(echoed.status, 200);
  assert.deepEqual(Buffer.from(await echoed.arrayBuffer()), requestBody);

  const large = await fetch(`${publicBase}/large-response`);
  assert.equal((await large.arrayBuffer()).byteLength, 700_000);

  const cookies = await fetch(`${publicBase}/cookies`);
  assert.deepEqual(cookies.headers.getSetCookie(), ["a=1; Path=/", "b=2; Path=/"]);
  assert.equal(
    cookies.headers.get("cache-control"),
    "no-store, no-cache, must-revalidate, private",
  );

  const timedOut = await fetch(`${publicBase}/slow`);
  assert.equal(timedOut.status, 504);

  const abort = new AbortController();
  const cancelled = fetch(`${publicBase}/slow`, { signal: abort.signal });
  await delay(100);
  abort.abort();
  await assert.rejects(cancelled, { name: "AbortError" });

  await stop(edge);
  edge = startEdge();
  await waitFor(
    "Worker restart",
    async () => (await fetch(`http://127.0.0.1:${edgePort}/health`)).ok,
  );
  await waitFor(
    "agent reconnect",
    async () => {
      const response = await fetch(
        `http://127.0.0.1:${edgePort}/api/v1/tunnels/${tunnelId}/status`,
        { headers: { authorization: `Bearer ${secret}` } },
      );
      return response.ok && (await response.json()).connected === true;
    },
    35_000,
  );
  assert.equal(await (await fetch(`${publicBase}/reconnected`)).text(), "/reconnected");

  console.log("e2e: all tunnel lifecycle checks passed");
} finally {
  if (agent !== undefined) await stop(agent);
  if (edge !== undefined) await stop(edge);
  await Promise.all(Array.from(children, (proc) => stop(proc)));
  upstream.close();
}
