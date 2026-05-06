package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestExtractTokenPrefersBearer(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/?token=query", nil)
	req.Header.Set("Authorization", "Bearer header-token")
	req.AddCookie(&http.Cookie{Name: listenCookieName, Value: "cookie-token"})

	token := ExtractToken(req, true)

	if token != "header-token" {
		t.Fatalf("token = %q", token)
	}
}

func TestExtractTokenAllowsQueryOnlyWhenEnabled(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/?token=query-token", nil)

	if token := ExtractToken(req, false); token != "" {
		t.Fatalf("token = %q, want empty", token)
	}
	if token := ExtractToken(req, true); token != "query-token" {
		t.Fatalf("token = %q", token)
	}
}

func TestExtractTokenFallsBackToDefaultCookie(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: defaultCookieName, Value: "default-cookie"})

	token := ExtractToken(req, false)

	if token != "default-cookie" {
		t.Fatalf("token = %q", token)
	}
}
