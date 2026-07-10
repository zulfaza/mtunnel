import { FrameType, HEADER_SIZE, MAX_FRAME_PAYLOAD_BYTES, PROTOCOL_VERSION } from "./constants.js";
import { ProtocolError } from "./errors.js";

const REQUEST_ID_SIZE = 16;

const VALID_FRAME_TYPES: ReadonlySet<number> = new Set(Object.values(FrameType));

/** A decoded low-level frame: type byte, 16-byte request id, and raw payload bytes. */
export interface DecodedFrame {
  readonly type: FrameType;
  readonly requestId: Uint8Array;
  readonly payload: Uint8Array;
}

function isValidFrameType(value: number): value is FrameType {
  return VALID_FRAME_TYPES.has(value);
}

/**
 * Encode a single wire frame: version byte, type byte, 16-byte request id,
 * big-endian uint32 payload length, then the payload bytes.
 */
export function encodeFrame(
  type: FrameType,
  requestId: Uint8Array,
  payload: Uint8Array,
): Uint8Array {
  if (!isValidFrameType(type)) {
    throw new ProtocolError("unknown_frame_type", `Unknown frame type: ${String(type)}`);
  }
  if (requestId.length !== REQUEST_ID_SIZE) {
    throw new ProtocolError(
      "invalid_header",
      `Request id must be ${String(REQUEST_ID_SIZE)} bytes, got ${String(requestId.length)}`,
    );
  }
  if (payload.length > MAX_FRAME_PAYLOAD_BYTES) {
    throw new ProtocolError(
      "payload_too_large",
      `Payload of ${String(payload.length)} bytes exceeds max of ${String(MAX_FRAME_PAYLOAD_BYTES)} bytes`,
    );
  }

  const out = new Uint8Array(HEADER_SIZE + payload.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  out[0] = PROTOCOL_VERSION;
  out[1] = type;
  out.set(requestId, 2);
  view.setUint32(18, payload.length, false);
  out.set(payload, HEADER_SIZE);

  return out;
}

/**
 * Decode a single wire frame produced by {@link encodeFrame}. Throws
 * {@link ProtocolError} on any structural violation of the wire format.
 */
export function decodeFrame(data: Uint8Array): DecodedFrame {
  if (data.length < HEADER_SIZE) {
    throw new ProtocolError(
      "invalid_header",
      `Frame too short: expected at least ${String(HEADER_SIZE)} bytes, got ${String(data.length)}`,
    );
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const version = data[0];
  if (version !== PROTOCOL_VERSION) {
    throw new ProtocolError("invalid_version", `Unsupported protocol version: ${String(version)}`);
  }

  const typeByte = data[1];
  if (typeByte === undefined || !isValidFrameType(typeByte)) {
    throw new ProtocolError("unknown_frame_type", `Unknown frame type: ${String(typeByte)}`);
  }

  const requestId = data.slice(2, 18);
  const payloadLength = view.getUint32(18, false);

  if (payloadLength > MAX_FRAME_PAYLOAD_BYTES) {
    throw new ProtocolError(
      "payload_too_large",
      `Declared payload length ${String(payloadLength)} exceeds max of ${String(MAX_FRAME_PAYLOAD_BYTES)} bytes`,
    );
  }

  const actualPayloadLength = data.length - HEADER_SIZE;
  if (payloadLength !== actualPayloadLength) {
    throw new ProtocolError(
      "length_mismatch",
      `Declared payload length ${String(payloadLength)} does not match actual remaining bytes ${String(actualPayloadLength)}`,
    );
  }

  const payload = data.slice(HEADER_SIZE, HEADER_SIZE + payloadLength);

  return { type: typeByte, requestId, payload };
}
