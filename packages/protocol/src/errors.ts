import { Data } from "effect";

/** Error codes thrown by the low-level frame codec and typed message layer. */
export type ProtocolErrorCode =
  | "invalid_version"
  | "unknown_frame_type"
  | "invalid_header"
  | "length_mismatch"
  | "payload_too_large"
  | "invalid_json";

/** Thrown by {@link encodeFrame}/{@link decodeFrame} and the typed message layer on any wire-format violation. */
export class ProtocolError extends Data.TaggedError("ProtocolError")<{
  readonly code: ProtocolErrorCode;
  readonly message: string;
}> {}
