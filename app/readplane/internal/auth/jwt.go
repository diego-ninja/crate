package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrMissingToken = errors.New("missing token")
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("expired token")
)

type JWTPayload struct {
	UserID    int64   `json:"user_id"`
	Email     string  `json:"email"`
	Role      string  `json:"role"`
	Username  *string `json:"username"`
	Name      *string `json:"name"`
	SessionID string  `json:"sid"`
	Expires   int64   `json:"exp"`
}

type jwtHeader struct {
	Algorithm string `json:"alg"`
	Type      string `json:"typ"`
}

func VerifyHS256(token string, secret string, now time.Time) (JWTPayload, error) {
	if strings.TrimSpace(token) == "" {
		return JWTPayload{}, ErrMissingToken
	}
	if strings.TrimSpace(secret) == "" {
		return JWTPayload{}, fmt.Errorf("%w: jwt secret is empty", ErrInvalidToken)
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return JWTPayload{}, ErrInvalidToken
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return JWTPayload{}, ErrInvalidToken
	}
	var header jwtHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return JWTPayload{}, ErrInvalidToken
	}
	if header.Algorithm != "HS256" {
		return JWTPayload{}, ErrInvalidToken
	}

	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return JWTPayload{}, ErrInvalidToken
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return JWTPayload{}, ErrInvalidToken
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return JWTPayload{}, ErrInvalidToken
	}
	var payload JWTPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return JWTPayload{}, ErrInvalidToken
	}
	if payload.Expires > 0 && now.Unix() >= payload.Expires {
		return JWTPayload{}, ErrExpiredToken
	}
	if payload.UserID <= 0 || payload.Email == "" {
		return JWTPayload{}, ErrInvalidToken
	}
	if payload.Role == "" {
		payload.Role = "user"
	}
	return payload, nil
}
