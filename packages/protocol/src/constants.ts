/** Protocol v1 wire-format constants. */

/** Current protocol version. */
export const PROTOCOL_VERSION = 1;

/** Fixed frame header size in bytes. */
export const HEADER_SIZE = 22;

/** Maximum payload size for a single frame (256 KiB). Larger bodies are chunked. */
export const MAX_FRAME_PAYLOAD_BYTES = 262_144;

/** Frame type byte values. */
export const FrameType = {
  Hello: 1,
  HelloAck: 2,
  RequestStart: 3,
  RequestBody: 4,
  RequestEnd: 5,
  ResponseStart: 6,
  ResponseBody: 7,
  ResponseEnd: 8,
  Cancel: 9,
  Ping: 10,
  Pong: 11,
  Error: 12,
} as const;

export type FrameType = (typeof FrameType)[keyof typeof FrameType];

/** Reasons a Cancel frame may be sent for. */
export type CancelReason = "timeout" | "client_disconnected" | "upstream_error" | "shutdown";

export const CANCEL_REASONS: readonly CancelReason[] = [
  "timeout",
  "client_disconnected",
  "upstream_error",
  "shutdown",
];

/** Error codes carried by Error frames. */
export type ErrorCode =
  | "invalid_frame"
  | "payload_too_large"
  | "too_many_requests"
  | "unknown_request"
  | "upstream_unreachable"
  | "internal";

export const ERROR_CODES: readonly ErrorCode[] = [
  "invalid_frame",
  "payload_too_large",
  "too_many_requests",
  "unknown_request",
  "upstream_unreachable",
  "internal",
];

/** 16-byte all-zero request id used for connection-level frames. */
export const ZERO_REQUEST_ID: Uint8Array = new Uint8Array(16);
