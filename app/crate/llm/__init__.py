"""Generic LLM integration layer.

Multi-provider via LiteLLM. Structured output via instructor.
Default: Ollama (self-hosted, free). Override via settings or env vars.

Usage:
    from crate.llm import ask, ask_structured
    from pydantic import BaseModel

    # Free-form
    answer = ask("What genre is Converge?")

    # Structured (returns a Pydantic model)
    class EqPreset(BaseModel):
        gains: list[float]

    preset = ask_structured(EqPreset, "Generate a 10-band EQ for death metal")
"""

from crate.llm.provider import ask, ask_structured, get_config

__all__ = ["ask", "ask_structured", "get_config"]
