import { describe, expect, it } from "vitest";
import {
  FrameType,
  MAX_FRAME_PAYLOAD_BYTES,
  type Message,
  ProtocolError,
  ZERO_REQUEST_ID,
  decodeMessage,
  encodeFrame,
  encodeMessage,
  newRequestId,
} from "../src/index.js";

function roundtrip(msg: Message): Message {
  return decodeMessage(encodeMessage(msg));
}

describe("encodeMessage / decodeMessage roundtrip", () => {
  it("hello", () => {
    const msg: Message = {
      kind: "hello",
      requestId: ZERO_REQUEST_ID,
      tunnelId: "t1",
      agentVersion: "1.0.0",
    };
    expect(roundtrip(msg)).toEqual(msg);
  });

  it("helloAck", () => {
    const msg: Message = {
      kind: "helloAck",
      requestId: ZERO_REQUEST_ID,
      tunnelId: "t1",
      publicUrl: "https://t1.example.dev",
      heartbeatIntervalMs: 20_000,
      heartbeatTimeoutMs: 60_000,
      requestTimeoutMs: 30_000,
      maxPayloadBytes: MAX_FRAME_PAYLOAD_BYTES,
    };
    expect(roundtrip(msg)).toEqual(msg);
  });

  it("requestStart", () => {
    const msg: Message = {
      kind: "requestStart",
      requestId: newRequestId(),
      method: "POST",
      path: "/api/things?x=1",
      headers: [
        ["Content-Type", "application/json"],
        ["X-Dup", "1"],
        ["X-Dup", "2"],
      ],
      hasBody: true,
    };
    expect(roundtrip(msg)).toEqual(msg);
  });

  it("requestBody", () => {
    const msg: Message = {
      kind: "requestBody",
      requestId: newRequestId(),
      data: new Uint8Array([1, 2, 3, 4]),
    };
    expect(roundtrip(msg)).toEqual(msg);
  });

  it("requestEnd", () => {
    const msg: Message = { kind: "requestEnd", requestId: newRequestId() };
    expect(roundtrip(msg)).toEqual(msg);
  });

  it("responseStart", () => {
    const msg: Message = {
      kind: "responseStart",
      requestId: newRequestId(),
      status: 404,
      headers: [
        ["Set-Cookie", "a=1"],
        ["Set-Cookie", "b=2"],
      ],
      hasBody: false,
    };
    expect(roundtrip(msg)).toEqual(msg);
  });

  it("responseBody", () => {
    const msg: Message = {
      kind: "responseBody",
      requestId: newRequestId(),
      data: new Uint8Array([9, 8, 7]),
    };
    expect(roundtrip(msg)).toEqual(msg);
  });

  it("responseEnd", () => {
    const msg: Message = { kind: "responseEnd", requestId: newRequestId() };
    expect(roundtrip(msg)).toEqual(msg);
  });

  it.each(["timeout", "client_disconnected", "upstream_error", "shutdown"] as const)(
    "cancel (%s)",
    (reason) => {
      const msg: Message = { kind: "cancel", requestId: newRequestId(), reason };
      expect(roundtrip(msg)).toEqual(msg);
    },
  );

  it("ping", () => {
    const msg: Message = { kind: "ping" };
    expect(roundtrip(msg)).toEqual(msg);
  });

  it("pong", () => {
    const msg: Message = { kind: "pong" };
    expect(roundtrip(msg)).toEqual(msg);
  });

  it("error", () => {
    const msg: Message = {
      kind: "error",
      requestId: newRequestId(),
      code: "upstream_unreachable",
      message: "connection refused",
    };
    expect(roundtrip(msg)).toEqual(msg);
  });

  it("ping/pong always encode a zero request id", () => {
    const pingEncoded = encodeMessage({ kind: "ping" });
    expect(pingEncoded.slice(2, 18)).toEqual(ZERO_REQUEST_ID);
    const pongEncoded = encodeMessage({ kind: "pong" });
    expect(pongEncoded.slice(2, 18)).toEqual(ZERO_REQUEST_ID);
  });
});

describe("oversize payload handling", () => {
  it("rejects encodeMessage of a requestBody exceeding the max payload", () => {
    const msg: Message = {
      kind: "requestBody",
      requestId: newRequestId(),
      data: new Uint8Array(MAX_FRAME_PAYLOAD_BYTES + 1),
    };
    expect(() => encodeMessage(msg)).toThrowError(ProtocolError);
  });

  it("rejects decodeMessage of a frame whose declared length exceeds the max", () => {
    const header = new Uint8Array(22);
    header[0] = 1;
    header[1] = FrameType.RequestBody;
    const view = new DataView(header.buffer);
    view.setUint32(18, MAX_FRAME_PAYLOAD_BYTES + 1, false);
    expect(() => decodeMessage(header)).toThrowError(ProtocolError);
  });
});

describe("malformed JSON payloads", () => {
  it("throws invalid_json for non-JSON bytes", () => {
    const encoded = encodeFrame(
      FrameType.Hello,
      ZERO_REQUEST_ID,
      new TextEncoder().encode("not json"),
    );
    try {
      decodeMessage(encoded);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProtocolError);
      expect((err as ProtocolError).code).toBe("invalid_json");
    }
  });

  it("throws invalid_json for JSON that is not an object", () => {
    const encoded = encodeFrame(
      FrameType.Hello,
      ZERO_REQUEST_ID,
      new TextEncoder().encode("[1,2,3]"),
    );
    expect(() => decodeMessage(encoded)).toThrow(ProtocolError);
  });

  it("throws invalid_json when a required field is missing", () => {
    const encoded = encodeFrame(
      FrameType.Hello,
      ZERO_REQUEST_ID,
      new TextEncoder().encode('{"tunnelId":"t1"}'),
    );
    try {
      decodeMessage(encoded);
      expect.unreachable();
    } catch (err) {
      expect((err as ProtocolError).code).toBe("invalid_json");
    }
  });

  it("throws invalid_json when a field has the wrong type", () => {
    const encoded = encodeFrame(
      FrameType.RequestStart,
      newRequestId(),
      new TextEncoder().encode('{"method":"GET","path":"/","headers":[],"hasBody":"yes"}'),
    );
    try {
      decodeMessage(encoded);
      expect.unreachable();
    } catch (err) {
      expect((err as ProtocolError).code).toBe("invalid_json");
    }
  });

  it("throws invalid_json when headers are malformed", () => {
    const encoded = encodeFrame(
      FrameType.RequestStart,
      newRequestId(),
      new TextEncoder().encode(
        '{"method":"GET","path":"/","headers":[["only-one-item"]],"hasBody":false}',
      ),
    );
    expect(() => decodeMessage(encoded)).toThrow(ProtocolError);
  });

  it("throws invalid_json for an invalid cancel reason", () => {
    const encoded = encodeFrame(
      FrameType.Cancel,
      newRequestId(),
      new TextEncoder().encode('{"reason":"bogus"}'),
    );
    expect(() => decodeMessage(encoded)).toThrow(ProtocolError);
  });

  it("throws invalid_json for an invalid error code", () => {
    const encoded = encodeFrame(
      FrameType.Error,
      newRequestId(),
      new TextEncoder().encode('{"code":"bogus","message":"x"}'),
    );
    expect(() => decodeMessage(encoded)).toThrow(ProtocolError);
  });
});
