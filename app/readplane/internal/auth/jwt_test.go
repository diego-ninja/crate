package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestVerifyHS256AcceptsValidToken(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token := signTestJWT(t, "secret", map[string]any{
		"user_id": 12,
		"email":   "diego@example.com",
		"role":    "admin",
		"sid":     "session-1",
		"exp":     now.Add(time.Hour).Unix(),
	})

	payload, err := VerifyHS256(token, "secret", now)
	if err != nil {
		t.Fatalf("VerifyHS256 returned error: %v", err)
	}
	if payload.UserID != 12 || payload.Email != "diego@example.com" || payload.SessionID != "session-1" {
		t.Fatalf("unexpected payload: %+v", payload)
	}
}

func TestVerifyHS256RejectsExpiredToken(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token := signTestJWT(t, "secret", map[string]any{
		"user_id": 12,
		"email":   "diego@example.com",
		"exp":     now.Add(-time.Second).Unix(),
	})

	_, err := VerifyHS256(token, "secret", now)
	if err != ErrExpiredToken {
		t.Fatalf("err = %v, want ErrExpiredToken", err)
	}
}

func TestVerifyHS256RejectsTamperedToken(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token := signTestJWT(t, "secret", map[string]any{
		"user_id": 12,
		"email":   "diego@example.com",
		"exp":     now.Add(time.Hour).Unix(),
	})
	token = strings.TrimSuffix(token, token[len(token)-1:]) + "x"

	_, err := VerifyHS256(token, "secret", now)
	if err != ErrInvalidToken {
		t.Fatalf("err = %v, want ErrInvalidToken", err)
	}
}

func signTestJWT(t *testing.T, secret string, payload map[string]any) string {
	t.Helper()
	headerBytes, err := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	if err != nil {
		t.Fatal(err)
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	head := base64.RawURLEncoding.EncodeToString(headerBytes)
	body := base64.RawURLEncoding.EncodeToString(payloadBytes)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(head + "." + body))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return head + "." + body + "." + sig
}
