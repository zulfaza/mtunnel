package protocol

import (
	"crypto/rand"
	"encoding/hex"
)

// NewRequestID generates a new random 16-byte request id.
func NewRequestID() RequestID {
	var id RequestID
	// crypto/rand.Read only fails if the OS entropy source is unavailable,
	// which is not a recoverable condition for this process.
	if _, err := rand.Read(id[:]); err != nil {
		panic("protocol: failed to read random bytes: " + err.Error())
	}
	return id
}

// RequestIDHex encodes a request id as a lowercase hex string.
func RequestIDHex(id RequestID) string {
	return hex.EncodeToString(id[:])
}

// RequestIDFromHex decodes a hex string (32 hex chars) into a request id.
func RequestIDFromHex(s string) (RequestID, error) {
	var id RequestID
	b, err := hex.DecodeString(s)
	if err != nil {
		return id, err
	}
	if len(b) != requestIDSize {
		return id, &ProtocolError{Code: CodeInvalidHeader, Message: "request id hex must decode to 16 bytes"}
	}
	copy(id[:], b)
	return id, nil
}

// ChunkPayload splits data into chunks of at most max bytes each. An empty
// input yields an empty slice (not a single empty chunk). Panics if max is
// not positive.
func ChunkPayload(data []byte, max int) [][]byte {
	if max <= 0 {
		panic("protocol: ChunkPayload max must be positive")
	}
	if len(data) == 0 {
		return [][]byte{}
	}

	chunks := make([][]byte, 0, (len(data)+max-1)/max)
	for offset := 0; offset < len(data); offset += max {
		end := offset + max
		if end > len(data) {
			end = len(data)
		}
		chunk := make([]byte, end-offset)
		copy(chunk, data[offset:end])
		chunks = append(chunks, chunk)
	}
	return chunks
}
