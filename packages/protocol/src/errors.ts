/** Error codes thrown by the low-level frame codec and typed message layer. */
export type ProtocolErrorCode =
  | "invalid_version"
  | "unknown_frame_type"
  | "invalid_header"
  | "length_mismatch"
  | "payload_too_large"
  | "invalid_json";

/** Thrown by {@link encodeFrame}/{@link decodeFrame} and the typed message layer on any wire-format violation. */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}
