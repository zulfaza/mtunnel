import { Schema } from "effect";
import { type CancelReason, type ErrorCode, FrameType, ZERO_REQUEST_ID } from "./constants.js";
import { decodeFrame, encodeFrame } from "./frame.js";
import { ProtocolError } from "./errors.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const EMPTY_PAYLOAD = new Uint8Array(0);

/** Ordered [name, value] header pairs, preserving duplicates (e.g. Set-Cookie). */
export type HeaderPairs = [string, string][];

const HeaderPair = Schema.Tuple([Schema.String, Schema.String]);
const HeaderPairsSchema = Schema.Array(HeaderPair);
const CancelReasonSchema = Schema.Literals([
  "timeout",
  "client_disconnected",
  "upstream_error",
  "shutdown",
]);
const ErrorCodeSchema = Schema.Literals([
  "invalid_frame",
  "payload_too_large",
  "too_many_requests",
  "unknown_request",
  "upstream_unreachable",
  "internal",
]);

const HelloPayload = Schema.Struct({ tunnelId: Schema.String, agentVersion: Schema.String });
const HelloAckPayload = Schema.Struct({
  tunnelId: Schema.String,
  publicUrl: Schema.String,
  heartbeatIntervalMs: Schema.Number,
  heartbeatTimeoutMs: Schema.Number,
  requestTimeoutMs: Schema.Number,
  maxPayloadBytes: Schema.Number,
});
const RequestStartPayload = Schema.Struct({
  method: Schema.String,
  path: Schema.String,
  headers: HeaderPairsSchema,
  hasBody: Schema.Boolean,
});
const ResponseStartPayload = Schema.Struct({
  status: Schema.Number,
  headers: HeaderPairsSchema,
  hasBody: Schema.Boolean,
});
const CancelPayload = Schema.Struct({ reason: CancelReasonSchema });
const ErrorPayload = Schema.Struct({ code: ErrorCodeSchema, message: Schema.String });

const decodeHelloPayload = Schema.decodeUnknownSync(HelloPayload);
const decodeHelloAckPayload = Schema.decodeUnknownSync(HelloAckPayload);
const decodeRequestStartPayload = Schema.decodeUnknownSync(RequestStartPayload);
const decodeResponseStartPayload = Schema.decodeUnknownSync(ResponseStartPayload);
const decodeCancelPayload = Schema.decodeUnknownSync(CancelPayload);
const decodeErrorPayload = Schema.decodeUnknownSync(ErrorPayload);

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

function decodeJsonPayload<T>(decode: (input: unknown) => T, payload: Uint8Array): T {
  try {
    return decode(JSON.parse(decoder.decode(payload)));
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    const message = error instanceof Error ? error.message : "Invalid JSON payload";
    throw new ProtocolError({ code: "invalid_json", message });
  }
}

function mutableHeaders(headers: ReadonlyArray<readonly [string, string]>): HeaderPairs {
  return headers.map(([name, value]): [string, string] => [name, value]);
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
      const value = decodeJsonPayload(decodeHelloPayload, payload);
      return {
        kind: "hello",
        requestId,
        tunnelId: value.tunnelId,
        agentVersion: value.agentVersion,
      };
    }
    case FrameType.HelloAck: {
      const value = decodeJsonPayload(decodeHelloAckPayload, payload);
      return { kind: "helloAck", requestId, ...value };
    }
    case FrameType.RequestStart: {
      const value = decodeJsonPayload(decodeRequestStartPayload, payload);
      return { kind: "requestStart", requestId, ...value, headers: mutableHeaders(value.headers) };
    }
    case FrameType.RequestBody:
      return { kind: "requestBody", requestId, data: payload };
    case FrameType.RequestEnd:
      return { kind: "requestEnd", requestId };
    case FrameType.ResponseStart: {
      const value = decodeJsonPayload(decodeResponseStartPayload, payload);
      return { kind: "responseStart", requestId, ...value, headers: mutableHeaders(value.headers) };
    }
    case FrameType.ResponseBody:
      return { kind: "responseBody", requestId, data: payload };
    case FrameType.ResponseEnd:
      return { kind: "responseEnd", requestId };
    case FrameType.Cancel: {
      const value = decodeJsonPayload(decodeCancelPayload, payload);
      return { kind: "cancel", requestId, reason: value.reason };
    }
    case FrameType.Ping:
      return { kind: "ping" };
    case FrameType.Pong:
      return { kind: "pong" };
    case FrameType.Error: {
      const value = decodeJsonPayload(decodeErrorPayload, payload);
      return { kind: "error", requestId, ...value };
    }
  }
}
