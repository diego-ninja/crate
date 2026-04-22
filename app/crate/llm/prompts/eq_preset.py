"""EQ preset generation for music genres via LLM."""

from pydantic import BaseModel, Field


class EqPresetResponse(BaseModel):
    """10-band EQ preset for a music genre."""
    gains: list[float] = Field(
        description="10 gain values in dB, one per band: 32Hz, 64Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz. Range: -12.0 to +12.0",
        min_length=10,
        max_length=10,
    )
    reasoning: str = Field(
        default="",
        description="Brief explanation of why these EQ settings suit this genre",
    )


EQ_SYSTEM_PROMPT = """You are an expert audio engineer specializing in music production and mastering.
You have deep knowledge of how different music genres sound and what frequency adjustments
enhance the listening experience for each genre.

The 10-band EQ frequencies are: 32Hz, 64Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz.
Gain values range from -12.0 to +12.0 dB. Use moderate adjustments (typically -6 to +6).
0.0 means no change. Positive boosts, negative cuts."""


def build_eq_prompt(genre_name: str, description: str | None = None, parent_genres: list[str] | None = None) -> str:
    """Build the user prompt for EQ generation."""
    parts = [f'Generate a 10-band equalizer preset optimized for listening to "{genre_name}" music.']

    if description:
        parts.append(f"Genre description: {description}")

    if parent_genres:
        parts.append(f"Related parent genres: {', '.join(parent_genres)}")

    parts.append(
        "Consider the typical frequency characteristics of this genre: "
        "what frequencies define its sound, what should be boosted for clarity, "
        "what should be cut to reduce muddiness."
    )

    return "\n".join(parts)


def generate_eq_preset(genre_name: str, description: str | None = None, parent_genres: list[str] | None = None) -> EqPresetResponse:
    """Generate an EQ preset for a genre using the configured LLM."""
    from crate.llm import ask_structured

    prompt = build_eq_prompt(genre_name, description, parent_genres)
    return ask_structured(
        EqPresetResponse,
        prompt,
        system=EQ_SYSTEM_PROMPT,
    )
