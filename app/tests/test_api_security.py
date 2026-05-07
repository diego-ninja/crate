import os


def test_api_sets_security_response_headers(test_app):
    response = test_app.get("/openapi-crate.json")

    assert response.status_code == 200
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert response.headers["permissions-policy"] == "camera=(), microphone=(), geolocation=()"


def test_cors_preflight_allows_known_app_headers(test_app):
    domain = os.environ.get("DOMAIN", "localhost")
    origin = "http://localhost:5174" if domain in ("localhost", "127.0.0.1") else f"https://listen.{domain}"

    response = test_app.options(
        "/api/auth/login",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,x-crate-app,x-device-fingerprint,x-device-label,range,last-event-id",
        },
    )

    assert response.status_code == 200
    allowed_headers = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed_headers
    assert "x-crate-app" in allowed_headers
    assert "x-device-fingerprint" in allowed_headers
    assert "x-device-label" in allowed_headers
    assert "range" in allowed_headers
    assert "last-event-id" in allowed_headers
