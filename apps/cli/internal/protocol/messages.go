package protocol

import (
	"encoding/json"
	"fmt"
)

// CancelReason enumerates the reasons a Cancel frame may be sent for.
type CancelReason string

// Cancel reason values.
const (
	CancelTimeout            CancelReason = "timeout"
	CancelClientDisconnected CancelReason = "client_disconnected"
	CancelUpstreamError      CancelReason = "upstream_error"
	CancelShutdown           CancelReason = "shutdown"
)

func (r CancelReason) isValid() bool {
	switch r {
	case CancelTimeout, CancelClientDisconnected, CancelUpstreamError, CancelShutdown:
		return true
	default:
		return false
	}
}

// ErrorCode enumerates the codes carried by Error frames.
type ErrorCode string

// Error code values.
const (
	ErrorCodeInvalidFrame        ErrorCode = "invalid_frame"
	ErrorCodePayloadTooLarge     ErrorCode = "payload_too_large"
	ErrorCodeTooManyRequests     ErrorCode = "too_many_requests"
	ErrorCodeUnknownRequest      ErrorCode = "unknown_request"
	ErrorCodeUpstreamUnreachable ErrorCode = "upstream_unreachable"
	ErrorCodeInternal            ErrorCode = "internal"
)

func (c ErrorCode) isValid() bool {
	switch c {
	case ErrorCodeInvalidFrame, ErrorCodePayloadTooLarge, ErrorCodeTooManyRequests,
		ErrorCodeUnknownRequest, ErrorCodeUpstreamUnreachable, ErrorCodeInternal:
		return true
	default:
		return false
	}
}

// HeaderPairs is an ordered list of [name, value] header pairs, preserving
// duplicates (e.g. Set-Cookie).
type HeaderPairs [][2]string

// Message is implemented by every typed protocol v1 message.
type Message interface {
	isMessage()
}

// Hello is sent agent -> server to open a tunnel connection.
type Hello struct {
	RequestID    RequestID
	TunnelID     string
	AgentVersion string
}

// HelloAck is sent server -> agent to acknowledge a Hello.
type HelloAck struct {
	RequestID           RequestID
	TunnelID            string
	PublicURL           string
	HeartbeatIntervalMs int
	HeartbeatTimeoutMs  int
	RequestTimeoutMs    int
	MaxPayloadBytes     int
}

// RequestStart is sent server -> agent to begin a proxied HTTP request.
type RequestStart struct {
	RequestID RequestID
	Method    string
	Path      string
	Headers   HeaderPairs
	HasBody   bool
}

// RequestBody carries a chunk of the proxied request body.
type RequestBody struct {
	RequestID RequestID
	Data      []byte
}

// RequestEnd marks the end of a proxied request body.
type RequestEnd struct {
	RequestID RequestID
}

// ResponseStart is sent agent -> server with the proxied HTTP response head.
type ResponseStart struct {
	RequestID RequestID
	Status    int
	Headers   HeaderPairs
	HasBody   bool
}

// ResponseBody carries a chunk of the proxied response body.
type ResponseBody struct {
	RequestID RequestID
	Data      []byte
}

// ResponseEnd marks the end of a proxied response body.
type ResponseEnd struct {
	RequestID RequestID
}

// Cancel is sent by either side to abort an in-flight request.
type Cancel struct {
	RequestID RequestID
	Reason    CancelReason
}

// Ping is a connection-level heartbeat sent by the agent.
type Ping struct{}

// Pong is the server's reply to a Ping.
type Pong struct{}

// ErrorMessage carries a protocol- or request-level error.
type ErrorMessage struct {
	RequestID RequestID
	Code      ErrorCode
	Message   string
}

func (Hello) isMessage()         {}
func (HelloAck) isMessage()      {}
func (RequestStart) isMessage()  {}
func (RequestBody) isMessage()   {}
func (RequestEnd) isMessage()    {}
func (ResponseStart) isMessage() {}
func (ResponseBody) isMessage()  {}
func (ResponseEnd) isMessage()   {}
func (Cancel) isMessage()        {}
func (Ping) isMessage()          {}
func (Pong) isMessage()          {}
func (ErrorMessage) isMessage()  {}

// --- encode ---

// EncodeMessage encodes a typed Message into a wire frame.
func EncodeMessage(m Message) ([]byte, error) {
	switch v := m.(type) {
	case Hello:
		payload, err := json.Marshal(struct {
			TunnelID     string `json:"tunnelId"`
			AgentVersion string `json:"agentVersion"`
		}{v.TunnelID, v.AgentVersion})
		if err != nil {
			return nil, err
		}
		return EncodeFrame(Frame{Type: FrameHello, RequestID: v.RequestID, Payload: payload})

	case HelloAck:
		payload, err := json.Marshal(struct {
			TunnelID            string `json:"tunnelId"`
			PublicURL           string `json:"publicUrl"`
			HeartbeatIntervalMs int    `json:"heartbeatIntervalMs"`
			HeartbeatTimeoutMs  int    `json:"heartbeatTimeoutMs"`
			RequestTimeoutMs    int    `json:"requestTimeoutMs"`
			MaxPayloadBytes     int    `json:"maxPayloadBytes"`
		}{v.TunnelID, v.PublicURL, v.HeartbeatIntervalMs, v.HeartbeatTimeoutMs, v.RequestTimeoutMs, v.MaxPayloadBytes})
		if err != nil {
			return nil, err
		}
		return EncodeFrame(Frame{Type: FrameHelloAck, RequestID: v.RequestID, Payload: payload})

	case RequestStart:
		payload, err := json.Marshal(struct {
			Method  string      `json:"method"`
			Path    string      `json:"path"`
			Headers HeaderPairs `json:"headers"`
			HasBody bool        `json:"hasBody"`
		}{v.Method, v.Path, v.Headers, v.HasBody})
		if err != nil {
			return nil, err
		}
		return EncodeFrame(Frame{Type: FrameRequestStart, RequestID: v.RequestID, Payload: payload})

	case RequestBody:
		return EncodeFrame(Frame{Type: FrameRequestBody, RequestID: v.RequestID, Payload: v.Data})

	case RequestEnd:
		return EncodeFrame(Frame{Type: FrameRequestEnd, RequestID: v.RequestID, Payload: nil})

	case ResponseStart:
		payload, err := json.Marshal(struct {
			Status  int         `json:"status"`
			Headers HeaderPairs `json:"headers"`
			HasBody bool        `json:"hasBody"`
		}{v.Status, v.Headers, v.HasBody})
		if err != nil {
			return nil, err
		}
		return EncodeFrame(Frame{Type: FrameResponseStart, RequestID: v.RequestID, Payload: payload})

	case ResponseBody:
		return EncodeFrame(Frame{Type: FrameResponseBody, RequestID: v.RequestID, Payload: v.Data})

	case ResponseEnd:
		return EncodeFrame(Frame{Type: FrameResponseEnd, RequestID: v.RequestID, Payload: nil})

	case Cancel:
		payload, err := json.Marshal(struct {
			Reason CancelReason `json:"reason"`
		}{v.Reason})
		if err != nil {
			return nil, err
		}
		return EncodeFrame(Frame{Type: FrameCancel, RequestID: v.RequestID, Payload: payload})

	case Ping:
		return EncodeFrame(Frame{Type: FramePing, RequestID: ZeroRequestID, Payload: nil})

	case Pong:
		return EncodeFrame(Frame{Type: FramePong, RequestID: ZeroRequestID, Payload: nil})

	case ErrorMessage:
		payload, err := json.Marshal(struct {
			Code    ErrorCode `json:"code"`
			Message string    `json:"message"`
		}{v.Code, v.Message})
		if err != nil {
			return nil, err
		}
		return EncodeFrame(Frame{Type: FrameError, RequestID: v.RequestID, Payload: payload})

	default:
		return nil, &ProtocolError{Code: CodeUnknownFrameType, Message: fmt.Sprintf("unsupported message type %T", m)}
	}
}

// --- decode ---

// DecodeMessage decodes a wire frame into a typed Message.
func DecodeMessage(data []byte) (Message, error) {
	f, err := DecodeFrame(data)
	if err != nil {
		return nil, err
	}

	switch f.Type {
	case FrameHello:
		obj, err := parseJSONObject(f.Payload)
		if err != nil {
			return nil, err
		}
		tunnelID, err := requireString(obj, "tunnelId")
		if err != nil {
			return nil, err
		}
		agentVersion, err := requireString(obj, "agentVersion")
		if err != nil {
			return nil, err
		}
		return Hello{RequestID: f.RequestID, TunnelID: tunnelID, AgentVersion: agentVersion}, nil

	case FrameHelloAck:
		obj, err := parseJSONObject(f.Payload)
		if err != nil {
			return nil, err
		}
		tunnelID, err := requireString(obj, "tunnelId")
		if err != nil {
			return nil, err
		}
		publicURL, err := requireString(obj, "publicUrl")
		if err != nil {
			return nil, err
		}
		heartbeatIntervalMs, err := requireInt(obj, "heartbeatIntervalMs")
		if err != nil {
			return nil, err
		}
		heartbeatTimeoutMs, err := requireInt(obj, "heartbeatTimeoutMs")
		if err != nil {
			return nil, err
		}
		requestTimeoutMs, err := requireInt(obj, "requestTimeoutMs")
		if err != nil {
			return nil, err
		}
		maxPayloadBytes, err := requireInt(obj, "maxPayloadBytes")
		if err != nil {
			return nil, err
		}
		return HelloAck{
			RequestID:           f.RequestID,
			TunnelID:            tunnelID,
			PublicURL:           publicURL,
			HeartbeatIntervalMs: heartbeatIntervalMs,
			HeartbeatTimeoutMs:  heartbeatTimeoutMs,
			RequestTimeoutMs:    requestTimeoutMs,
			MaxPayloadBytes:     maxPayloadBytes,
		}, nil

	case FrameRequestStart:
		obj, err := parseJSONObject(f.Payload)
		if err != nil {
			return nil, err
		}
		method, err := requireString(obj, "method")
		if err != nil {
			return nil, err
		}
		path, err := requireString(obj, "path")
		if err != nil {
			return nil, err
		}
		headers, err := requireHeaderPairs(obj, "headers")
		if err != nil {
			return nil, err
		}
		hasBody, err := requireBool(obj, "hasBody")
		if err != nil {
			return nil, err
		}
		return RequestStart{RequestID: f.RequestID, Method: method, Path: path, Headers: headers, HasBody: hasBody}, nil

	case FrameRequestBody:
		return RequestBody{RequestID: f.RequestID, Data: f.Payload}, nil

	case FrameRequestEnd:
		return RequestEnd{RequestID: f.RequestID}, nil

	case FrameResponseStart:
		obj, err := parseJSONObject(f.Payload)
		if err != nil {
			return nil, err
		}
		status, err := requireInt(obj, "status")
		if err != nil {
			return nil, err
		}
		headers, err := requireHeaderPairs(obj, "headers")
		if err != nil {
			return nil, err
		}
		hasBody, err := requireBool(obj, "hasBody")
		if err != nil {
			return nil, err
		}
		return ResponseStart{RequestID: f.RequestID, Status: status, Headers: headers, HasBody: hasBody}, nil

	case FrameResponseBody:
		return ResponseBody{RequestID: f.RequestID, Data: f.Payload}, nil

	case FrameResponseEnd:
		return ResponseEnd{RequestID: f.RequestID}, nil

	case FrameCancel:
		obj, err := parseJSONObject(f.Payload)
		if err != nil {
			return nil, err
		}
		reason, err := requireCancelReason(obj, "reason")
		if err != nil {
			return nil, err
		}
		return Cancel{RequestID: f.RequestID, Reason: reason}, nil

	case FramePing:
		return Ping{}, nil

	case FramePong:
		return Pong{}, nil

	case FrameError:
		obj, err := parseJSONObject(f.Payload)
		if err != nil {
			return nil, err
		}
		code, err := requireErrorCode(obj, "code")
		if err != nil {
			return nil, err
		}
		message, err := requireString(obj, "message")
		if err != nil {
			return nil, err
		}
		return ErrorMessage{RequestID: f.RequestID, Code: code, Message: message}, nil

	default:
		return nil, &ProtocolError{Code: CodeUnknownFrameType, Message: fmt.Sprintf("unknown frame type: %d", uint8(f.Type))}
	}
}

// --- JSON payload validation helpers ---
//
// These mirror packages/protocol/src/messages.ts: JSON payloads are parsed
// into a generic map and validated field-by-field, so that a missing field,
// a wrong-typed field, or a malformed header pair produces a ProtocolError
// with code "invalid_json" rather than a zero-valued struct field.

func parseJSONObject(payload []byte) (map[string]interface{}, error) {
	var v interface{}
	if err := json.Unmarshal(payload, &v); err != nil {
		return nil, &ProtocolError{Code: CodeInvalidJSON, Message: "payload is not valid JSON"}
	}
	obj, ok := v.(map[string]interface{})
	if !ok {
		return nil, &ProtocolError{Code: CodeInvalidJSON, Message: "JSON payload must be an object"}
	}
	return obj, nil
}

func requireString(obj map[string]interface{}, field string) (string, error) {
	v, ok := obj[field]
	if !ok {
		return "", &ProtocolError{Code: CodeInvalidJSON, Message: fmt.Sprintf("field %q is required", field)}
	}
	s, ok := v.(string)
	if !ok {
		return "", &ProtocolError{Code: CodeInvalidJSON, Message: fmt.Sprintf("field %q must be a string", field)}
	}
	return s, nil
}

func requireInt(obj map[string]interface{}, field string) (int, error) {
	v, ok := obj[field]
	if !ok {
		return 0, &ProtocolError{Code: CodeInvalidJSON, Message: fmt.Sprintf("field %q is required", field)}
	}
	n, ok := v.(float64)
	if !ok {
		return 0, &ProtocolError{Code: CodeInvalidJSON, Message: fmt.Sprintf("field %q must be a number", field)}
	}
	return int(n), nil
}

func requireBool(obj map[string]interface{}, field string) (bool, error) {
	v, ok := obj[field]
	if !ok {
		return false, &ProtocolError{Code: CodeInvalidJSON, Message: fmt.Sprintf("field %q is required", field)}
	}
	b, ok := v.(bool)
	if !ok {
		return false, &ProtocolError{Code: CodeInvalidJSON, Message: fmt.Sprintf("field %q must be a boolean", field)}
	}
	return b, nil
}

func requireHeaderPairs(obj map[string]interface{}, field string) (HeaderPairs, error) {
	v, ok := obj[field]
	if !ok {
		return nil, &ProtocolError{Code: CodeInvalidJSON, Message: fmt.Sprintf("field %q is required", field)}
	}
	arr, ok := v.([]interface{})
	if !ok {
		return nil, &ProtocolError{Code: CodeInvalidJSON, Message: fmt.Sprintf("field %q must be an array", field)}
	}
	pairs := make(HeaderPairs, 0, len(arr))
	for _, item := range arr {
		entry, ok := item.([]interface{})
		if !ok || len(entry) != 2 {
			return nil, &ProtocolError{Code: CodeInvalidJSON, Message: fmt.Sprintf("field %q must contain [name, value] pairs", field)}
		}
		name, ok1 := entry[0].(string)
		value, ok2 := entry[1].(string)
		if !ok1 || !ok2 {
			return nil, &ProtocolError{Code: CodeInvalidJSON, Message: fmt.Sprintf("field %q must contain string [name, value] pairs", field)}
		}
		pairs = append(pairs, [2]string{name, value})
	}
	return pairs, nil
}

func requireCancelReason(obj map[string]interface{}, field string) (CancelReason, error) {
	s, err := requireString(obj, field)
	if err != nil {
		return "", err
	}
	reason := CancelReason(s)
	if !reason.isValid() {
		return "", &ProtocolError{Code: CodeInvalidJSON, Message: fmt.Sprintf("field %q must be a valid cancel reason", field)}
	}
	return reason, nil
}

func requireErrorCode(obj map[string]interface{}, field string) (ErrorCode, error) {
	s, err := requireString(obj, field)
	if err != nil {
		return "", err
	}
	code := ErrorCode(s)
	if !code.isValid() {
		return "", &ProtocolError{Code: CodeInvalidJSON, Message: fmt.Sprintf("field %q must be a valid error code", field)}
	}
	return code, nil
}
