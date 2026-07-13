import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_MAX_PENDING_REQUESTS,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_FRAME_PAYLOAD_BYTES,
} from "@tunnel/config";
import { DurableObject } from "cloudflare:workers";
import {
  chunkPayload,
  decodeMessage,
  encodeMessage,
  newRequestId,
  ProtocolError,
  requestIdToHex,
  type ResponseStartMessage,
} from "@tunnel/protocol";
import { jsonError } from "../utils/json.js";
import { headersToPairs, stripHopByHopHeaderPairs } from "../utils/headers.js";
import { logEvent } from "../utils/logging.js";
import type { Env } from "../env.js";
import { errorPage } from "../routes/(web)/pages.js";
import { capture } from "../analytics.js";

interface Attachment {
  readonly tunnelId: string;
  readonly publicOrigin: string;
  readonly devRouting: boolean;
  readonly handshakeComplete: boolean;
  readonly organizationId: string;
  readonly userId?: string;
  readonly connectionId: string;
  readonly lifetimeSeconds: number;
  readonly idleSeconds: number;
  readonly expiresAt: number;
  readonly idleAt: number;
}

interface PersistedMetadata {
  readonly tunnelId?: string;
  readonly connectedAt?: number;
  readonly agentVersion?: string;
  readonly lastHeartbeatAt?: number;
}

type StartResult =
  | { readonly kind: "response"; readonly response: ResponseStartMessage }
  | { readonly kind: "failure"; readonly status: number; readonly error: string };

interface PendingRequest {
  readonly id: Uint8Array;
  readonly idHex: string;
  readonly tunnelId: string;
  readonly method: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly routeType: string;
  readonly startedAt: number;
  readonly resolveStart: (result: StartResult) => void;
  readonly abortListener: () => void;
  readonly requestSignal: AbortSignal;
  bytesIn: number;
  bytesOut: number;
  responseStarted: boolean;
  responseEnded: boolean;
  responseStatus?: number;
  settled: boolean;
  controller?: ReadableStreamDefaultController<Uint8Array>;
  startTimer?: number;
  idleTimer?: number;
}

interface Limits {
  readonly requestTimeoutMs: number;
  readonly maxPendingRequests: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly heartbeatIntervalMs: number;
  readonly heartbeatTimeoutMs: number;
}

const CACHE_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  pragma: "no-cache",
  expires: "0",
};

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d+$/u.test(value)) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isAttachment(value: unknown): value is Attachment {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.tunnelId === "string" &&
    typeof record.publicOrigin === "string" &&
    typeof record.devRouting === "boolean" &&
    typeof record.handshakeComplete === "boolean" &&
    typeof record.organizationId === "string" &&
    (record.userId === undefined || typeof record.userId === "string") &&
    typeof record.connectionId === "string" &&
    typeof record.lifetimeSeconds === "number" &&
    typeof record.idleSeconds === "number" &&
    typeof record.expiresAt === "number" &&
    typeof record.idleAt === "number"
  );
}

function cacheResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CACHE_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function cacheJson(status: number, error: string, message?: string): Response {
  return cacheResponse(jsonError(status, error, message));
}

export class TunnelDO extends DurableObject<Env> {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly limits: Limits;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.limits = {
      requestTimeoutMs: positiveInt(env.REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
      maxPendingRequests: positiveInt(env.MAX_PENDING_REQUESTS, DEFAULT_MAX_PENDING_REQUESTS),
      maxRequestBytes: positiveInt(env.MAX_REQUEST_BYTES, DEFAULT_MAX_REQUEST_BYTES),
      maxResponseBytes: positiveInt(env.MAX_RESPONSE_BYTES, DEFAULT_MAX_RESPONSE_BYTES),
      heartbeatIntervalMs: positiveInt(env.HEARTBEAT_INTERVAL_MS, DEFAULT_HEARTBEAT_INTERVAL_MS),
      heartbeatTimeoutMs: positiveInt(env.HEARTBEAT_TIMEOUT_MS, DEFAULT_HEARTBEAT_TIMEOUT_MS),
    };
  }

  override async fetch(request: Request): Promise<Response> {
    switch (request.headers.get("x-mtunnel-op")) {
      case "connect":
        return this.handleConnect(request);
      default:
        return this.handleProxy(request);
    }
  }

  async status(requestTunnelId: string): Promise<{
    readonly tunnelId: string;
    readonly connected: boolean;
    readonly connectedAt?: number;
    readonly pendingRequests: number;
    readonly lastHeartbeatAt?: number;
  }> {
    const metadata = await this.ctx.storage.get<PersistedMetadata>("metadata");
    const connected = this.ctx
      .getWebSockets()
      .some((socket) => this.attachment(socket)?.handshakeComplete === true);
    return {
      tunnelId: metadata?.tunnelId ?? requestTunnelId,
      connected,
      ...(metadata?.connectedAt === undefined ? {} : { connectedAt: metadata.connectedAt }),
      pendingRequests: this.pending.size,
      ...(metadata?.lastHeartbeatAt === undefined
        ? {}
        : { lastHeartbeatAt: metadata.lastHeartbeatAt }),
    };
  }

  private async handleConnect(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return jsonError(426, "upgrade_required");
    }
    const tunnelId = request.headers.get("x-mtunnel-id");
    const publicOrigin = request.headers.get("x-mtunnel-public-origin");
    const organizationId = request.headers.get("x-mtunnel-organization-id");
    const userId = request.headers.get("x-mtunnel-user-id");
    const connectionId = request.headers.get("x-mtunnel-connection-id");
    const lifetimeSeconds = Number(request.headers.get("x-mtunnel-lifetime-seconds"));
    const idleSeconds = Number(request.headers.get("x-mtunnel-idle-seconds"));
    if (
      tunnelId === null ||
      publicOrigin === null ||
      organizationId === null ||
      userId === null ||
      connectionId === null ||
      !Number.isSafeInteger(lifetimeSeconds) ||
      lifetimeSeconds < 0 ||
      !Number.isSafeInteger(idleSeconds) ||
      idleSeconds < 0
    )
      return jsonError(400, "bad_request");
    for (const existing of this.ctx.getWebSockets()) existing.close(4001, "replaced");
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      tunnelId,
      publicOrigin,
      devRouting: request.headers.get("x-mtunnel-dev-routing") === "true",
      handshakeComplete: false,
      organizationId,
      userId,
      connectionId,
      lifetimeSeconds,
      idleSeconds,
      expiresAt: 0,
      idleAt: 0,
    } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  private attachment(ws: WebSocket): Attachment | null {
    const attachment: unknown = ws.deserializeAttachment();
    return isAttachment(attachment) ? attachment : null;
  }

  private connectedSocket(): WebSocket | null {
    return (
      this.ctx
        .getWebSockets()
        .find((socket) => this.attachment(socket)?.handshakeComplete === true) ?? null
    );
  }

  private send(ws: WebSocket, message: Parameters<typeof encodeMessage>[0]): boolean {
    try {
      ws.send(encodeMessage(message));
      return true;
    } catch {
      return false;
    }
  }

  private finish(pending: PendingRequest, status: number, error?: string): void {
    if (pending.settled) return;
    pending.settled = true;
    if (pending.startTimer !== undefined) clearTimeout(pending.startTimer);
    if (pending.idleTimer !== undefined) clearTimeout(pending.idleTimer);
    pending.requestSignal.removeEventListener("abort", pending.abortListener);
    this.pending.delete(pending.idHex);
    logEvent({
      event: "proxy_request",
      tunnelId: pending.tunnelId,
      requestId: pending.idHex,
      method: pending.method,
      status,
      duration: Date.now() - pending.startedAt,
      bytesIn: pending.bytesIn,
      bytesOut: pending.bytesOut,
      ...(error === undefined ? {} : { error }),
    });
    this.ctx.waitUntil(
      capture(this.env, {
        event: "tunnel request completed",
        distinctId: pending.userId,
        organizationId: pending.organizationId,
        properties: {
          $session_id: pending.sessionId,
          tunnel_id: pending.tunnelId,
          route_type: pending.routeType,
          used_custom_domain: pending.routeType === "custom_domain",
          method: pending.method,
          status,
          duration_ms: Date.now() - pending.startedAt,
          request_bytes: pending.bytesIn,
          response_bytes: pending.bytesOut,
          success: error === undefined && status < 500,
          error,
        },
      }),
    );
  }

  private cancel(
    pending: PendingRequest,
    reason: "timeout" | "client_disconnected" | "upstream_error",
  ): void {
    const socket = this.connectedSocket();
    if (socket !== null) this.send(socket, { kind: "cancel", requestId: pending.id, reason });
  }

  private failBeforeStart(pending: PendingRequest, status: number, error: string): void {
    if (pending.settled) return;
    this.finish(pending, status, error);
    pending.resolveStart({ kind: "failure", status, error });
  }

  private failStream(pending: PendingRequest, error: string): void {
    if (pending.settled) return;
    pending.controller?.error(new Error(error));
    this.finish(pending, 502, error);
  }

  private armIdleTimeout(pending: PendingRequest): void {
    if (pending.idleTimer !== undefined) clearTimeout(pending.idleTimer);
    pending.idleTimer = setTimeout(() => {
      this.cancel(pending, "timeout");
      this.failStream(pending, "timeout");
    }, this.limits.requestTimeoutMs) as unknown as number;
  }

  private async handleProxy(request: Request): Promise<Response> {
    const socket = this.connectedSocket();
    const metadata = socket === null ? null : this.attachment(socket);
    const tunnelId = request.headers.get("x-mtunnel-id");
    if (socket === null || tunnelId === null) {
      if (request.headers.get("accept")?.includes("text/html") === true)
        return errorPage(
          502,
          "tunnel_offline",
          "This tunnel is offline. Start the local agent and try again.",
        );
      return cacheJson(502, "tunnel_offline");
    }
    await this.recordActivity(socket);
    if (this.pending.size >= this.limits.maxPendingRequests)
      return cacheJson(503, "too_many_requests");

    const id = newRequestId();
    const idHex = requestIdToHex(id);
    let resolveStart!: (result: StartResult) => void;
    const startResult = new Promise<StartResult>((resolve) => {
      resolveStart = resolve;
    });
    const pending: PendingRequest = {
      id,
      idHex,
      tunnelId,
      method: request.method,
      organizationId: metadata?.organizationId ?? "unknown",
      userId: metadata?.userId ?? "unknown",
      sessionId: metadata?.connectionId ?? "unknown",
      routeType: request.headers.get("x-mtunnel-route-type") ?? "unknown",
      startedAt: Date.now(),
      resolveStart,
      requestSignal: request.signal,
      abortListener: () => {
        this.cancel(pending, "client_disconnected");
        if (pending.responseStarted) this.failStream(pending, "client_disconnected");
        else this.failBeforeStart(pending, 502, "client_disconnected");
      },
      bytesIn: 0,
      bytesOut: 0,
      responseStarted: false,
      responseEnded: false,
      settled: false,
    };
    this.pending.set(idHex, pending);
    request.signal.addEventListener("abort", pending.abortListener, { once: true });
    if (request.signal.aborted) pending.abortListener();
    pending.startTimer = setTimeout(() => {
      this.cancel(pending, "timeout");
      this.failBeforeStart(pending, 504, "timeout");
    }, this.limits.requestTimeoutMs) as unknown as number;

    const headers = stripHopByHopHeaderPairs(
      headersToPairs(request.headers).filter(([name]: [string, string]) => {
        const lower = name.toLowerCase();
        return (
          !lower.startsWith("x-mtunnel-") &&
          !lower.startsWith("x-forwarded-") &&
          lower !== "x-tunnel-id"
        );
      }),
    );
    const url = new URL(request.url);
    headers.push(["x-forwarded-host", request.headers.get("host") ?? url.host]);
    const clientIp = request.headers.get("cf-connecting-ip");
    if (clientIp !== null) headers.push(["x-forwarded-for", clientIp]);
    headers.push(["x-forwarded-proto", url.protocol.slice(0, -1)]);
    headers.push(["x-tunnel-id", tunnelId]);
    const hasBody = request.body !== null;
    if (
      !this.send(socket, {
        kind: "requestStart",
        requestId: id,
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers,
        hasBody,
      })
    ) {
      this.failBeforeStart(pending, 502, "upstream_error");
    } else {
      const bodyFailure = await this.streamRequestBody(request, socket, pending);
      if (bodyFailure !== null) return cacheJson(bodyFailure.status, bodyFailure.error);
    }

    const result = await startResult;
    if (result.kind === "failure") return cacheJson(result.status, result.error);
    return this.responseFromStart(result.response, pending);
  }

  private async streamRequestBody(
    request: Request,
    socket: WebSocket,
    pending: PendingRequest,
  ): Promise<{ readonly status: number; readonly error: string } | null> {
    if (request.body !== null) {
      const reader = request.body.getReader();
      try {
        for (;;) {
          // oxlint-disable-next-line no-await-in-loop -- a ReadableStream must be consumed serially.
          const next = await reader.read();
          if (next.done) break;
          pending.bytesIn += next.value.byteLength;
          if (pending.bytesIn > this.limits.maxRequestBytes) {
            this.cancel(pending, "upstream_error");
            this.send(socket, { kind: "requestEnd", requestId: pending.id });
            this.failBeforeStart(pending, 413, "payload_too_large");
            return { status: 413, error: "payload_too_large" };
          }
          for (const chunk of chunkPayload(next.value)) {
            if (!this.send(socket, { kind: "requestBody", requestId: pending.id, data: chunk })) {
              this.failBeforeStart(pending, 502, "upstream_error");
              return { status: 502, error: "upstream_error" };
            }
          }
        }
      } catch {
        this.cancel(pending, "client_disconnected");
        this.send(socket, { kind: "requestEnd", requestId: pending.id });
        this.failBeforeStart(pending, 502, "client_disconnected");
        return { status: 502, error: "client_disconnected" };
      } finally {
        reader.releaseLock();
      }
    }
    if (!pending.settled && !this.send(socket, { kind: "requestEnd", requestId: pending.id })) {
      this.failBeforeStart(pending, 502, "upstream_error");
      return { status: 502, error: "upstream_error" };
    }
    return null;
  }

  private responseFromStart(message: ResponseStartMessage, pending: PendingRequest): Response {
    const headers = new Headers();
    for (const [name, value] of stripHopByHopHeaderPairs(message.headers)) {
      // Drop upstream compression framing: workerd re-encodes the body for the
      // eyeball, so a stale content-encoding/-length would double-encode or
      // mismatch the bytes we actually stream.
      const normalized = name.toLowerCase();
      if (normalized === "content-encoding" || normalized === "content-length") continue;
      headers.append(name, value);
    }
    for (const [name, value] of Object.entries(CACHE_HEADERS)) headers.set(name, value);
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        pending.controller = controller;
        if (pending.responseEnded) {
          controller.close();
          this.finish(pending, pending.responseStatus ?? message.status);
        } else {
          this.armIdleTimeout(pending);
        }
      },
      cancel: () => {
        this.cancel(pending, "client_disconnected");
        this.finish(pending, message.status, "client_disconnected");
      },
    });
    return new Response(body, { status: message.status, headers });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string") {
      this.send(ws, {
        kind: "error",
        requestId: new Uint8Array(16),
        code: "invalid_frame",
        message: "binary frames required",
      });
      return;
    }
    let decoded: ReturnType<typeof decodeMessage>;
    try {
      decoded = decodeMessage(new Uint8Array(message));
    } catch (error: unknown) {
      const detail = error instanceof ProtocolError ? error.message : "invalid frame";
      this.send(ws, {
        kind: "error",
        requestId: new Uint8Array(16),
        code: "invalid_frame",
        message: detail,
      });
      logEvent({ event: "protocol_error", error: detail });
      return;
    }
    if (decoded.kind === "hello") {
      await this.handleHello(ws, decoded.tunnelId, decoded.agentVersion);
      return;
    }
    if (decoded.kind === "ping") {
      this.send(ws, { kind: "pong" });
      const attachment = this.attachment(ws);
      if (attachment !== null) {
        await this.ctx.storage.put("metadata", {
          ...(await this.ctx.storage.get<PersistedMetadata>("metadata")),
          tunnelId: attachment.tunnelId,
          lastHeartbeatAt: Date.now(),
        } satisfies PersistedMetadata);
      }
      return;
    }
    if (
      decoded.kind === "responseStart" ||
      decoded.kind === "responseBody" ||
      decoded.kind === "responseEnd" ||
      decoded.kind === "error" ||
      decoded.kind === "cancel"
    ) {
      const pending = this.pending.get(requestIdToHex(decoded.requestId));
      if (pending === undefined) {
        this.send(ws, {
          kind: "error",
          requestId: decoded.requestId,
          code: "unknown_request",
          message: "unknown request",
        });
        return;
      }
      this.handleRequestMessage(pending, decoded);
      return;
    }
    this.send(ws, {
      kind: "error",
      requestId: new Uint8Array(16),
      code: "invalid_frame",
      message: "unexpected frame",
    });
    logEvent({ event: "protocol_error", error: "unexpected frame" });
  }

  private handleRequestMessage(
    pending: PendingRequest,
    message: Exclude<ReturnType<typeof decodeMessage>, { readonly kind: "hello" | "ping" }>,
  ): void {
    if (message.kind === "responseStart") {
      if (pending.responseStarted) return;
      pending.responseStarted = true;
      pending.responseStatus = message.status;
      if (pending.startTimer !== undefined) clearTimeout(pending.startTimer);
      pending.resolveStart({ kind: "response", response: message });
      return;
    }
    if (message.kind === "responseBody") {
      if (!pending.responseStarted || pending.controller === undefined) return;
      pending.bytesOut += message.data.byteLength;
      if (pending.bytesOut > this.limits.maxResponseBytes) {
        this.cancel(pending, "upstream_error");
        this.failStream(pending, "payload_too_large");
        return;
      }
      pending.controller.enqueue(message.data);
      this.armIdleTimeout(pending);
      return;
    }
    if (message.kind === "responseEnd") {
      pending.responseEnded = true;
      if (pending.controller !== undefined) {
        pending.controller.close();
        this.finish(pending, pending.responseStatus ?? 200);
      }
      return;
    }
    if (message.kind === "error") {
      if (pending.responseStarted) this.failStream(pending, "upstream_error");
      else this.failBeforeStart(pending, 502, "upstream_error");
      return;
    }
    if (message.kind === "cancel") {
      if (pending.responseStarted) this.failStream(pending, "upstream_error");
      else this.failBeforeStart(pending, 502, "upstream_error");
    }
  }

  private async handleHello(ws: WebSocket, tunnelId: string, agentVersion: string): Promise<void> {
    const attachment = this.attachment(ws);
    if (attachment === null || tunnelId !== attachment.tunnelId) {
      ws.close(4002, "tunnel mismatch");
      return;
    }
    const publicUrl = attachment.devRouting
      ? `${attachment.publicOrigin}/t/${tunnelId}`
      : `https://${tunnelId}.${this.env.TUNNEL_DOMAIN}`;
    const now = Date.now();
    this.send(ws, {
      kind: "helloAck",
      requestId: new Uint8Array(16),
      tunnelId,
      publicUrl,
      heartbeatIntervalMs: this.limits.heartbeatIntervalMs,
      heartbeatTimeoutMs: this.limits.heartbeatTimeoutMs,
      requestTimeoutMs: this.limits.requestTimeoutMs,
      maxPayloadBytes: MAX_FRAME_PAYLOAD_BYTES,
    });
    const activeAttachment = {
      ...attachment,
      handshakeComplete: true,
      expiresAt: attachment.lifetimeSeconds === 0 ? 0 : now + attachment.lifetimeSeconds * 1000,
      idleAt: attachment.idleSeconds === 0 ? 0 : now + attachment.idleSeconds * 1000,
    } satisfies Attachment;
    ws.serializeAttachment(activeAttachment);
    await this.scheduleAccessAlarm(activeAttachment);
    await this.ctx.storage.put("metadata", {
      tunnelId,
      connectedAt: now,
      agentVersion,
      lastHeartbeatAt: now,
    } satisfies PersistedMetadata);
  }

  override async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const attachment = this.attachment(ws);
    if (attachment !== null) {
      await this.env.REGISTRY.getByName("global").releaseConnection(
        attachment.tunnelId,
        attachment.organizationId,
        attachment.connectionId,
      );
    }
    this.failAll("upstream_error");
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    let nextDeadline = 0;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket);
      if (attachment === null) continue;
      if (attachment.expiresAt > 0 && attachment.expiresAt <= now)
        socket.close(4003, "tunnel time limit reached");
      else if (attachment.idleAt > 0 && attachment.idleAt <= now)
        socket.close(4003, "tunnel idle limit reached");
      else {
        const deadline = this.accessDeadline(attachment);
        if (deadline > 0 && (nextDeadline === 0 || deadline < nextDeadline))
          nextDeadline = deadline;
      }
    }
    if (nextDeadline > 0) await this.ctx.storage.setAlarm(nextDeadline);
  }

  private async recordActivity(ws: WebSocket): Promise<void> {
    const attachment = this.attachment(ws);
    if (attachment === null || attachment.idleSeconds === 0) return;
    const activeAttachment = {
      ...attachment,
      idleAt: Date.now() + attachment.idleSeconds * 1000,
    } satisfies Attachment;
    ws.serializeAttachment(activeAttachment);
    await this.scheduleAccessAlarm(activeAttachment);
  }

  private async scheduleAccessAlarm(attachment: Attachment): Promise<void> {
    const deadline = this.accessDeadline(attachment);
    if (deadline === 0) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(deadline);
  }

  private accessDeadline(attachment: Attachment): number {
    const deadlines = [attachment.expiresAt, attachment.idleAt].filter((deadline) => deadline > 0);
    return deadlines.length === 0 ? 0 : Math.min(...deadlines);
  }

  override webSocketError(_ws: WebSocket, error: unknown): void {
    const detail = error instanceof Error ? error.message : "websocket error";
    logEvent({ event: "websocket_error", error: detail });
    this.failAll("upstream_error");
  }

  private failAll(error: string): void {
    for (const pending of this.pending.values()) {
      if (pending.responseStarted) this.failStream(pending, error);
      else this.failBeforeStart(pending, 502, error);
    }
  }
}
