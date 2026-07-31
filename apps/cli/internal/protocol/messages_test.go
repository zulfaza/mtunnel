package protocol

import (
	"encoding/binary"
	"errors"
	"reflect"
	"testing"
)

func roundtrip(t *testing.T, m Message) Message {
	t.Helper()
	encoded, err := EncodeMessage(m)
	if err != nil {
		t.Fatalf("EncodeMessage returned error: %v", err)
	}
	decoded, err := DecodeMessage(encoded)
	if err != nil {
		t.Fatalf("DecodeMessage returned error: %v", err)
	}
	return decoded
}

func assertRoundtrip(t *testing.T, m Message) {
	t.Helper()
	got := roundtrip(t, m)
	if !reflect.DeepEqual(got, m) {
		t.Errorf("roundtrip mismatch:\n got:  %#v\n want: %#v", got, m)
	}
}

func TestMessageRoundtrips(t *testing.T) {
	id := NewRequestID()

	t.Run("Hello", func(t *testing.T) {
		assertRoundtrip(t, Hello{RequestID: ZeroRequestID, TunnelID: "t1", AgentVersion: "1.0.0"})
	})

	t.Run("HelloAck", func(t *testing.T) {
		assertRoundtrip(t, HelloAck{
			RequestID:           ZeroRequestID,
			TunnelID:            "t1",
			PublicURL:           "https://t1.example.dev",
			HeartbeatIntervalMs: 20000,
			HeartbeatTimeoutMs:  60000,
			RequestTimeoutMs:    30000,
			MaxPayloadBytes:     MaxPayloadBytes,
		})
	})

	t.Run("RequestStart", func(t *testing.T) {
		assertRoundtrip(t, RequestStart{
			RequestID: id,
			Method:    "POST",
			Path:      "/api/things?x=1",
			Headers: HeaderPairs{
				{"Content-Type", "application/json"},
				{"X-Dup", "1"},
				{"X-Dup", "2"},
			},
			HasBody: true,
		})
	})

	t.Run("RequestBody", func(t *testing.T) {
		assertRoundtrip(t, RequestBody{RequestID: id, Data: []byte{1, 2, 3, 4}})
	})

	t.Run("RequestEnd", func(t *testing.T) {
		assertRoundtrip(t, RequestEnd{RequestID: id})
	})

	t.Run("ResponseStart", func(t *testing.T) {
		assertRoundtrip(t, ResponseStart{
			RequestID: id,
			Status:    404,
			Headers: HeaderPairs{
				{"Set-Cookie", "a=1"},
				{"Set-Cookie", "b=2"},
			},
			HasBody: false,
		})
	})

	t.Run("ResponseBody", func(t *testing.T) {
		assertRoundtrip(t, ResponseBody{RequestID: id, Data: []byte{9, 8, 7}})
	})

	t.Run("ResponseEnd", func(t *testing.T) {
		assertRoundtrip(t, ResponseEnd{RequestID: id})
	})

	for _, reason := range []CancelReason{CancelTimeout, CancelClientDisconnected, CancelUpstreamError, CancelShutdown} {
		t.Run("Cancel_"+string(reason), func(t *testing.T) {
			assertRoundtrip(t, Cancel{RequestID: id, Reason: reason})
		})
	}

	t.Run("Ping", func(t *testing.T) {
		assertRoundtrip(t, Ping{})
	})

	t.Run("Pong", func(t *testing.T) {
		assertRoundtrip(t, Pong{})
	})

	t.Run("ErrorMessage", func(t *testing.T) {
		assertRoundtrip(t, ErrorMessage{RequestID: id, Code: ErrorCodeUpstreamUnreachable, Message: "connection refused"})
	})
}

func TestPingPongAlwaysEncodeZeroRequestID(t *testing.T) {
	encoded, err := EncodeMessage(Ping{})
	if err != nil {
		t.Fatalf("EncodeMessage returned error: %v", err)
	}
	var requestID RequestID
	copy(requestID[:], encoded[2:18])
	if requestID != ZeroRequestID {
		t.Errorf("Ping request id = %x, want zero", requestID)
	}

	encoded, err = EncodeMessage(Pong{})
	if err != nil {
		t.Fatalf("EncodeMessage returned error: %v", err)
	}
	copy(requestID[:], encoded[2:18])
	if requestID != ZeroRequestID {
		t.Errorf("Pong request id = %x, want zero", requestID)
	}
}

func TestEncodeMessageRejectsOversizeBody(t *testing.T) {
	msg := RequestBody{RequestID: NewRequestID(), Data: make([]byte, MaxPayloadBytes+1)}
	_, err := EncodeMessage(msg)
	if !errors.Is(err, ErrPayloadTooLarge) {
		t.Errorf("errors.Is(err, ErrPayloadTooLarge) = false, want true (err=%v)", err)
	}
}

func TestDecodeMessageRejectsOversizeDeclaredLength(t *testing.T) {
	header := make([]byte, HeaderSize)
	header[0] = Version
	header[1] = byte(FrameRequestBody)
	binary.BigEndian.PutUint32(header[18:22], uint32(MaxPayloadBytes+1))
	_, err := DecodeMessage(header)
	if !errors.Is(err, ErrPayloadTooLarge) {
		t.Errorf("errors.Is(err, ErrPayloadTooLarge) = false, want true (err=%v)", err)
	}
}

func TestDecodeMessageMalformedJSON(t *testing.T) {
	t.Run("non-JSON bytes", func(t *testing.T) {
		encoded, err := EncodeFrame(Frame{Type: FrameHello, RequestID: ZeroRequestID, Payload: []byte("not json")})
		if err != nil {
			t.Fatalf("EncodeFrame returned error: %v", err)
		}
		_, err = DecodeMessage(encoded)
		if !errors.Is(err, ErrInvalidJSON) {
			t.Errorf("errors.Is(err, ErrInvalidJSON) = false, want true (err=%v)", err)
		}
	})

	t.Run("JSON that is not an object", func(t *testing.T) {
		encoded, err := EncodeFrame(Frame{Type: FrameHello, RequestID: ZeroRequestID, Payload: []byte("[1,2,3]")})
		if err != nil {
			t.Fatalf("EncodeFrame returned error: %v", err)
		}
		_, err = DecodeMessage(encoded)
		if !errors.Is(err, ErrInvalidJSON) {
			t.Errorf("errors.Is(err, ErrInvalidJSON) = false, want true (err=%v)", err)
		}
	})

	t.Run("missing required field", func(t *testing.T) {
		encoded, err := EncodeFrame(Frame{Type: FrameHello, RequestID: ZeroRequestID, Payload: []byte(`{"tunnelId":"t1"}`)})
		if err != nil {
			t.Fatalf("EncodeFrame returned error: %v", err)
		}
		_, err = DecodeMessage(encoded)
		if !errors.Is(err, ErrInvalidJSON) {
			t.Errorf("errors.Is(err, ErrInvalidJSON) = false, want true (err=%v)", err)
		}
	})

	t.Run("wrong field type", func(t *testing.T) {
		encoded, err := EncodeFrame(Frame{
			Type:      FrameRequestStart,
			RequestID: NewRequestID(),
			Payload:   []byte(`{"method":"GET","path":"/","headers":[],"hasBody":"yes"}`),
		})
		if err != nil {
			t.Fatalf("EncodeFrame returned error: %v", err)
		}
		_, err = DecodeMessage(encoded)
		if !errors.Is(err, ErrInvalidJSON) {
			t.Errorf("errors.Is(err, ErrInvalidJSON) = false, want true (err=%v)", err)
		}
	})

	t.Run("malformed header pair", func(t *testing.T) {
		encoded, err := EncodeFrame(Frame{
			Type:      FrameRequestStart,
			RequestID: NewRequestID(),
			Payload:   []byte(`{"method":"GET","path":"/","headers":[["only-one-item"]],"hasBody":false}`),
		})
		if err != nil {
			t.Fatalf("EncodeFrame returned error: %v", err)
		}
		_, err = DecodeMessage(encoded)
		if !errors.Is(err, ErrInvalidJSON) {
			t.Errorf("errors.Is(err, ErrInvalidJSON) = false, want true (err=%v)", err)
		}
	})

	t.Run("invalid cancel reason", func(t *testing.T) {
		encoded, err := EncodeFrame(Frame{Type: FrameCancel, RequestID: NewRequestID(), Payload: []byte(`{"reason":"bogus"}`)})
		if err != nil {
			t.Fatalf("EncodeFrame returned error: %v", err)
		}
		_, err = DecodeMessage(encoded)
		if !errors.Is(err, ErrInvalidJSON) {
			t.Errorf("errors.Is(err, ErrInvalidJSON) = false, want true (err=%v)", err)
		}
	})

	t.Run("invalid error code", func(t *testing.T) {
		encoded, err := EncodeFrame(Frame{
			Type:      FrameError,
			RequestID: NewRequestID(),
			Payload:   []byte(`{"code":"bogus","message":"x"}`),
		})
		if err != nil {
			t.Fatalf("EncodeFrame returned error: %v", err)
		}
		_, err = DecodeMessage(encoded)
		if !errors.Is(err, ErrInvalidJSON) {
			t.Errorf("errors.Is(err, ErrInvalidJSON) = false, want true (err=%v)", err)
		}
	})
}
