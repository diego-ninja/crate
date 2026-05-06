package httpx

import (
	"errors"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

type FallbackProxy struct {
	enabled bool
	target  *url.URL
	version string
}

func NewFallbackProxy(enabled bool, baseURL string, version string) (*FallbackProxy, error) {
	baseURL = strings.TrimSpace(baseURL)
	if !enabled {
		return &FallbackProxy{enabled: false, version: version}, nil
	}
	if baseURL == "" {
		return nil, errors.New("fallback base url is required")
	}
	target, err := url.Parse(baseURL)
	if err != nil {
		return nil, err
	}
	return &FallbackProxy{enabled: true, target: target, version: version}, nil
}

func (p *FallbackProxy) Enabled() bool {
	return p != nil && p.enabled && p.target != nil
}

func (p *FallbackProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) bool {
	if !p.Enabled() {
		return false
	}
	proxy := httputil.NewSingleHostReverseProxy(p.target)
	proxy.Director = func(req *http.Request) {
		req.URL.Scheme = p.target.Scheme
		req.URL.Host = p.target.Host
		req.URL.Path = singleJoiningSlash(p.target.Path, r.URL.Path)
		req.URL.RawPath = ""
		req.URL.RawQuery = r.URL.RawQuery
		req.Host = p.target.Host
		req.Header.Set("X-Crate-Readplane-Fallback", "1")
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Set("X-Crate-Readplane", "fallback")
		if p.version != "" {
			resp.Header.Set("X-Crate-Readplane-Version", p.version)
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		MarkReadplane(w, "miss")
		MarkVersion(w, p.version)
		WriteError(w, http.StatusBadGateway, "Readplane fallback failed")
	}
	proxy.ServeHTTP(w, r)
	return true
}

func singleJoiningSlash(a string, b string) string {
	aslash := strings.HasSuffix(a, "/")
	bslash := strings.HasPrefix(b, "/")
	switch {
	case aslash && bslash:
		return a + b[1:]
	case !aslash && !bslash:
		return a + "/" + b
	default:
		return a + b
	}
}
