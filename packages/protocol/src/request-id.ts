const REQUEST_ID_SIZE = 16;

/** Generate a new random 16-byte request id. */
export function newRequestId(): Uint8Array {
  const id = new Uint8Array(REQUEST_ID_SIZE);
  crypto.getRandomValues(id);
  return id;
}

/** Encode a 16-byte request id as a lowercase hex string. */
export function requestIdToHex(id: Uint8Array): string {
  let hex = "";
  for (const byte of id) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Decode a hex string (32 hex chars) into a 16-byte request id. */
export function hexToRequestId(hex: string): Uint8Array {
  if (hex.length !== REQUEST_ID_SIZE * 2) {
    throw new RangeError(
      `Request id hex must be ${String(REQUEST_ID_SIZE * 2)} characters, got ${String(hex.length)}`,
    );
  }
  const id = new Uint8Array(REQUEST_ID_SIZE);
  for (let i = 0; i < REQUEST_ID_SIZE; i++) {
    const byteHex = hex.slice(i * 2, i * 2 + 2);
    const byte = Number.parseInt(byteHex, 16);
    if (Number.isNaN(byte)) {
      throw new RangeError(`Invalid hex string: ${hex}`);
    }
    id[i] = byte;
  }
  return id;
}

/** Compare two request ids for byte-exact equality. */
export function requestIdEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
