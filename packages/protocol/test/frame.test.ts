import { describe, expect, it } from "vitest";
import {
  FrameType,
  HEADER_SIZE,
  MAX_FRAME_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  ProtocolError,
  ZERO_REQUEST_ID,
  decodeFrame,
  encodeFrame,
} from "../src/index.js";

function requestId(fill: number): Uint8Array {
  return new Uint8Array(16).fill(fill);
}

describe("encodeFrame / decodeFrame", () => {
  it("round-trips a simple frame", () => {
    const payload = new TextEncoder().encode("hello");
    const id = requestId(7);
    const encoded = encodeFrame(FrameType.RequestBody, id, payload);

    expect(encoded.length).toBe(HEADER_SIZE + payload.length);
    expect(encoded[0]).toBe(PROTOCOL_VERSION);
    expect(encoded[1]).toBe(FrameType.RequestBody);

    const decoded = decodeFrame(encoded);
    expect(decoded.type).toBe(FrameType.RequestBody);
    expect(decoded.requestId).toEqual(id);
    expect(decoded.payload).toEqual(payload);
  });

  it("round-trips an empty payload", () => {
    const encoded = encodeFrame(FrameType.Ping, ZERO_REQUEST_ID, new Uint8Array(0));
    expect(encoded.length).toBe(HEADER_SIZE);
    const decoded = decodeFrame(encoded);
    expect(decoded.payload.length).toBe(0);
  });

  it("encodes payload length as big-endian uint32", () => {
    const payload = new Uint8Array(300);
    const encoded = encodeFrame(FrameType.RequestBody, ZERO_REQUEST_ID, payload);
    const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    expect(view.getUint32(18, false)).toBe(300);
  });

  it("rejects an oversize payload on encode", () => {
    const payload = new Uint8Array(MAX_FRAME_PAYLOAD_BYTES + 1);
    expect(() => encodeFrame(FrameType.RequestBody, ZERO_REQUEST_ID, payload)).toThrowError(
      ProtocolError,
    );
    try {
      encodeFrame(FrameType.RequestBody, ZERO_REQUEST_ID, payload);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProtocolError);
      expect((err as ProtocolError).code).toBe("payload_too_large");
    }
  });

  it("accepts a payload exactly at the max size", () => {
    const payload = new Uint8Array(MAX_FRAME_PAYLOAD_BYTES);
    const encoded = encodeFrame(FrameType.RequestBody, ZERO_REQUEST_ID, payload);
    expect(decodeFrame(encoded).payload.length).toBe(MAX_FRAME_PAYLOAD_BYTES);
  });

  it("rejects an unknown frame type on encode", () => {
    expect(() => encodeFrame(99 as FrameType, ZERO_REQUEST_ID, new Uint8Array(0))).toThrowError(
      ProtocolError,
    );
  });

  it("rejects a request id that is not 16 bytes on encode", () => {
    expect(() => encodeFrame(FrameType.Ping, new Uint8Array(4), new Uint8Array(0))).toThrowError(
      ProtocolError,
    );
  });

  it("rejects a wrong protocol version on decode", () => {
    const encoded = encodeFrame(FrameType.Ping, ZERO_REQUEST_ID, new Uint8Array(0));
    encoded[0] = 2;
    expect(() => decodeFrame(encoded)).toThrowError(ProtocolError);
    try {
      decodeFrame(encoded);
      expect.unreachable();
    } catch (err) {
      expect((err as ProtocolError).code).toBe("invalid_version");
    }
  });

  it("rejects an unknown frame type on decode", () => {
    const encoded = encodeFrame(FrameType.Ping, ZERO_REQUEST_ID, new Uint8Array(0));
    encoded[1] = 99;
    try {
      decodeFrame(encoded);
      expect.unreachable();
    } catch (err) {
      expect((err as ProtocolError).code).toBe("unknown_frame_type");
    }
  });

  it("rejects a header shorter than 22 bytes", () => {
    const short = new Uint8Array(21);
    short[0] = PROTOCOL_VERSION;
    short[1] = FrameType.Ping;
    try {
      decodeFrame(short);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProtocolError);
      expect((err as ProtocolError).code).toBe("invalid_header");
    }
  });

  it("rejects a declared payload length that does not match actual bytes", () => {
    const encoded = encodeFrame(FrameType.RequestBody, ZERO_REQUEST_ID, new Uint8Array([1, 2, 3]));
    const truncated = encoded.slice(0, encoded.length - 1);
    try {
      decodeFrame(truncated);
      expect.unreachable();
    } catch (err) {
      expect((err as ProtocolError).code).toBe("length_mismatch");
    }
  });

  it("rejects a declared payload length larger than the max on decode", () => {
    const header = new Uint8Array(HEADER_SIZE);
    header[0] = PROTOCOL_VERSION;
    header[1] = FrameType.RequestBody;
    const view = new DataView(header.buffer);
    view.setUint32(18, MAX_FRAME_PAYLOAD_BYTES + 1, false);
    try {
      decodeFrame(header);
      expect.unreachable();
    } catch (err) {
      expect((err as ProtocolError).code).toBe("payload_too_large");
    }
  });
});
