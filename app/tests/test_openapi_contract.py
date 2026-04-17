"""Contract checks for the generated OpenAPI schema."""


def test_openapi_exposes_security_schemes(test_app):
    resp = test_app.get("/openapi.json")

    assert resp.status_code == 200
    data = resp.json()
    security_schemes = data["components"]["securitySchemes"]

    assert security_schemes["bearerAuth"]["type"] == "http"
    assert security_schemes["bearerAuth"]["scheme"] == "bearer"
    assert security_schemes["cookieAuth"]["type"] == "apiKey"
    assert security_schemes["cookieAuth"]["in"] == "cookie"
    assert security_schemes["cookieAuth"]["name"] == "crate_session"
    assert security_schemes["queryTokenAuth"]["type"] == "apiKey"
    assert security_schemes["queryTokenAuth"]["in"] == "query"


def test_openapi_marks_radio_routes_as_authenticated_and_typed(test_app):
    data = test_app.get("/openapi.json").json()
    operation = data["paths"]["/api/radio/track"]["get"]

    assert operation["tags"] == ["radio"]
    assert operation["summary"] == "Build track radio"
    assert operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/RadioResponse")
    assert operation["responses"]["404"]["content"]["application/json"]["schema"]["$ref"].endswith("/ApiErrorResponse")


def test_openapi_marks_genre_routes_as_authenticated_and_typed(test_app):
    data = test_app.get("/openapi.json").json()
    detail_operation = data["paths"]["/api/genres/{slug}"]["get"]
    eq_operation = data["paths"]["/api/genres/{slug}/eq-preset"]["patch"]

    assert detail_operation["tags"] == ["genres"]
    assert detail_operation["summary"] == "Get detailed genre information"
    assert detail_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert detail_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/GenreDetailResponse")
    assert detail_operation["responses"]["404"]["content"]["application/json"]["schema"]["$ref"].endswith("/ApiErrorResponse")

    assert eq_operation["summary"] == "Update the EQ preset for a canonical genre"
    assert eq_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/EqPresetUpdateResponse")
