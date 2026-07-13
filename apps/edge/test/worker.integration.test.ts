import { env, SELF } from "cloudflare:test";
import {
  decodeMessage,
  encodeMessage,
  type Message,
  type RequestStartMessage,
} from "@tunnel/protocol";
import { describe, expect, it } from "vitest";

interface FakeAgent {
  readonly ws: WebSocket;
  next(): Promise<Message>;
  close(): void;
}

function waitForMessage(ws: WebSocket): {
  readonly next: () => Promise<Message>;
  readonly close: () => void;
} {
  const queued: Message[] = [];
  const waiters: Array<(message: Message) => void> = [];
  const listener = (event: MessageEvent<unknown>): void => {
    if (!(event.data instanceof ArrayBuffer)) return;
    const message = decodeMessage(new Uint8Array(event.data));
    const waiter = waiters.shift();
    if (waiter === undefined) queued.push(message);
    else waiter(message);
  };
  ws.addEventListener("message", listener);
  return {
    next: () => {
      const message = queued.shift();
      if (message !== undefined) return Promise.resolve(message);
      return new Promise((resolve) => waiters.push(resolve));
    },
    close: () => {
      ws.removeEventListener("message", listener);
      ws.close();
    },
  };
}

async function tokenFor(tunnelId: string): Promise<string> {
  const response = await SELF.fetch("http://worker.test/api/v1/auth/token", {
    method: "POST",
    headers: { authorization: "Bearer development-token", "content-type": "application/json" },
    body: JSON.stringify({ tunnelId }),
  });
  expect(response.status).toBe(200);
  const value: unknown = await response.json();
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Record<string, unknown>).token !== "string"
  ) {
    throw new Error("token endpoint returned an invalid body");
  }
  return (value as Record<string, string>).token;
}

async function openAgent(tunnelId: string): Promise<FakeAgent> {
  const token = await tokenFor(tunnelId);
  const response = await SELF.fetch(`http://worker.test/api/v1/tunnels/${tunnelId}/connect`, {
    headers: { authorization: `Bearer ${token}`, upgrade: "websocket" },
  });
  const ws = response.webSocket;
  if (ws === null) throw new Error("connect endpoint did not upgrade");
  ws.binaryType = "arraybuffer";
  ws.accept();
  const queue = waitForMessage(ws);
  ws.send(
    encodeMessage({ kind: "hello", requestId: new Uint8Array(16), tunnelId, agentVersion: "test" }),
  );
  const helloAck = await queue.next();
  expect(helloAck.kind).toBe("helloAck");
  return { ws, next: queue.next, close: queue.close };
}

async function nextStart(agent: FakeAgent): Promise<RequestStartMessage> {
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- WebSocket frames are intentionally consumed in order.
    const message = await agent.next();
    if (message.kind === "requestStart") return message;
  }
}

async function nextKind(agent: FakeAgent, kind: Message["kind"]): Promise<Message> {
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- WebSocket frames are intentionally consumed in order.
    const message = await agent.next();
    if (message.kind === kind) return message;
  }
}

function respond(
  agent: FakeAgent,
  start: RequestStartMessage,
  body: string,
  cookies: readonly string[] = [],
): void {
  const headers: [string, string][] = [
    ["content-type", "text/plain"],
    ...cookies.map((cookie): [string, string] => ["set-cookie", cookie]),
  ];
  agent.ws.send(
    encodeMessage({
      kind: "responseStart",
      requestId: start.requestId,
      status: 200,
      headers,
      hasBody: true,
    }),
  );
  agent.ws.send(
    encodeMessage({
      kind: "responseBody",
      requestId: start.requestId,
      data: new TextEncoder().encode(body),
    }),
  );
  agent.ws.send(encodeMessage({ kind: "responseEnd", requestId: start.requestId }));
}

describe("edge Worker routes", () => {
  it("returns health", async () => {
    const response = await SELF.fetch("http://worker.test/health");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("serves landing, installer, and browser error pages", async () => {
    const landing = await SELF.fetch("http://worker.test/");
    expect(landing.headers.get("content-type")).toContain("text/html");
    const landingHtml = await landing.text();
    expect(landingHtml).toContain("Your localhost");
    expect(landingHtml).toContain('property="og:image" content="https://makarima.xyz/og.png"');
    expect(landingHtml).toContain('rel="canonical" href="https://makarima.xyz/"');
    expect(landingHtml).toContain('rel="icon" href="/favicon.ico"');
    expect(landingHtml).toContain('href="https://github.com/zulfaza/mtunnel"');
    const favicon = await SELF.fetch("http://worker.test/favicon.ico");
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get("content-type")).toBe("image/vnd.microsoft.icon");
    const manifest = await SELF.fetch("http://worker.test/site.webmanifest");
    await expect(manifest.json()).resolves.toMatchObject({
      name: "mTunnel",
      theme_color: "#fbfaf8",
    });
    const installer = await SELF.fetch("http://worker.test/install.sh");
    const installerScript = await installer.text();
    expect(installerScript).toContain("repo=zulfaza/mtunnel");
    expect(installerScript).toContain("github.com/$repo/releases/latest/download");
    expect(installerScript).toContain("openssl pkeyutl -verify");
    expect(installerScript).toContain("manifest.json.sig");
    const offline = await SELF.fetch("http://worker.test/t/no-browser-agent", {
      headers: { accept: "text/html" },
    });
    expect(offline.status).toBe(502);
    expect(offline.headers.get("content-type")).toContain("text/html");
  });

  it("rejects a bad root secret", async () => {
    const response = await SELF.fetch("http://worker.test/api/v1/auth/token", {
      method: "POST",
      headers: { authorization: "Bearer incorrect", "content-type": "application/json" },
      body: JSON.stringify({ tunnelId: "demo-tunnel" }),
    });
    expect(response.status).toBe(401);
  });

  it("mints a token from the auth endpoint", async () => {
    const response = await SELF.fetch("http://worker.test/api/v1/auth/token", {
      method: "POST",
      headers: { authorization: "Bearer development-token", "content-type": "application/json" },
      body: JSON.stringify({ tunnelId: "demo-tunnel" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ tunnelId: "demo-tunnel" });
  });

  it("creates a pending custom domain with DNS ownership records", async () => {
    const response = await SELF.fetch("http://worker.test/api/v1/domains", {
      method: "POST",
      headers: { authorization: "Bearer development-token", "content-type": "application/json" },
      body: JSON.stringify({ hostname: "app.customer.test", tunnelId: "custom-domain-test" }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      hostname: "app.customer.test",
      tunnelId: "custom-domain-test",
      status: "pending_dns",
      cname: { type: "CNAME", name: "app.customer.test", value: "cname.worker.test" },
      verification: { type: "TXT", name: "_mtunnel.app.customer.test" },
    });
    const status = await SELF.fetch("http://worker.test/api/v1/domains/app.customer.test/status", {
      headers: { authorization: "Bearer development-token" },
    });
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({ status: "pending_dns" });
  });

  it("lists, tracks usage, and deletes organization custom domains", async () => {
    const hostname = "usage.customer.test";
    const created = await SELF.fetch("http://worker.test/api/v1/domains", {
      method: "POST",
      headers: { authorization: "Bearer development-token", "content-type": "application/json" },
      body: JSON.stringify({ hostname, tunnelId: "usage-domain-test" }),
    });
    expect(created.status).toBe(201);
    await env.DOMAINS.prepare("UPDATE custom_domains SET status = 'active' WHERE hostname = ?")
      .bind(hostname)
      .run();

    await SELF.fetch(`http://${hostname}/hello`);
    const listed = await SELF.fetch("http://worker.test/api/v1/domains", {
      headers: { authorization: "Bearer development-token" },
    });
    expect(listed.status).toBe(200);
    const listValue = (await listed.json()) as { domains: Array<Record<string, unknown>> };
    expect(listValue.domains).toContainEqual(
      expect.objectContaining({
        hostname,
        tunnelId: "usage-domain-test",
        status: "active",
        lastUsedAt: expect.any(String),
      }),
    );

    const deleted = await SELF.fetch(`http://worker.test/api/v1/domains/${hostname}`, {
      method: "DELETE",
      headers: { authorization: "Bearer development-token" },
    });
    expect(deleted.status).toBe(200);
    const afterDelete = await SELF.fetch("http://worker.test/api/v1/domains", {
      headers: { authorization: "Bearer development-token" },
    });
    const afterDeleteValue = (await afterDelete.json()) as {
      domains: Array<{ hostname: string }>;
    };
    expect(afterDeleteValue.domains.some((domain) => domain.hostname === hostname)).toBe(false);
  });

  it("requires an upgrade and valid token to connect", async () => {
    const withoutUpgrade = await SELF.fetch(
      "http://worker.test/api/v1/tunnels/demo-tunnel/connect",
      { headers: { authorization: "Bearer x" } },
    );
    expect(withoutUpgrade.status).toBe(426);
    const badToken = await SELF.fetch("http://worker.test/api/v1/tunnels/demo-tunnel/connect", {
      headers: { authorization: "Bearer garbage", upgrade: "websocket" },
    });
    expect(badToken.status).toBe(401);
    const queryToken = await SELF.fetch(
      "http://worker.test/api/v1/tunnels/demo-tunnel/connect?token=garbage",
      { headers: { upgrade: "websocket" } },
    );
    expect(queryToken.status).toBe(401);
  });

  it("reports disconnected status and an offline proxy", async () => {
    const unauthorizedStatus = await SELF.fetch(
      "http://worker.test/api/v1/tunnels/no-agent/status",
    );
    expect(unauthorizedStatus.status).toBe(401);
    await tokenFor("no-agent");
    const status = await SELF.fetch("http://worker.test/api/v1/tunnels/no-agent/status", {
      headers: { authorization: "Bearer development-token" },
    });
    await expect(status.json()).resolves.toMatchObject({
      tunnelId: "no-agent",
      connected: false,
      pendingRequests: 0,
    });
    const offline = await SELF.fetch("http://worker.test/t/no-agent/test");
    expect(offline.status).toBe(502);
    await expect(offline.json()).resolves.toEqual({ error: "tunnel_offline" });
  });

  it("negative-caches an offline tunnel for five seconds", async () => {
    const tunnelId = "offline-cache-tunnel";
    const first = await SELF.fetch(`http://worker.test/t/${tunnelId}/test`);
    expect(first.status).toBe(502);
    expect(first.headers.get("cache-control")).toBe("public, max-age=5");
    const agent = await openAgent(tunnelId);
    try {
      const second = await SELF.fetch(`http://worker.test/t/${tunnelId}/test`);
      expect(second.status).toBe(502);
    } finally {
      agent.close();
    }
  });
});

describe("fake-agent proxy lifecycle", () => {
  it("streams a response and preserves Set-Cookie with cache bypass headers", async () => {
    const agent = await openAgent("lifecycle-tunnel");
    try {
      const client = SELF.fetch("http://worker.test/t/lifecycle-tunnel/hello");
      const start = await nextStart(agent);
      await nextKind(agent, "requestEnd");
      respond(agent, start, "hello", ["a=1", "b=2"]);
      const response = await client;
      expect(await response.text()).toBe("hello");
      expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
      expect(response.headers.get("cache-control")).toBe(
        "no-store, no-cache, must-revalidate, private",
      );
      expect(response.headers.get("pragma")).toBe("no-cache");
      expect(response.headers.get("expires")).toBe("0");
    } finally {
      agent.close();
    }
  });

  it("hides accept-encoding from the agent and drops upstream compression framing", async () => {
    const agent = await openAgent("encoding-tunnel");
    try {
      const client = SELF.fetch("http://worker.test/t/encoding-tunnel/asset", {
        headers: { "accept-encoding": "gzip, br, zstd" },
      });
      const start = await nextStart(agent);
      expect(start.headers.some(([name]) => name.toLowerCase() === "accept-encoding")).toBe(false);
      await nextKind(agent, "requestEnd");
      agent.ws.send(
        encodeMessage({
          kind: "responseStart",
          requestId: start.requestId,
          status: 200,
          headers: [
            ["content-type", "text/plain"],
            ["content-encoding", "gzip"],
            ["content-length", "999"],
          ],
          hasBody: true,
        }),
      );
      agent.ws.send(
        encodeMessage({
          kind: "responseBody",
          requestId: start.requestId,
          data: new TextEncoder().encode("plain body"),
        }),
      );
      agent.ws.send(encodeMessage({ kind: "responseEnd", requestId: start.requestId }));
      const response = await client;
      expect(response.headers.get("content-encoding")).toBeNull();
      expect(response.headers.get("content-length")).toBeNull();
      expect(await response.text()).toBe("plain body");
    } finally {
      agent.close();
    }
  });

  it("multiplexes interleaved requests by request id", async () => {
    const agent = await openAgent("multiplex-tunnel");
    try {
      const first = SELF.fetch("http://worker.test/t/multiplex-tunnel/first");
      const second = SELF.fetch("http://worker.test/t/multiplex-tunnel/second");
      const one = await nextStart(agent);
      const two = await nextStart(agent);
      expect(one.requestId).not.toEqual(two.requestId);
      respond(agent, two, "second");
      respond(agent, one, "first");
      await expect((await first).text()).resolves.toBe("first");
      await expect((await second).text()).resolves.toBe("second");
    } finally {
      agent.close();
    }
  });

  it("returns 504 and sends timeout cancellation", async () => {
    const agent = await openAgent("timeout-tunnel");
    try {
      const client = SELF.fetch("http://worker.test/t/timeout-tunnel/slow");
      const start = await nextStart(agent);
      const response = await client;
      expect(response.status).toBe(504);
      const cancel = await nextKind(agent, "cancel");
      expect(cancel.kind === "cancel" && cancel.reason).toBe("timeout");
      expect(cancel.kind === "cancel" && cancel.requestId).toEqual(start.requestId);
    } finally {
      agent.close();
    }
  });

  it("enforces the pending request limit", async () => {
    const agent = await openAgent("limit-tunnel");
    try {
      const first = SELF.fetch("http://worker.test/t/limit-tunnel/one");
      const second = SELF.fetch("http://worker.test/t/limit-tunnel/two");
      await nextStart(agent);
      await nextStart(agent);
      const third = await SELF.fetch("http://worker.test/t/limit-tunnel/three");
      expect(third.status).toBe(503);
      await Promise.all([first, second]);
    } finally {
      agent.close();
    }
  });
});
