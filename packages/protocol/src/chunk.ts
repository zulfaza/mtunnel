import { MAX_FRAME_PAYLOAD_BYTES } from "./constants.js";

/**
 * Split `data` into chunks of at most `max` bytes each. An empty input
 * yields an empty array (not a single empty chunk).
 */
export function chunkPayload(
  data: Uint8Array,
  max: number = MAX_FRAME_PAYLOAD_BYTES,
): Uint8Array[] {
  if (max <= 0) {
    throw new RangeError(`max must be positive, got ${String(max)}`);
  }
  if (data.length === 0) {
    return [];
  }

  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += max) {
    chunks.push(data.slice(offset, Math.min(offset + max, data.length)));
  }
  return chunks;
}
