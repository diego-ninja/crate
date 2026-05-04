from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher
import logging
import re

from crate.db.genres import (
    get_genre_cooccurring_album_slugs,
    get_genre_cooccurring_artist_slugs,
    get_genre_seed_artists,
    get_unmapped_genre_count,
    list_unmapped_genres_for_inference,
)
from crate.db.jobs.genre_taxonomy import assign_genre_alias_value
from crate.genre_taxonomy import (
    get_genre_alias_terms,
    get_genre_catalog,
    get_top_level_slug,
    resolve_genre_slug,
)

log = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"[a-z0-9]+")


@dataclass
class InferenceEvidence:
    cooccurring: dict[str, float]
    external: dict[str, float]
    family_hints: dict[str, float]
    artists: list[str]


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower()).strip()


def _tokenize(value: str) -> set[str]:
    return set(_TOKEN_RE.findall(_normalize_text(value)))


def _sequence_similarity(left: str, right: str) -> float:
    left_norm = _normalize_text(left)
    right_norm = _normalize_text(right)
    if not left_norm or not right_norm:
        return 0.0
    return SequenceMatcher(None, left_norm, right_norm).ratio()


def _lexical_match_score(raw_name: str, candidate_text: str) -> float:
    raw_norm = _normalize_text(raw_name)
    candidate_norm = _normalize_text(candidate_text)
    if not raw_norm or not candidate_norm:
        return 0.0
    if raw_norm == candidate_norm:
        return 1.0

    raw_tokens = _tokenize(raw_norm)
    candidate_tokens = _tokenize(candidate_norm)
    if not raw_tokens or not candidate_tokens:
        return 0.0

    overlap = len(raw_tokens & candidate_tokens) / max(len(raw_tokens | candidate_tokens), 1)
    score = _sequence_similarity(raw_norm, candidate_norm) * 0.7 + overlap * 0.3

    if candidate_norm in raw_norm or raw_norm in candidate_norm:
        score += 0.18
    if candidate_tokens.issubset(raw_tokens):
        score += 0.14
    if raw_tokens.issubset(candidate_tokens):
        score += 0.08

    return min(score, 1.0)


def _family_hints_from_name(raw_name: str) -> dict[str, float]:
    text = _normalize_text(raw_name)
    hints: dict[str, float] = {}
    keyword_map = {
        "metal": "metal",
        "doom": "doom-metal",
        "thrash": "thrash-metal",
        "blackened": "black-metal",
        "black": "black-metal",
        "death": "death-metal",
        "grind": "grindcore",
        "sludge": "sludge-metal",
        "stoner": "stoner-metal",
        "hardcore": "hardcore-punk",
        "punk": "punk",
        "emo": "emo",
        "screamo": "screamo",
        "shoegaze": "shoegaze",
        "dream pop": "dream-pop",
        "post punk": "post-punk",
        "post-punk": "post-punk",
        "new wave": "new-wave",
        "new-wave": "new-wave",
        "industrial": "industrial",
        "techno": "techno",
        "house": "house",
        "trip hop": "trip-hop",
        "trip-hop": "trip-hop",
        "hip hop": "hip-hop",
        "hip-hop": "hip-hop",
        "rap": "hip-hop",
        "jazz": "jazz",
        "folk": "folk",
        "country": "folk",
        "ambient": "ambient",
        "pop": "pop",
        "rock": "rock",
        "grunge": "grunge",
    }
    for keyword, slug in keyword_map.items():
        if keyword in text:
            hints[slug] = max(hints.get(slug, 0.0), 1.0 if "-" in keyword or " " in keyword else 0.8)
            top_level_slug = get_top_level_slug(slug)
            if top_level_slug and top_level_slug != slug:
                hints[top_level_slug] = max(hints.get(top_level_slug, 0.0), 0.5)
    return hints


def infer_canonical_genre(
    raw_name: str,
    *,
    cooccurring: dict[str, float] | None = None,
    external: dict[str, float] | None = None,
    family_hints: dict[str, float] | None = None,
    aggressive: bool = True,
) -> dict | None:
    catalog = get_genre_catalog()
    raw_norm = _normalize_text(raw_name)
    if not raw_norm:
        return None

    direct_slug = resolve_genre_slug(raw_norm)
    if direct_slug in catalog:
        return {
            "canonical_slug": direct_slug,
            "confidence": 1.0,
            "mode": "direct",
            "reason": "Direct taxonomy alias or canonical match",
        }

    cooccurring = cooccurring or {}
    external = external or {}
    family_hints = family_hints or _family_hints_from_name(raw_norm)

    scores: dict[str, float] = defaultdict(float)
    reasons: dict[str, list[str]] = defaultdict(list)
    lexical_scores: dict[str, float] = {}

    for slug in catalog:
        best_lexical = max((_lexical_match_score(raw_norm, term) for term in get_genre_alias_terms(slug)), default=0.0)
        lexical_scores[slug] = best_lexical
        if best_lexical >= 0.42:
            lexical_score = best_lexical * 2.1
            scores[slug] += lexical_score
            reasons[slug].append(f"lexical {best_lexical:.2f}")

    for source_scores, label, factor in (
        (cooccurring, "local", 0.38),
        (external, "external", 0.28),
        (family_hints, "hint", 0.70),
    ):
        for slug, raw_score in source_scores.items():
            if slug not in catalog:
                continue
            score = max(float(raw_score), 0.0)
            if score <= 0:
                continue
            weighted = min(score, 12.0) * factor
            scores[slug] += weighted
            reasons[slug].append(f"{label} {score:.2f}")
            top_level_slug = get_top_level_slug(slug)
            if top_level_slug and top_level_slug in catalog and top_level_slug != slug:
                top_level_weight = weighted * (0.48 if label == "hint" else 0.32)
                scores[top_level_slug] += top_level_weight
                reasons[top_level_slug].append(f"{label}-family {score:.2f}")

    # If the raw tag strongly resembles a specific child genre and the local
    # evidence points to that child's broader family, prefer the specific node
    # over the generic top-level bucket.
    for slug, best_lexical in lexical_scores.items():
        if best_lexical < 0.72 or bool(catalog[slug]["top_level"]):
            continue
        top_level_slug = get_top_level_slug(slug)
        if not top_level_slug or top_level_slug == slug:
            continue
        family_score = scores.get(top_level_slug, 0.0)
        if family_score <= 0:
            continue
        refinement_bonus = min(family_score * 0.55, 1.2 + best_lexical * 0.45)
        scores[slug] += refinement_bonus
        reasons[slug].append(f"family-specific {family_score:.2f}")

    if not scores:
        return None

    ordered = sorted(
        scores.items(),
        key=lambda item: (
            -item[1],
            catalog[item[0]]["top_level"],
            item[0],
        ),
    )
    best_slug, best_score = ordered[0]
    runner_up_score = ordered[1][1] if len(ordered) > 1 else 0.0
    margin = best_score - runner_up_score
    best_is_top_level = bool(catalog[best_slug]["top_level"])
    best_lexical = lexical_scores.get(best_slug, 0.0)

    if not best_is_top_level and (best_lexical >= 0.78 or (best_score >= 2.15 and margin >= 0.18)):
        confidence = min(0.99, 0.55 + best_lexical * 0.25 + min(best_score, 4.0) * 0.06)
        return {
            "canonical_slug": best_slug,
            "confidence": round(confidence, 3),
            "mode": "specific",
            "reason": ", ".join(reasons[best_slug][:4]),
        }

    if aggressive:
        family_candidates = [
            (slug, score)
            for slug, score in ordered
            if catalog[slug]["top_level"] or get_top_level_slug(slug) == slug
        ]
        if family_candidates:
            family_slug, family_score = family_candidates[0]
            if family_score >= 0.72:
                confidence = min(0.92, 0.42 + min(family_score, 3.0) * 0.12)
                return {
                    "canonical_slug": family_slug,
                    "confidence": round(confidence, 3),
                    "mode": "family",
                    "reason": ", ".join(reasons[family_slug][:4]),
                }

    return None


def _list_unmapped_genres(limit: int, focus_slug: str | None = None) -> list[dict]:
    return list_unmapped_genres_for_inference(limit=limit, focus_slug=focus_slug)


def _collect_local_evidence(genre_slug: str, genre_name: str) -> InferenceEvidence:
    artist_rows = get_genre_seed_artists(genre_slug)
    cooccurring_rows = get_genre_cooccurring_artist_slugs(genre_slug)
    album_rows = get_genre_cooccurring_album_slugs(genre_slug)

    cooccurring: dict[str, float] = defaultdict(float)
    for row in cooccurring_rows:
        slug = row["canonical_slug"]
        cooccurring[slug] += float(row.get("score") or 0) + float(row.get("hits") or 0) * 0.25
    for row in album_rows:
        slug = row["canonical_slug"]
        cooccurring[slug] += float(row.get("score") or 0) * 0.8 + float(row.get("hits") or 0) * 0.2

    artists = [row["artist_name"] for row in artist_rows if row.get("artist_name")]
    family_hints = _family_hints_from_name(genre_name)
    for slug, score in cooccurring.items():
        top_level_slug = get_top_level_slug(slug)
        if top_level_slug and top_level_slug != slug:
            family_hints[top_level_slug] = family_hints.get(top_level_slug, 0.0) + min(score, 8.0) * 0.12

    return InferenceEvidence(
        cooccurring=dict(cooccurring),
        external={},
        family_hints=family_hints,
        artists=artists,
    )


def _collect_external_evidence(artists: list[str]) -> dict[str, float]:
    evidence: dict[str, float] = defaultdict(float)
    if not artists:
        return {}

    try:
        from crate.lastfm import get_artist_info
    except ImportError:
        get_artist_info = None
    try:
        from crate.spotify import search_artist
    except ImportError:
        search_artist = None

    for index, artist_name in enumerate(artists[:5]):
        artist_weight = max(1.0, 3.0 - index * 0.45)

        if get_artist_info is not None:
            try:
                info = get_artist_info(artist_name) or {}
                for tag_index, tag_name in enumerate(info.get("tags") or []):
                    canonical_slug = resolve_genre_slug(tag_name)
                    if canonical_slug:
                        evidence[canonical_slug] += max(0.3, artist_weight - tag_index * 0.18)
            except Exception:
                log.debug("Last.fm genre evidence failed for %s", artist_name, exc_info=True)

        if search_artist is not None:
            try:
                artist = search_artist(artist_name) or {}
                for tag_index, genre_name in enumerate(artist.get("genres") or []):
                    canonical_slug = resolve_genre_slug(genre_name)
                    if canonical_slug:
                        evidence[canonical_slug] += max(0.25, artist_weight - tag_index * 0.15)
            except Exception:
                log.debug("Spotify genre evidence failed for %s", artist_name, exc_info=True)

    return dict(evidence)


def infer_genre_taxonomy_batch(
    *,
    limit: int = 200,
    focus_slug: str | None = None,
    aggressive: bool = True,
    include_external: bool = True,
    progress_callback=None,
    event_callback=None,
) -> dict:
    unmapped = _list_unmapped_genres(limit=limit, focus_slug=focus_slug)
    total = len(unmapped)
    mapped = 0
    skipped = 0
    examples_mapped: list[dict] = []
    examples_skipped: list[dict] = []

    if progress_callback:
        progress_callback(
            {
                "phase": "collecting",
                "done": 0,
                "total": total,
                "mapped": 0,
                "skipped": 0,
            }
        )

    for index, item in enumerate(unmapped, start=1):
        genre_slug = item["slug"]
        genre_name = item["name"]
        if event_callback:
            event_callback({"message": f"Inferring taxonomy for {genre_name}", "genre": genre_name, "step": index, "total": total})

        evidence = _collect_local_evidence(genre_slug, genre_name)

        if include_external and evidence.artists:
            evidence.external = _collect_external_evidence(evidence.artists)
            for slug, score in evidence.external.items():
                top_level_slug = get_top_level_slug(slug)
                if top_level_slug and top_level_slug != slug:
                    evidence.family_hints[top_level_slug] = evidence.family_hints.get(top_level_slug, 0.0) + min(score, 6.0) * 0.08

        proposal = infer_canonical_genre(
            genre_name,
            cooccurring=evidence.cooccurring,
            external=evidence.external,
            family_hints=evidence.family_hints,
            aggressive=aggressive,
        )

        applied = False
        if proposal and proposal.get("canonical_slug"):
            applied = assign_genre_alias_value(genre_name, proposal["canonical_slug"])

        if applied:
            mapped += 1
            if len(examples_mapped) < 20:
                examples_mapped.append(
                    {
                        "source_slug": genre_slug,
                        "source_name": genre_name,
                        "canonical_slug": proposal["canonical_slug"],
                        "confidence": proposal["confidence"],
                        "mode": proposal["mode"],
                        "reason": proposal["reason"],
                    }
                )
            if event_callback:
                event_callback(
                    {
                        "message": f"{genre_name} → {proposal['canonical_slug']}",
                        "genre": genre_name,
                        "canonical_slug": proposal["canonical_slug"],
                        "confidence": proposal["confidence"],
                    }
                )
        else:
            skipped += 1
            if len(examples_skipped) < 20:
                examples_skipped.append(
                    {
                        "source_slug": genre_slug,
                        "source_name": genre_name,
                        "reason": (proposal or {}).get("reason") or "No confident taxonomy match",
                    }
                )

        if progress_callback:
            progress_callback(
                {
                    "phase": "inferring",
                    "done": index,
                    "total": total,
                    "mapped": mapped,
                    "skipped": skipped,
                    "genre": genre_name,
                }
            )

    remaining_unmapped = get_unmapped_genre_count()

    return {
        "processed": total,
        "mapped": mapped,
        "skipped": skipped,
        "remaining_unmapped": remaining_unmapped,
        "include_external": include_external,
        "aggressive": aggressive,
        "examples_mapped": examples_mapped,
        "examples_skipped": examples_skipped,
    }
