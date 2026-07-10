// One-off generator for packages/protocol/fixtures/frames.json.
// Run with: node scripts/gen-fixtures.mjs (after `pnpm build` in this package).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FrameType, encodeFrame, encodeMessage, requestIdToHex } from "../dist/index.js";

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function idFromByte(fill) {
  return new Uint8Array(16).fill(fill);
}

function sequentialId(start) {
  return Uint8Array.from({ length: 16 }, (_, i) => (start + i) & 0xff);
}

function sequentialBytes(n, start = 0) {
  return Uint8Array.from({ length: n }, (_, i) => (start + i) & 0xff);
}

const ZERO_ID = idFromByte(0);

const valid = [];

function addValid(name, msg, frame) {
  const encoded = encodeMessage(msg);
  valid.push({ name, hex: hex(encoded), frame });
}

// hello
{
  const requestId = ZERO_ID;
  addValid(
    "hello",
    { kind: "hello", requestId, tunnelId: "swift-otter-42", agentVersion: "0.2.0" },
    {
      type: FrameType.Hello,
      requestIdHex: requestIdToHex(requestId),
      payload: { kind: "json", json: { tunnelId: "swift-otter-42", agentVersion: "0.2.0" } },
    },
  );
}

// helloAck
{
  const requestId = ZERO_ID;
  const json = {
    tunnelId: "swift-otter-42",
    publicUrl: "https://swift-otter-42.ztunnel.dev",
    heartbeatIntervalMs: 20000,
    heartbeatTimeoutMs: 60000,
    requestTimeoutMs: 30000,
    maxPayloadBytes: 262144,
  };
  addValid(
    "helloAck",
    { kind: "helloAck", requestId, ...json },
    {
      type: FrameType.HelloAck,
      requestIdHex: requestIdToHex(requestId),
      payload: { kind: "json", json },
    },
  );
}

// requestStart (duplicate header names + query string)
{
  const requestId = sequentialId(1);
  const headers = [
    ["Accept", "application/json"],
    ["X-Custom", "a"],
    ["X-Custom", "b"],
  ];
  const json = { method: "GET", path: "/api/users?active=true&sort=name", headers, hasBody: false };
  addValid(
    "requestStart",
    { kind: "requestStart", requestId, ...json },
    {
      type: FrameType.RequestStart,
      requestIdHex: requestIdToHex(requestId),
      payload: { kind: "json", json },
    },
  );
}

// requestBody (32 bytes binary)
{
  const requestId = sequentialId(1);
  const data = sequentialBytes(32, 0);
  addValid(
    "requestBody",
    { kind: "requestBody", requestId, data },
    {
      type: FrameType.RequestBody,
      requestIdHex: requestIdToHex(requestId),
      payload: { kind: "binary", hex: hex(data) },
    },
  );
}

// requestEnd
{
  const requestId = sequentialId(1);
  addValid(
    "requestEnd",
    { kind: "requestEnd", requestId },
    {
      type: FrameType.RequestEnd,
      requestIdHex: requestIdToHex(requestId),
      payload: { kind: "empty" },
    },
  );
}

// responseStart (two Set-Cookie headers)
{
  const requestId = sequentialId(1);
  const headers = [
    ["Content-Type", "text/plain"],
    ["Set-Cookie", "sid=abc123; Path=/"],
    ["Set-Cookie", "theme=dark; Path=/"],
  ];
  const json = { status: 200, headers, hasBody: true };
  addValid(
    "responseStart",
    { kind: "responseStart", requestId, ...json },
    {
      type: FrameType.ResponseStart,
      requestIdHex: requestIdToHex(requestId),
      payload: { kind: "json", json },
    },
  );
}

// responseBody
{
  const requestId = sequentialId(1);
  const data = sequentialBytes(16, 200);
  addValid(
    "responseBody",
    { kind: "responseBody", requestId, data },
    {
      type: FrameType.ResponseBody,
      requestIdHex: requestIdToHex(requestId),
      payload: { kind: "binary", hex: hex(data) },
    },
  );
}

// responseEnd
{
  const requestId = sequentialId(1);
  addValid(
    "responseEnd",
    { kind: "responseEnd", requestId },
    {
      type: FrameType.ResponseEnd,
      requestIdHex: requestIdToHex(requestId),
      payload: { kind: "empty" },
    },
  );
}

// cancel - one case per reason
const cancelReasons = ["timeout", "client_disconnected", "upstream_error", "shutdown"];
for (const reason of cancelReasons) {
  const requestId = sequentialId(1);
  addValid(
    `cancel_${reason}`,
    { kind: "cancel", requestId, reason },
    {
      type: FrameType.Cancel,
      requestIdHex: requestIdToHex(requestId),
      payload: { kind: "json", json: { reason } },
    },
  );
}

// ping
addValid(
  "ping",
  { kind: "ping" },
  { type: FrameType.Ping, requestIdHex: requestIdToHex(ZERO_ID), payload: { kind: "empty" } },
);

// pong
addValid(
  "pong",
  { kind: "pong" },
  { type: FrameType.Pong, requestIdHex: requestIdToHex(ZERO_ID), payload: { kind: "empty" } },
);

// error
{
  const requestId = sequentialId(1);
  const json = { code: "upstream_unreachable", message: "connection refused: localhost:3000" };
  addValid(
    "error",
    { kind: "error", requestId, ...json },
    {
      type: FrameType.Error,
      requestIdHex: requestIdToHex(requestId),
      payload: { kind: "json", json },
    },
  );
}

// --- invalid fixtures ---
const invalid = [];

{
  // wrong version: valid ping frame with version byte flipped to 0x02
  const good = encodeFrame(FrameType.Ping, ZERO_ID, new Uint8Array(0));
  const bad = Uint8Array.from(good);
  bad[0] = 0x02;
  invalid.push({ name: "wrong_version", hex: hex(bad), errorCode: "invalid_version" });
}

{
  // unknown frame type: valid ping frame with type byte set to 99
  const good = encodeFrame(FrameType.Ping, ZERO_ID, new Uint8Array(0));
  const bad = Uint8Array.from(good);
  bad[1] = 99;
  invalid.push({ name: "unknown_frame_type", hex: hex(bad), errorCode: "unknown_frame_type" });
}

{
  // truncated header: only 10 bytes total, header requires 22
  const bad = sequentialBytes(10, 1);
  bad[0] = 0x01;
  bad[1] = FrameType.Ping;
  invalid.push({ name: "truncated_header", hex: hex(bad), errorCode: "invalid_header" });
}

{
  // payload length mismatch: header declares 10 bytes but only 3 are present
  const requestId = sequentialId(1);
  const header = new Uint8Array(22);
  header[0] = 0x01;
  header[1] = FrameType.RequestBody;
  header.set(requestId, 2);
  const view = new DataView(header.buffer);
  view.setUint32(18, 10, false);
  const bad = new Uint8Array(22 + 3);
  bad.set(header, 0);
  bad.set(sequentialBytes(3, 0), 22);
  invalid.push({ name: "payload_length_mismatch", hex: hex(bad), errorCode: "length_mismatch" });
}

const fixtures = { valid, invalid };

const outPath = fileURLToPath(new URL("../fixtures/frames.json", import.meta.url));
writeFileSync(outPath, JSON.stringify(fixtures, null, 2) + "\n");
console.log(`Wrote ${valid.length} valid and ${invalid.length} invalid fixtures to ${outPath}`);
