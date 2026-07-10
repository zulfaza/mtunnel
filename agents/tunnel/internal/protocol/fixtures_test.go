package protocol

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// This file cross-checks the Go codec against the language-neutral fixtures
// shared with packages/protocol (TypeScript), ensuring both implementations
// agree on the wire format byte-for-byte. See
// packages/protocol/test/fixtures.test.ts for the TypeScript counterpart and
// packages/protocol/scripts/gen-fixtures.mjs for how the fixtures are
// generated.

type fixturePayload struct {
	Kind string          `json:"kind"`
	JSON json.RawMessage `json:"json,omitempty"`
	Hex  string          `json:"hex,omitempty"`
}

type fixtureFrame struct {
	Type         int            `json:"type"`
	RequestIDHex string         `json:"requestIdHex"`
	Payload      fixturePayload `json:"payload"`
}

type validFixture struct {
	Name  string       `json:"name"`
	Hex   string       `json:"hex"`
	Frame fixtureFrame `json:"frame"`
}

type invalidFixture struct {
	Name      string `json:"name"`
	Hex       string `json:"hex"`
	ErrorCode string `json:"errorCode"`
}

type fixturesFile struct {
	Valid   []validFixture   `json:"valid"`
	Invalid []invalidFixture `json:"invalid"`
}

func loadFixtures(t *testing.T) fixturesFile {
	t.Helper()

	path := filepath.Join("..", "..", "..", "..", "packages", "protocol", "fixtures", "frames.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read shared fixtures file at %s: %v", path, err)
	}

	var f fixturesFile
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatalf("failed to parse shared fixtures file %s: %v", path, err)
	}
	return f
}

// unmarshalAny unmarshals JSON bytes into a generic interface{}, for
// semantic (type-normalized) comparison via reflect.DeepEqual.
func unmarshalAny(t *testing.T, data []byte) interface{} {
	t.Helper()
	var v interface{}
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("failed to unmarshal JSON payload %s: %v", data, err)
	}
	return v
}

func assertPayloadMatchesFixture(t *testing.T, payload []byte, fp fixturePayload) {
	t.Helper()

	switch fp.Kind {
	case "json":
		got := unmarshalAny(t, payload)
		want := unmarshalAny(t, fp.JSON)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("json payload mismatch:\n got:  %#v\n want: %#v", got, want)
		}
	case "binary":
		want, err := hex.DecodeString(fp.Hex)
		if err != nil {
			t.Fatalf("invalid fixture payload hex: %v", err)
		}
		if !reflect.DeepEqual([]byte(payload), want) {
			t.Errorf("binary payload mismatch:\n got:  %x\n want: %x", payload, want)
		}
	case "empty":
		if len(payload) != 0 {
			t.Errorf("expected empty payload, got %d bytes: %x", len(payload), payload)
		}
	default:
		t.Fatalf("unknown fixture payload kind %q", fp.Kind)
	}
}

func TestFixturesValid(t *testing.T) {
	fixtures := loadFixtures(t)
	if len(fixtures.Valid) < 15 {
		t.Fatalf("expected at least 15 valid fixtures, got %d", len(fixtures.Valid))
	}

	for _, fx := range fixtures.Valid {
		fx := fx
		t.Run(fx.Name, func(t *testing.T) {
			wireBytes, err := hex.DecodeString(fx.Hex)
			if err != nil {
				t.Fatalf("invalid fixture hex: %v", err)
			}

			frame, err := DecodeFrame(wireBytes)
			if err != nil {
				t.Fatalf("DecodeFrame returned error: %v", err)
			}

			if frame.Type != FrameType(fx.Frame.Type) {
				t.Errorf("Type = %d, want %d", frame.Type, fx.Frame.Type)
			}
			if gotID := RequestIDHex(frame.RequestID); gotID != fx.Frame.RequestIDHex {
				t.Errorf("RequestID = %s, want %s", gotID, fx.Frame.RequestIDHex)
			}
			assertPayloadMatchesFixture(t, frame.Payload, fx.Frame.Payload)

			// Roundtrip: re-encode the decoded frame and decode it again.
			reencoded, err := EncodeFrame(frame)
			if err != nil {
				t.Fatalf("EncodeFrame (roundtrip) returned error: %v", err)
			}
			redecoded, err := DecodeFrame(reencoded)
			if err != nil {
				t.Fatalf("DecodeFrame (roundtrip) returned error: %v", err)
			}
			if redecoded.Type != frame.Type {
				t.Errorf("roundtrip Type = %d, want %d", redecoded.Type, frame.Type)
			}
			if redecoded.RequestID != frame.RequestID {
				t.Errorf("roundtrip RequestID = %x, want %x", redecoded.RequestID, frame.RequestID)
			}

			if fx.Frame.Payload.Kind == "json" {
				got := unmarshalAny(t, redecoded.Payload)
				want := unmarshalAny(t, frame.Payload)
				if !reflect.DeepEqual(got, want) {
					t.Errorf("roundtrip json payload mismatch:\n got:  %#v\n want: %#v", got, want)
				}
			} else {
				if !reflect.DeepEqual(redecoded.Payload, frame.Payload) {
					t.Errorf("roundtrip payload mismatch:\n got:  %x\n want: %x", redecoded.Payload, frame.Payload)
				}
				if gotHex := hex.EncodeToString(reencoded); gotHex != fx.Hex {
					t.Errorf("re-encoded bytes = %s, want %s (fixture hex)", gotHex, fx.Hex)
				}
			}

			// Confirm the typed message layer also accepts this fixture.
			if _, err := DecodeMessage(wireBytes); err != nil {
				t.Errorf("DecodeMessage returned error: %v", err)
			}
		})
	}
}

func TestFixturesInvalid(t *testing.T) {
	fixtures := loadFixtures(t)
	if len(fixtures.Invalid) < 4 {
		t.Fatalf("expected at least 4 invalid fixtures, got %d", len(fixtures.Invalid))
	}

	for _, fx := range fixtures.Invalid {
		fx := fx
		t.Run(fx.Name, func(t *testing.T) {
			wireBytes, err := hex.DecodeString(fx.Hex)
			if err != nil {
				t.Fatalf("invalid fixture hex: %v", err)
			}

			_, err = DecodeFrame(wireBytes)
			if err == nil {
				t.Fatal("expected DecodeFrame to return an error, got nil")
			}
			var perr *ProtocolError
			if !errors.As(err, &perr) {
				t.Fatalf("expected error to be a *ProtocolError, got %T: %v", err, err)
			}
			if perr.Code != fx.ErrorCode {
				t.Errorf("Code = %q, want %q", perr.Code, fx.ErrorCode)
			}
		})
	}
}
