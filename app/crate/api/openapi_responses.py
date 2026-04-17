"""Reusable OpenAPI response metadata."""

from crate.api.schemas.common import ApiErrorResponse


def error_response(description: str) -> dict:
    return {
        "model": ApiErrorResponse,
        "description": description,
    }


def merge_responses(*response_sets: dict[int, dict]) -> dict[int, dict]:
    merged: dict[int, dict] = {}
    for response_set in response_sets:
        merged.update(response_set)
    return merged


AUTH_ERROR_RESPONSES = {
    401: error_response("Authentication is required."),
    403: error_response("You do not have permission to perform this action."),
}

COMMON_ERROR_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested resource was not found."),
        409: error_response("The request conflicts with the current state."),
        422: error_response("The request payload failed validation."),
    },
)
