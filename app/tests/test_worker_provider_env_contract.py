from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
PROVIDER_ENV_KEYS = {
    "LASTFM_APIKEY",
    "LASTFM_API_SECRET",
    "FANART_API_KEY",
    "SPOTIFY_ID",
    "SPOTIFY_SECRET",
    "SETLISTFM_API_KEY",
    "DISCOGS_CONSUMER_KEY",
    "DISCOGS_CONSUMER_SECRET",
    "TICKETMASTER_API_KEY",
    "LLM_PROVIDER",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "AUDIOMUSE_GEMINI_API_KEY",
}


def _environment_keys(compose_name: str, service_name: str) -> set[str]:
    compose = yaml.safe_load((ROOT / compose_name).read_text())
    environment = compose["services"][service_name]["environment"]
    if isinstance(environment, dict):
        return set(environment)
    return {entry.split("=", 1)[0] for entry in environment}


def test_maintenance_worker_receives_enrichment_provider_environment() -> None:
    for compose_name in ("docker-compose.yaml", "docker-compose.home.yaml"):
        environment_keys = _environment_keys(
            compose_name,
            "crate-maintenance-worker",
        )
        assert PROVIDER_ENV_KEYS <= environment_keys


def test_dev_llm_workers_receive_provider_environment() -> None:
    required_keys = {
        "LLM_PROVIDER",
        "GEMINI_API_KEY",
        "AUDIOMUSE_GEMINI_API_KEY",
    }
    for service_name in ("worker", "maintenance-worker"):
        environment_keys = _environment_keys("docker-compose.dev.yaml", service_name)
        assert required_keys <= environment_keys
