import {
  CANCEL_REASONS,
  type CancelReason,
  ERROR_CODES,
  type ErrorCode,
  FrameType,
  ZERO_REQUEST_ID,
} from "./constants.js";
import { decodeFrame, encodeFrame } from "./frame.js";
import { ProtocolError } from "./errors.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

const EMPTY_PAYLOAD = new Uint8Array(0);

/** Ordered [name, value] header pairs, preserving duplicates (e.g. Set-Cookie). */
export type HeaderPairs = [string, string][];

export interface HelloMessage {
  readonly kind: "hello";
  readonly requestId: Uint8Array;
  readonly tunnelId: string;
  readonly agentVersion: string;
}

export interface HelloAckMessage {
  readonly kind: "helloAck";
  readonly requestId: Uint8Array;
  readonly tunnelId: string;
  readonly publicUrl: string;
  readonly heartbeatIntervalMs: number;
  readonly heartbeatTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly maxPayloadBytes: number;
}

export interface RequestStartMessage {
  readonly kind: "requestStart";
  readonly requestId: Uint8Array;
  readonly method: string;
  readonly path: string;
  readonly headers: HeaderPairs;
  readonly hasBody: boolean;
}

export interface RequestBodyMessage {
  readonly kind: "requestBody";
  readonly requestId: Uint8Array;
  readonly data: Uint8Array;
}

export interface RequestEndMessage {
  readonly kind: "requestEnd";
  readonly requestId: Uint8Array;
}

export interface ResponseStartMessage {
  readonly kind: "responseStart";
  readonly requestId: Uint8Array;
  readonly status: number;
  readonly headers: HeaderPairs;
  readonly hasBody: boolean;
}

export interface ResponseBodyMessage {
  readonly kind: "responseBody";
  readonly requestId: Uint8Array;
  readonly data: Uint8Array;
}

export interface ResponseEndMessage {
  readonly kind: "responseEnd";
  readonly requestId: Uint8Array;
}

export interface CancelMessage {
  readonly kind: "cancel";
  readonly requestId: Uint8Array;
  readonly reason: CancelReason;
}

export interface PingMessage {
  readonly kind: "ping";
}

export interface PongMessage {
  readonly kind: "pong";
}

export interface ErrorMessage {
  readonly kind: "error";
  readonly requestId: Uint8Array;
  readonly code: ErrorCode;
  readonly message: string;
}

/** Discriminated union of every typed protocol v1 message. */
export type Message =
  | HelloMessage
  | HelloAckMessage
  | RequestStartMessage
  | RequestBodyMessage
  | RequestEndMessage
  | ResponseStartMessage
  | ResponseBodyMessage
  | ResponseEndMessage
  | CancelMessage
  | PingMessage
  | PongMessage
  | ErrorMessage;

function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(payload: Uint8Array): Record<string, unknown> {
  let text: string;
  try {
    text = decoder.decode(payload);
  } catch {
    throw new ProtocolError("invalid_json", "Payload is not valid UTF-8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProtocolError("invalid_json", "Payload is not valid JSON");
  }

  if (!isRecord(parsed)) {
    throw new ProtocolError("invalid_json", "JSON payload must be an object");
  }
  return parsed;
}

function requireString(obj: Record<string, unknown>, field: string): string {
  const value = obj[field];
  if (typeof value !== "string") {
    throw new ProtocolError("invalid_json", `Field "${field}" must be a string`);
  }
  return value;
}

function requireNumber(obj: Record<string, unknown>, field: string): number {
  const value = obj[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProtocolError("invalid_json", `Field "${field}" must be a finite number`);
  }
  return value;
}

function requireBoolean(obj: Record<string, unknown>, field: string): boolean {
  const value = obj[field];
  if (typeof value !== "boolean") {
    throw new ProtocolError("invalid_json", `Field "${field}" must be a boolean`);
  }
  return value;
}

function requireHeaderPairs(obj: Record<string, unknown>, field: string): HeaderPairs {
  const value = obj[field];
  if (!Array.isArray(value)) {
    throw new ProtocolError("invalid_json", `Field "${field}" must be an array`);
  }
  const pairs: HeaderPairs = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new ProtocolError("invalid_json", `Field "${field}" must contain [name, value] pairs`);
    }
    const [name, headerValue]: unknown[] = entry;
    if (typeof name !== "string" || typeof headerValue !== "string") {
      throw new ProtocolError(
        "invalid_json",
        `Field "${field}" must contain string [name, value] pairs`,
      );
    }
    pairs.push([name, headerValue]);
  }
  return pairs;
}

function requireCancelReason(obj: Record<string, unknown>, field: string): CancelReason {
  const value = obj[field];
  if (typeof value !== "string" || !(CANCEL_REASONS as readonly string[]).includes(value)) {
    throw new ProtocolError("invalid_json", `Field "${field}" must be a valid cancel reason`);
  }
  return value as CancelReason;
}

function requireErrorCode(obj: Record<string, unknown>, field: string): ErrorCode {
  const value = obj[field];
  if (typeof value !== "string" || !(ERROR_CODES as readonly string[]).includes(value)) {
    throw new ProtocolError("invalid_json", `Field "${field}" must be a valid error code`);
  }
  return value as ErrorCode;
}

/** Encode a typed {@link Message} into a wire frame. */
export function encodeMessage(msg: Message): Uint8Array {
  switch (msg.kind) {
    case "hello":
      return encodeFrame(
        FrameType.Hello,
        msg.requestId,
        encodeJson({ tunnelId: msg.tunnelId, agentVersion: msg.agentVersion }),
      );
    case "helloAck":
      return encodeFrame(
        FrameType.HelloAck,
        msg.requestId,
        encodeJson({
          tunnelId: msg.tunnelId,
          publicUrl: msg.publicUrl,
          heartbeatIntervalMs: msg.heartbeatIntervalMs,
          heartbeatTimeoutMs: msg.heartbeatTimeoutMs,
          requestTimeoutMs: msg.requestTimeoutMs,
          maxPayloadBytes: msg.maxPayloadBytes,
        }),
      );
    case "requestStart":
      return encodeFrame(
        FrameType.RequestStart,
        msg.requestId,
        encodeJson({
          method: msg.method,
          path: msg.path,
          headers: msg.headers,
          hasBody: msg.hasBody,
        }),
      );
    case "requestBody":
      return encodeFrame(FrameType.RequestBody, msg.requestId, msg.data);
    case "requestEnd":
      return encodeFrame(FrameType.RequestEnd, msg.requestId, EMPTY_PAYLOAD);
    case "responseStart":
      return encodeFrame(
        FrameType.ResponseStart,
        msg.requestId,
        encodeJson({ status: msg.status, headers: msg.headers, hasBody: msg.hasBody }),
      );
    case "responseBody":
      return encodeFrame(FrameType.ResponseBody, msg.requestId, msg.data);
    case "responseEnd":
      return encodeFrame(FrameType.ResponseEnd, msg.requestId, EMPTY_PAYLOAD);
    case "cancel":
      return encodeFrame(FrameType.Cancel, msg.requestId, encodeJson({ reason: msg.reason }));
    case "ping":
      return encodeFrame(FrameType.Ping, ZERO_REQUEST_ID, EMPTY_PAYLOAD);
    case "pong":
      return encodeFrame(FrameType.Pong, ZERO_REQUEST_ID, EMPTY_PAYLOAD);
    case "error":
      return encodeFrame(
        FrameType.Error,
        msg.requestId,
        encodeJson({ code: msg.code, message: msg.message }),
      );
  }
}

/** Decode a wire frame into a typed {@link Message}. */
export function decodeMessage(data: Uint8Array): Message {
  const { type, requestId, payload } = decodeFrame(data);

  switch (type) {
    case FrameType.Hello: {
      const obj = parseJsonRecord(payload);
      return {
        kind: "hello",
        requestId,
        tunnelId: requireString(obj, "tunnelId"),
        agentVersion: requireString(obj, "agentVersion"),
      };
    }
    case FrameType.HelloAck: {
      const obj = parseJsonRecord(payload);
      return {
        kind: "helloAck",
        requestId,
        tunnelId: requireString(obj, "tunnelId"),
        publicUrl: requireString(obj, "publicUrl"),
        heartbeatIntervalMs: requireNumber(obj, "heartbeatIntervalMs"),
        heartbeatTimeoutMs: requireNumber(obj, "heartbeatTimeoutMs"),
        requestTimeoutMs: requireNumber(obj, "requestTimeoutMs"),
        maxPayloadBytes: requireNumber(obj, "maxPayloadBytes"),
      };
    }
    case FrameType.RequestStart: {
      const obj = parseJsonRecord(payload);
      return {
        kind: "requestStart",
        requestId,
        method: requireString(obj, "method"),
        path: requireString(obj, "path"),
        headers: requireHeaderPairs(obj, "headers"),
        hasBody: requireBoolean(obj, "hasBody"),
      };
    }
    case FrameType.RequestBody:
      return { kind: "requestBody", requestId, data: payload };
    case FrameType.RequestEnd:
      return { kind: "requestEnd", requestId };
    case FrameType.ResponseStart: {
      const obj = parseJsonRecord(payload);
      return {
        kind: "responseStart",
        requestId,
        status: requireNumber(obj, "status"),
        headers: requireHeaderPairs(obj, "headers"),
        hasBody: requireBoolean(obj, "hasBody"),
      };
    }
    case FrameType.ResponseBody:
      return { kind: "responseBody", requestId, data: payload };
    case FrameType.ResponseEnd:
      return { kind: "responseEnd", requestId };
    case FrameType.Cancel: {
      const obj = parseJsonRecord(payload);
      return { kind: "cancel", requestId, reason: requireCancelReason(obj, "reason") };
    }
    case FrameType.Ping:
      return { kind: "ping" };
    case FrameType.Pong:
      return { kind: "pong" };
    case FrameType.Error: {
      const obj = parseJsonRecord(payload);
      return {
        kind: "error",
        requestId,
        code: requireErrorCode(obj, "code"),
        message: requireString(obj, "message"),
      };
    }
  }
}
