import { describe, expect, it } from "vitest";
import fixturesJson from "../fixtures/frames.json" with { type: "json" };
import {
  type Message,
  ProtocolError,
  decodeMessage,
  encodeMessage,
  requestIdToHex,
} from "../src/index.js";

interface JsonPayload {
  kind: "json";
  json: Record<string, unknown>;
}
interface BinaryPayload {
  kind: "binary";
  hex: string;
}
interface EmptyPayload {
  kind: "empty";
}
type FixturePayload = JsonPayload | BinaryPayload | EmptyPayload;

interface ValidFixture {
  name: string;
  hex: string;
  frame: {
    type: number;
    requestIdHex: string;
    payload: FixturePayload;
  };
}

interface InvalidFixture {
  name: string;
  hex: string;
  errorCode: string;
}

interface FixturesFile {
  valid: ValidFixture[];
  invalid: InvalidFixture[];
}

const fixtures = fixturesJson as FixturesFile;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Assert that a decoded message's semantic content matches the fixture's expectations. */
function assertMatchesFixture(msg: Message, fixture: ValidFixture): void {
  const { payload } = fixture.frame;

  switch (msg.kind) {
    case "hello":
      expect(requestIdToHex(msg.requestId)).toBe(fixture.frame.requestIdHex);
      expect(payload.kind).toBe("json");
      if (payload.kind === "json") {
        expect(msg.tunnelId).toBe(payload.json["tunnelId"]);
        expect(msg.agentVersion).toBe(payload.json["agentVersion"]);
      }
      return;
    case "helloAck":
      expect(requestIdToHex(msg.requestId)).toBe(fixture.frame.requestIdHex);
      if (payload.kind === "json") {
        expect(msg.tunnelId).toBe(payload.json["tunnelId"]);
        expect(msg.publicUrl).toBe(payload.json["publicUrl"]);
        expect(msg.heartbeatIntervalMs).toBe(payload.json["heartbeatIntervalMs"]);
        expect(msg.heartbeatTimeoutMs).toBe(payload.json["heartbeatTimeoutMs"]);
        expect(msg.requestTimeoutMs).toBe(payload.json["requestTimeoutMs"]);
        expect(msg.maxPayloadBytes).toBe(payload.json["maxPayloadBytes"]);
      }
      return;
    case "requestStart":
      expect(requestIdToHex(msg.requestId)).toBe(fixture.frame.requestIdHex);
      if (payload.kind === "json") {
        expect(msg.method).toBe(payload.json["method"]);
        expect(msg.path).toBe(payload.json["path"]);
        expect(msg.headers).toEqual(payload.json["headers"]);
        expect(msg.hasBody).toBe(payload.json["hasBody"]);
      }
      return;
    case "requestBody":
    case "responseBody":
      expect(requestIdToHex(msg.requestId)).toBe(fixture.frame.requestIdHex);
      expect(payload.kind).toBe("binary");
      if (payload.kind === "binary") {
        expect(bytesToHex(msg.data)).toBe(payload.hex);
      }
      return;
    case "requestEnd":
    case "responseEnd":
      expect(requestIdToHex(msg.requestId)).toBe(fixture.frame.requestIdHex);
      expect(payload.kind).toBe("empty");
      return;
    case "responseStart":
      expect(requestIdToHex(msg.requestId)).toBe(fixture.frame.requestIdHex);
      if (payload.kind === "json") {
        expect(msg.status).toBe(payload.json["status"]);
        expect(msg.headers).toEqual(payload.json["headers"]);
        expect(msg.hasBody).toBe(payload.json["hasBody"]);
      }
      return;
    case "cancel":
      expect(requestIdToHex(msg.requestId)).toBe(fixture.frame.requestIdHex);
      if (payload.kind === "json") {
        expect(msg.reason).toBe(payload.json["reason"]);
      }
      return;
    case "ping":
    case "pong":
      expect(payload.kind).toBe("empty");
      return;
    case "error":
      expect(requestIdToHex(msg.requestId)).toBe(fixture.frame.requestIdHex);
      if (payload.kind === "json") {
        expect(msg.code).toBe(payload.json["code"]);
        expect(msg.message).toBe(payload.json["message"]);
      }
      return;
  }
}

describe("compatibility fixtures", () => {
  it("has at least one valid case per documented scenario", () => {
    expect(fixtures.valid.length).toBeGreaterThanOrEqual(15);
    expect(fixtures.invalid.length).toBeGreaterThanOrEqual(4);
  });

  for (const fixture of fixtures.valid) {
    it(`decodes and round-trips: ${fixture.name}`, () => {
      const bytes = hexToBytes(fixture.hex);
      const decoded = decodeMessage(bytes);

      assertMatchesFixture(decoded, fixture);

      const reencoded = encodeMessage(decoded);
      const redecoded = decodeMessage(reencoded);
      expect(redecoded).toEqual(decoded);

      if (fixture.frame.payload.kind !== "json") {
        expect(bytesToHex(reencoded)).toBe(fixture.hex);
      }
    });
  }

  for (const fixture of fixtures.invalid) {
    it(`rejects invalid fixture: ${fixture.name}`, () => {
      const bytes = hexToBytes(fixture.hex);
      try {
        decodeMessage(bytes);
        expect.unreachable(`expected ${fixture.name} to throw`);
      } catch (err) {
        expect(err).toBeInstanceOf(ProtocolError);
        expect((err as ProtocolError).code).toBe(fixture.errorCode);
      }
    });
  }
});
