// Package protocol implements mtunnel wire protocol v1: a binary framing
// codec with JSON metadata payloads. See docs/protocol.md for the full
// specification. This package mirrors packages/protocol (TypeScript)
// byte-for-byte; the two implementations are cross-checked against the
// shared fixtures in packages/protocol/fixtures/frames.json.
package protocol

import (
	"encoding/binary"
	"fmt"
)

// Version is the current protocol version carried in byte 0 of every frame.
const Version = 1

// HeaderSize is the fixed size, in bytes, of a frame header.
const HeaderSize = 22

// MaxPayloadBytes is the maximum payload size for a single frame (256 KiB).
// Larger bodies must be chunked into multiple body frames.
const MaxPayloadBytes = 262144

// requestIDSize is the fixed size, in bytes, of a request id.
const requestIDSize = 16

// FrameType identifies the kind of frame carried by a wire message.
type FrameType uint8

// Frame type byte values.
const (
	FrameHello         FrameType = 1
	FrameHelloAck      FrameType = 2
	FrameRequestStart  FrameType = 3
	FrameRequestBody   FrameType = 4
	FrameRequestEnd    FrameType = 5
	FrameResponseStart FrameType = 6
	FrameResponseBody  FrameType = 7
	FrameResponseEnd   FrameType = 8
	FrameCancel        FrameType = 9
	FramePing          FrameType = 10
	FramePong          FrameType = 11
	FrameError         FrameType = 12
)

func (t FrameType) isValid() bool {
	return t >= FrameHello && t <= FrameError
}

// String returns a human-readable name for the frame type, primarily for
// error messages and debugging.
func (t FrameType) String() string {
	switch t {
	case FrameHello:
		return "Hello"
	case FrameHelloAck:
		return "HelloAck"
	case FrameRequestStart:
		return "RequestStart"
	case FrameRequestBody:
		return "RequestBody"
	case FrameRequestEnd:
		return "RequestEnd"
	case FrameResponseStart:
		return "ResponseStart"
	case FrameResponseBody:
		return "ResponseBody"
	case FrameResponseEnd:
		return "ResponseEnd"
	case FrameCancel:
		return "Cancel"
	case FramePing:
		return "Ping"
	case FramePong:
		return "Pong"
	case FrameError:
		return "Error"
	default:
		return fmt.Sprintf("FrameType(%d)", uint8(t))
	}
}

// RequestID is a 16-byte request identifier. All-zero for connection-level
// frames (Hello, HelloAck, Ping, Pong, and connection-level Error).
type RequestID [16]byte

// ZeroRequestID is the all-zero request id used for connection-level frames.
var ZeroRequestID RequestID

// Frame is a decoded low-level wire frame.
type Frame struct {
	Type      FrameType
	RequestID RequestID
	Payload   []byte
}

// EncodeFrame encodes a single wire frame: version byte, type byte, 16-byte
// request id, big-endian uint32 payload length, then the payload bytes.
func EncodeFrame(f Frame) ([]byte, error) {
	if !f.Type.isValid() {
		return nil, &ProtocolError{Code: CodeUnknownFrameType, Message: fmt.Sprintf("unknown frame type: %d", uint8(f.Type))}
	}
	if len(f.Payload) > MaxPayloadBytes {
		return nil, &ProtocolError{
			Code:    CodePayloadTooLarge,
			Message: fmt.Sprintf("payload of %d bytes exceeds max of %d bytes", len(f.Payload), MaxPayloadBytes),
		}
	}

	out := make([]byte, HeaderSize+len(f.Payload))
	out[0] = Version
	out[1] = byte(f.Type)
	copy(out[2:2+requestIDSize], f.RequestID[:])
	binary.BigEndian.PutUint32(out[18:22], uint32(len(f.Payload)))
	copy(out[HeaderSize:], f.Payload)

	return out, nil
}

// DecodeFrame decodes a single wire frame produced by EncodeFrame. It
// returns a *ProtocolError on any structural violation of the wire format.
func DecodeFrame(data []byte) (Frame, error) {
	if len(data) < HeaderSize {
		return Frame{}, &ProtocolError{
			Code:    CodeInvalidHeader,
			Message: fmt.Sprintf("frame too short: expected at least %d bytes, got %d", HeaderSize, len(data)),
		}
	}

	version := data[0]
	if version != Version {
		return Frame{}, &ProtocolError{Code: CodeInvalidVersion, Message: fmt.Sprintf("unsupported protocol version: %d", version)}
	}

	frameType := FrameType(data[1])
	if !frameType.isValid() {
		return Frame{}, &ProtocolError{Code: CodeUnknownFrameType, Message: fmt.Sprintf("unknown frame type: %d", data[1])}
	}

	var requestID RequestID
	copy(requestID[:], data[2:18])

	payloadLength := binary.BigEndian.Uint32(data[18:22])
	if payloadLength > MaxPayloadBytes {
		return Frame{}, &ProtocolError{
			Code:    CodePayloadTooLarge,
			Message: fmt.Sprintf("declared payload length %d exceeds max of %d bytes", payloadLength, MaxPayloadBytes),
		}
	}

	actualPayloadLength := len(data) - HeaderSize
	if int(payloadLength) != actualPayloadLength {
		return Frame{}, &ProtocolError{
			Code: CodeLengthMismatch,
			Message: fmt.Sprintf(
				"declared payload length %d does not match actual remaining bytes %d",
				payloadLength, actualPayloadLength,
			),
		}
	}

	payload := make([]byte, payloadLength)
	copy(payload, data[HeaderSize:HeaderSize+int(payloadLength)])

	return Frame{Type: frameType, RequestID: requestID, Payload: payload}, nil
}
