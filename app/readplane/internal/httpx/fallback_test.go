package httpx

import "testing"

func TestSingleJoiningSlash(t *testing.T) {
	cases := []struct {
		a    string
		b    string
		want string
	}{
		{"", "/api/auth/me", "/api/auth/me"},
		{"/root", "/api/auth/me", "/root/api/auth/me"},
		{"/root/", "/api/auth/me", "/root/api/auth/me"},
		{"/root", "api/auth/me", "/root/api/auth/me"},
	}
	for _, tt := range cases {
		if got := singleJoiningSlash(tt.a, tt.b); got != tt.want {
			t.Fatalf("singleJoiningSlash(%q, %q) = %q, want %q", tt.a, tt.b, got, tt.want)
		}
	}
}
