"""LLM provider abstraction via LiteLLM + instructor.

Supports: Ollama (default), OpenAI, Anthropic, Gemini, Groq, etc.
Config priority: function arg > DB setting > env var > default (ollama).
"""

import json
import logging
import os
from typing import TypeVar

import requests
from pydantic import BaseModel

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# ── Config ──────────────────────────────────────────────────────

_DEFAULT_MODEL = "ollama/llama3.1:8b"
_OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434")


def get_config() -> dict:
    """Return current LLM config from DB settings, env, or defaults."""
    from crate.db.cache import get_setting

    model = get_setting("llm_model", os.environ.get("LLM_PROVIDER", _DEFAULT_MODEL))
    ollama_url = get_setting("llm_ollama_url", _OLLAMA_URL)

    return {
        "model": model,
        "ollama_url": ollama_url,
        "provider": model.split("/")[0] if "/" in model else "openai",
    }


def _get_ollama_url() -> str:
    try:
        from crate.db.cache import get_setting
        return get_setting("llm_ollama_url", _OLLAMA_URL)
    except Exception:
        return _OLLAMA_URL


def _get_model() -> str:
    try:
        from crate.db.cache import get_setting
        return get_setting("llm_model", os.environ.get("LLM_PROVIDER", _DEFAULT_MODEL))
    except Exception:
        return os.environ.get("LLM_PROVIDER", _DEFAULT_MODEL)


# ── Direct Ollama API (no litellm dependency needed) ────────────

def _ollama_chat(model: str, messages: list[dict], json_mode: bool = False) -> str:
    """Call Ollama HTTP API directly. No extra dependencies."""
    url = f"{_get_ollama_url()}/api/chat"
    body: dict = {
        "model": model.removeprefix("ollama/"),
        "messages": messages,
        "stream": False,
    }
    if json_mode:
        body["format"] = "json"

    try:
        resp = requests.post(url, json=body, timeout=300)
        resp.raise_for_status()
        data = resp.json()
        return data.get("message", {}).get("content", "")
    except requests.exceptions.ConnectionError:
        raise RuntimeError(f"Cannot connect to Ollama at {_get_ollama_url()}. Is the container running?")
    except requests.exceptions.Timeout:
        raise RuntimeError("Ollama request timed out (120s)")
    except Exception as e:
        raise RuntimeError(f"Ollama error: {e}")


def _litellm_chat(model: str, messages: list[dict], json_mode: bool = False) -> str:
    """Call any provider via litellm (if installed)."""
    try:
        import litellm
        litellm.set_verbose = False

        kwargs: dict = {"model": model, "messages": messages}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        # Set Ollama base URL if using ollama provider
        if model.startswith("ollama"):
            kwargs["api_base"] = _get_ollama_url()

        response = litellm.completion(**kwargs)
        return response.choices[0].message.content or ""
    except ImportError:
        raise RuntimeError("litellm not installed. Use 'pip install litellm' or switch to ollama provider.")


def _gemini_chat(model: str, messages: list[dict], json_mode: bool = False) -> str:
    """Call Google Gemini API directly."""
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("AUDIOMUSE_GEMINI_API_KEY", "")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")

    model_name = model.removeprefix("gemini/")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"

    # Convert messages to Gemini format
    system_parts = [m["content"] for m in messages if m["role"] == "system"]
    user_parts = [m["content"] for m in messages if m["role"] == "user"]

    body: dict = {
        "contents": [{"parts": [{"text": p}]} for p in user_parts],
    }
    if system_parts:
        body["systemInstruction"] = {"parts": [{"text": "\n".join(system_parts)}]}
    if json_mode:
        body["generationConfig"] = {"responseMimeType": "application/json"}

    try:
        resp = requests.post(url, json=body, params={"key": api_key}, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        candidates = data.get("candidates", [])
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            if parts:
                return parts[0].get("text", "")
        return ""
    except Exception as e:
        raise RuntimeError(f"Gemini error: {e}")


def _chat(model: str, messages: list[dict], json_mode: bool = False) -> str:
    """Route to the appropriate backend."""
    if model.startswith("ollama/") or model.startswith("ollama_chat/"):
        return _ollama_chat(model, messages, json_mode)
    if model.startswith("gemini/"):
        return _gemini_chat(model, messages, json_mode)
    return _litellm_chat(model, messages, json_mode)


# ── Public API ──────────────────────────────────────────────────

def ask(prompt: str, *, system: str = "", model: str | None = None) -> str:
    """Ask an LLM a free-form question. Returns plain text."""
    m = model or _get_model()
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    return _chat(m, messages)


def ask_structured(
    response_model: type[T],
    prompt: str,
    *,
    system: str = "",
    model: str | None = None,
) -> T:
    """Ask an LLM and parse the response into a Pydantic model.

    Uses JSON mode + schema instructions in the prompt.
    Works with any provider — no instructor dependency needed.
    """
    m = model or _get_model()

    schema = response_model.model_json_schema()
    schema_str = json.dumps(schema, indent=2)

    system_full = (system + "\n\n" if system else "")
    system_full += (
        f"You must respond with ONLY a valid JSON object matching this schema:\n"
        f"```json\n{schema_str}\n```\n"
        f"No markdown, no explanation, no extra text — just the JSON object."
    )

    messages = [
        {"role": "system", "content": system_full},
        {"role": "user", "content": prompt},
    ]

    raw = _chat(m, messages, json_mode=True)

    # Parse the response
    try:
        # Strip markdown fences if present
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()

        data = json.loads(cleaned)
        try:
            return response_model.model_validate(data)
        except Exception:
            # Small models sometimes nest data inside "properties" (echoing the schema)
            if isinstance(data, dict) and "properties" in data:
                flat = {}
                for k, v in data["properties"].items():
                    if isinstance(v, (list, str, int, float, bool)):
                        flat[k] = v
                    elif isinstance(v, dict) and len(v) == 1:
                        flat[k] = next(iter(v.values()))
                if flat:
                    return response_model.model_validate(flat)
            raise
    except (json.JSONDecodeError, Exception) as e:
        log.warning("Failed to parse LLM response as %s: %s\nRaw: %s", response_model.__name__, e, raw[:200])
        raise ValueError(f"LLM returned invalid JSON: {e}") from e
