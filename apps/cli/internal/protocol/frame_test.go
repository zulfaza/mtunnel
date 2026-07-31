package protocol

import (
	"encoding/binary"
	"errors"
	"testing"
)

func fillRequestID(b byte) RequestID {
	var id RequestID
	for i := range id {
		id[i] = b
	}
	return id
}

func TestEncodeDecodeFrameRoundtrip(t *testing.T) {
	payload := []byte("hello")
	id := fillRequestID(7)

	encoded, err := EncodeFrame(Frame{Type: FrameRequestBody, RequestID: id, Payload: payload})
	if err != nil {
		t.Fatalf("EncodeFrame returned error: %v", err)
	}
	if len(encoded) != HeaderSize+len(payload) {
		t.Fatalf("unexpected encoded length: got %d, want %d", len(encoded), HeaderSize+len(payload))
	}
	if encoded[0] != Version {
		t.Fatalf("unexpected version byte: %d", encoded[0])
	}
	if encoded[1] != byte(FrameRequestBody) {
		t.Fatalf("unexpected type byte: %d", encoded[1])
	}

	decoded, err := DecodeFrame(encoded)
	if err != nil {
		t.Fatalf("DecodeFrame returned error: %v", err)
	}
	if decoded.Type != FrameRequestBody {
		t.Errorf("Type = %v, want %v", decoded.Type, FrameRequestBody)
	}
	if decoded.RequestID != id {
		t.Errorf("RequestID = %v, want %v", decoded.RequestID, id)
	}
	if string(decoded.Payload) != string(payload) {
		t.Errorf("Payload = %q, want %q", decoded.Payload, payload)
	}
}

func TestEncodeDecodeFrameEmptyPayload(t *testing.T) {
	encoded, err := EncodeFrame(Frame{Type: FramePing, RequestID: ZeroRequestID})
	if err != nil {
		t.Fatalf("EncodeFrame returned error: %v", err)
	}
	if len(encoded) != HeaderSize {
		t.Fatalf("unexpected encoded length: got %d, want %d", len(encoded), HeaderSize)
	}
	decoded, err := DecodeFrame(encoded)
	if err != nil {
		t.Fatalf("DecodeFrame returned error: %v", err)
	}
	if len(decoded.Payload) != 0 {
		t.Errorf("Payload length = %d, want 0", len(decoded.Payload))
	}
}

func TestEncodeFramePayloadLengthBigEndian(t *testing.T) {
	payload := make([]byte, 300)
	encoded, err := EncodeFrame(Frame{Type: FrameRequestBody, RequestID: ZeroRequestID, Payload: payload})
	if err != nil {
		t.Fatalf("EncodeFrame returned error: %v", err)
	}
	got := binary.BigEndian.Uint32(encoded[18:22])
	if got != 300 {
		t.Errorf("payload length = %d, want 300", got)
	}
}

func TestEncodeFrameRejectsOversizePayload(t *testing.T) {
	payload := make([]byte, MaxPayloadBytes+1)
	_, err := EncodeFrame(Frame{Type: FrameRequestBody, RequestID: ZeroRequestID, Payload: payload})
	if err == nil {
		t.Fatal("expected an error for oversize payload")
	}
	var perr *ProtocolError
	if !errors.As(err, &perr) {
		t.Fatalf("expected *ProtocolError, got %T", err)
	}
	if perr.Code != CodePayloadTooLarge {
		t.Errorf("Code = %q, want %q", perr.Code, CodePayloadTooLarge)
	}
	if !errors.Is(err, ErrPayloadTooLarge) {
		t.Error("errors.Is(err, ErrPayloadTooLarge) = false, want true")
	}
}

func TestEncodeFrameAcceptsExactMaxPayload(t *testing.T) {
	payload := make([]byte, MaxPayloadBytes)
	encoded, err := EncodeFrame(Frame{Type: FrameRequestBody, RequestID: ZeroRequestID, Payload: payload})
	if err != nil {
		t.Fatalf("EncodeFrame returned error: %v", err)
	}
	decoded, err := DecodeFrame(encoded)
	if err != nil {
		t.Fatalf("DecodeFrame returned error: %v", err)
	}
	if len(decoded.Payload) != MaxPayloadBytes {
		t.Errorf("Payload length = %d, want %d", len(decoded.Payload), MaxPayloadBytes)
	}
}

func TestEncodeFrameRejectsUnknownFrameType(t *testing.T) {
	_, err := EncodeFrame(Frame{Type: FrameType(99), RequestID: ZeroRequestID})
	if err == nil {
		t.Fatal("expected an error for unknown frame type")
	}
	if !errors.Is(err, ErrUnknownFrameType) {
		t.Error("errors.Is(err, ErrUnknownFrameType) = false, want true")
	}
}

func TestDecodeFrameRejectsWrongVersion(t *testing.T) {
	encoded, err := EncodeFrame(Frame{Type: FramePing, RequestID: ZeroRequestID})
	if err != nil {
		t.Fatalf("EncodeFrame returned error: %v", err)
	}
	encoded[0] = 2
	_, err = DecodeFrame(encoded)
	if !errors.Is(err, ErrInvalidVersion) {
		t.Errorf("errors.Is(err, ErrInvalidVersion) = false, want true (err=%v)", err)
	}
}

func TestDecodeFrameRejectsUnknownFrameType(t *testing.T) {
	encoded, err := EncodeFrame(Frame{Type: FramePing, RequestID: ZeroRequestID})
	if err != nil {
		t.Fatalf("EncodeFrame returned error: %v", err)
	}
	encoded[1] = 99
	_, err = DecodeFrame(encoded)
	if !errors.Is(err, ErrUnknownFrameType) {
		t.Errorf("errors.Is(err, ErrUnknownFrameType) = false, want true (err=%v)", err)
	}
}

func TestDecodeFrameRejectsHeaderShorterThan22Bytes(t *testing.T) {
	short := make([]byte, 21)
	short[0] = Version
	short[1] = byte(FramePing)
	_, err := DecodeFrame(short)
	if !errors.Is(err, ErrInvalidHeader) {
		t.Errorf("errors.Is(err, ErrInvalidHeader) = false, want true (err=%v)", err)
	}
}

func TestDecodeFrameRejectsLengthMismatch(t *testing.T) {
	encoded, err := EncodeFrame(Frame{Type: FrameRequestBody, RequestID: ZeroRequestID, Payload: []byte{1, 2, 3}})
	if err != nil {
		t.Fatalf("EncodeFrame returned error: %v", err)
	}
	truncated := encoded[:len(encoded)-1]
	_, err = DecodeFrame(truncated)
	if !errors.Is(err, ErrLengthMismatch) {
		t.Errorf("errors.Is(err, ErrLengthMismatch) = false, want true (err=%v)", err)
	}
}

func TestDecodeFrameRejectsDeclaredLengthAboveMax(t *testing.T) {
	header := make([]byte, HeaderSize)
	header[0] = Version
	header[1] = byte(FrameRequestBody)
	binary.BigEndian.PutUint32(header[18:22], uint32(MaxPayloadBytes+1))
	_, err := DecodeFrame(header)
	if !errors.Is(err, ErrPayloadTooLarge) {
		t.Errorf("errors.Is(err, ErrPayloadTooLarge) = false, want true (err=%v)", err)
	}
}
