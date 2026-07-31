package protocol

import "fmt"

// ProtocolError codes, mirroring packages/protocol's ProtocolErrorCode.
const (
	CodeInvalidVersion   = "invalid_version"
	CodeUnknownFrameType = "unknown_frame_type"
	CodeInvalidHeader    = "invalid_header"
	CodeLengthMismatch   = "length_mismatch"
	CodePayloadTooLarge  = "payload_too_large"
	CodeInvalidJSON      = "invalid_json"
)

// ProtocolError is returned by EncodeFrame/DecodeFrame and the typed message
// layer on any wire-format violation.
type ProtocolError struct {
	Code    string
	Message string
}

func (e *ProtocolError) Error() string {
	return fmt.Sprintf("protocol: %s: %s", e.Code, e.Message)
}

// Is reports whether target is a *ProtocolError with the same Code,
// allowing callers to use errors.Is(err, &ProtocolError{Code: CodeInvalidJSON}).
func (e *ProtocolError) Is(target error) bool {
	t, ok := target.(*ProtocolError)
	if !ok {
		return false
	}
	return e.Code == t.Code
}

// Sentinel errors for use with errors.Is, e.g.:
//
//	if errors.Is(err, protocol.ErrInvalidJSON) { ... }
var (
	ErrInvalidVersion   = &ProtocolError{Code: CodeInvalidVersion}
	ErrUnknownFrameType = &ProtocolError{Code: CodeUnknownFrameType}
	ErrInvalidHeader    = &ProtocolError{Code: CodeInvalidHeader}
	ErrLengthMismatch   = &ProtocolError{Code: CodeLengthMismatch}
	ErrPayloadTooLarge  = &ProtocolError{Code: CodePayloadTooLarge}
	ErrInvalidJSON      = &ProtocolError{Code: CodeInvalidJSON}
)
