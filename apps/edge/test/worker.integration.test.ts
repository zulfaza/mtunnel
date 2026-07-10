import { SELF } from "cloudflare:test";
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
    expect(await landing.text()).toContain("Your localhost");
    const installer = await SELF.fetch("http://worker.test/install.sh");
    expect(await installer.text()).toContain("github.com/$repo/releases/latest/download");
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
