package httpx

import (
	"encoding/json"
	"net/http"
)

type ErrorPayload struct {
	Detail string `json:"detail"`
}

func WriteJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func WriteError(w http.ResponseWriter, status int, detail string) {
	WriteJSON(w, status, ErrorPayload{Detail: detail})
}

func MarkReadplane(w http.ResponseWriter, source string) {
	w.Header().Set("X-Crate-Readplane", source)
}

func MarkVersion(w http.ResponseWriter, version string) {
	if version == "" {
		version = "dev"
	}
	w.Header().Set("X-Crate-Readplane-Version", version)
}
