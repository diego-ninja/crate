from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import re
import unicodedata


def slugify_genre(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", (value or "").strip().lower())
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")
    return slug


@dataclass(frozen=True)
class GenreDefinition:
    slug: str
    name: str
    description: str = ""
    top_level: bool = False
    aliases: tuple[str, ...] = ()
    parents: tuple[str, ...] = ()
    related: tuple[str, ...] = ()
    # 10-band equalizer gains in dB, index-aligned with the frontend's
    # EQ_BANDS (32 / 64 / 125 / 250 / 500 / 1K / 2K / 4K / 8K / 16K Hz).
    # None means "inherit from the first ancestor that has one", which
    # is resolved on demand by resolve_genre_eq_preset().
    eq_gains: tuple[float, ...] | None = None


# ── EQ preset templates ─────────────────────────────────────────────
#
# Reused across multiple GenreDefinition entries so the per-genre
# mapping stays readable and single-source. Values mirror the curves
# defined in app/listen/src/lib/equalizer.ts — if you tune one side,
# sync the other.

_EQ_ROCK        = (4.0, 3.0, -1.0, -3.0, -2.0, 1.0, 3.0, 5.0, 5.0, 5.0)
_EQ_POP         = (-1.0, 2.0, 4.0, 4.0, 2.0, -1.0, -1.0, -1.0, -1.0, -1.0)
_EQ_JAZZ        = (3.0, 2.0, 1.0, 2.0, -1.0, -1.0, 0.0, 1.0, 2.0, 3.0)
_EQ_CLASSICAL   = (4.0, 3.0, 2.0, 1.0, -1.0, -1.0, 0.0, 2.0, 3.0, 4.0)
_EQ_ELECTRONIC  = (5.0, 4.0, 1.0, -1.0, -2.0, 1.0, 0.0, 1.0, 4.0, 5.0)
_EQ_ACOUSTIC    = (4.0, 3.0, 2.0, 1.0, 2.0, 2.0, 3.0, 3.0, 2.0, 1.0)
_EQ_HIP_HOP     = (6.0, 5.0, 3.0, 1.0, 0.0, 1.0, 2.0, 3.0, 3.0, 2.0)
_EQ_BLACK_METAL = (-1.0, 3.0, 4.0, 1.0, -3.0, -2.0, 3.0, 6.0, 6.0, 4.0)
_EQ_DEATH_METAL = (2.0, 5.0, 6.0, 4.0, -3.0, -2.0, 4.0, 5.0, 2.0, 0.0)
_EQ_THRASH      = (3.0, 5.0, 4.0, 0.0, -4.0, -3.0, 2.0, 5.0, 6.0, 5.0)
_EQ_DOOM        = (6.0, 6.0, 5.0, 3.0, 0.0, -2.0, -3.0, -3.0, -2.0, -1.0)
_EQ_HARDCORE    = (4.0, 4.0, 2.0, -1.0, 1.0, 3.0, 5.0, 4.0, 2.0, 1.0)
_EQ_PUNK        = (2.0, 3.0, 1.0, -1.0, 2.0, 4.0, 4.0, 3.0, 1.0, -1.0)
_EQ_PROGRESSIVE = (2.0, 2.0, 1.0, 0.0, 0.0, 0.0, 1.0, 2.0, 3.0, 3.0)
_EQ_SHOEGAZE    = (1.0, 2.0, 3.0, 3.0, 4.0, 3.0, 2.0, 1.0, 0.0, 0.0)
_EQ_POST_ROCK   = (2.0, 2.0, 2.0, 1.0, 0.0, 0.0, 1.0, 2.0, 3.0, 3.0)
_EQ_LO_FI       = (1.0, 2.0, 2.0, 1.0, 1.0, 0.0, 0.0, 1.0, 2.0, 1.0)


_GENRE_DESCRIPTIONS: dict[str, str] = {
    "rock": "broad guitar-driven family spanning classic, hard and modern rock traditions.",
    "alternative": "umbrella for off-mainstream rock scenes with moodier, noisier or more experimental edges.",
    "metal": "heavy guitar-based family built around distortion, power riffs and high intensity.",
    "punk": "fast, direct and confrontational guitar music rooted in diy scenes.",
    "electronic": "music driven primarily by synths, drum machines and electronic production.",
    "hip-hop": "rhythm-first music built from rapping, beats, sampling and dj culture.",
    "jazz": "improvisation-heavy tradition centered on swing, harmony and instrumental interplay.",
    "soul": "groove-led black popular music built around voice, rhythm sections and emotional delivery.",
    "folk": "song-led acoustic-rooted family tied to traditional and regional forms.",
    "pop": "hook-forward mainstream songwriting built for immediacy and accessibility.",
    "ambient": "atmospheric, texture-driven music focused more on mood than on beat.",
    "indie-rock": "independent-minded guitar rock that sits between melody, texture and diy sensibility.",
    "post-punk": "angular, tense and art-minded rock that grew out of punk's energy and minimalism.",
    "shoegaze": "washed-out guitars, dense reverb and blurred melodies turned into a wall of texture.",
    "dream-pop": "soft-focus, melodic pop built from atmosphere, shimmer and hazy emotional tone.",
    "noise-rock": "abrasive guitar rock driven by dissonance, repetition and physical intensity.",
    "new-wave": "sharp, modernist pop-rock shaped by synths, hooks and late-70s art school instincts.",
    "gothic-rock": "dark, dramatic rock centered on baritone voices, chorus-soaked guitars and atmosphere.",
    "garage-rock": "raw, immediate rock with loose edges, simple hooks and a live-band feel.",
    "psychedelic-rock": "rock expanded through repetition, altered textures and a mind-bending sense of space.",
    "stoner-rock": "fuzzy, riff-heavy rock with desert grooves, repetition and a laid-back swing.",
    "grunge": "heavy, disaffected rock that fuses punk directness with sludgy metal weight.",
    "heavy-metal": "classic metal built around anthemic riffs, lead guitars and emphatic power.",
    "thrash-metal": "fast, aggressive metal that sharpens heavy metal with punk speed and attack.",
    "crossover-thrash": "bridge between thrash metal and hardcore punk built for speed and pit energy.",
    "death-metal": "extreme metal focused on heaviness, precision, growls and punishing rhythm work.",
    "black-metal": "extreme metal built from tremolo guitars, blast beats and bleak atmosphere.",
    "doom-metal": "slow, crushing metal that leans on weight, gloom and sustained riff pressure.",
    "sludge-metal": "filthy hybrid of doom weight and hardcore abrasion with a swampy low-end drag.",
    "stoner-metal": "metal variant of stoner riffing with thicker distortion and a heavier low-end pull.",
    "groove-metal": "syncopated, mid-tempo metal built around churning riffs and physical momentum.",
    "speed-metal": "high-velocity heavy metal that pushes tempo, precision and galloping riffs.",
    "power-metal": "melodic, triumphant metal driven by speed, fantasy scale and soaring vocals.",
    "progressive-metal": "technical and expansive metal that borrows structure and harmony from prog rock.",
    "industrial-metal": "metal fused with machine rhythms, cold textures and electronic abrasion.",
    "post-metal": "slow-building heavy music that treats metal as texture, tension and atmosphere.",
    "metalcore": "collision of metal riffing and hardcore breakdowns with modern production punch.",
    "grindcore": "hyper-fast extreme music where hardcore and death metal collapse into short violent bursts.",
    "nu-metal": "groove-heavy late-90s metal mixing downtuned riffs with hip-hop and alt-rock traits.",
    "hardcore-punk": "stripped-down, high-pressure punk built for speed, conviction and collective release.",
    "beatdown-hardcore": "hardcore punk built around mosh-heavy breakdowns, blunt riffs and crushing low-end momentum.",
    "powerviolence": "hyper-compressed hardcore built from violent tempo shifts, blast beats and abrupt structures.",
    "melodic-hardcore": "hardcore intensity balanced by bigger hooks, uplift and more melodic guitar work.",
    "post-hardcore": "hardcore expanded into dynamic, emotional and more textural song structures.",
    "skate-punk": "bright, fast punk with technical drumming, melody and an extroverted live feel.",
    "pop-punk": "punk energy funneled into catchy choruses, concise hooks and radio-sized songwriting.",
    "crust-punk": "bleak, abrasive punk with metallic edges, d-beat propulsion and political urgency.",
    "d-beat": "hardcore punk driven by the relentless, stomping drum pattern popularized by discharge.",
    "anarcho-punk": "politically charged punk centered on diy ethics, minimalism and confrontational messaging.",
    "art-punk": "punk filtered through experimentation, angularity and self-conscious art-school instincts.",
    "emo": "emotionally direct punk-rooted music focused on confession, tension and release.",
    "screamo": "chaotic, cathartic offshoot of emo built on screamed vocals and explosive dynamics.",
    "industrial": "mechanical electronic music built from repetition, noise and machine-like rhythm.",
    "synthpop": "melodic pop where synth lines, programmed rhythm and sleek surfaces lead the arrangement.",
    "techno": "club music built from machine rhythm, repetition and hypnotic forward motion.",
    "house": "four-on-the-floor dance music centered on groove, warmth and dj-friendly momentum.",
    "trip-hop": "downtempo beat music mixing hip-hop rhythm with atmosphere, soul and cinematic texture.",
    "blues": "roots-based music built on expressive vocal delivery, guitar and a 12-bar harmonic backbone.",
    "funk": "rhythm-forward music driven by syncopated bass lines, tight horns and a deep groove pocket.",
    "country": "song-driven tradition rooted in storytelling, acoustic and steel guitar, and rural americana sensibility.",
    "classical": "composed western art music spanning orchestral, chamber, choral and solo instrumental traditions.",
}


def _normalize_genre_definition(definition: GenreDefinition) -> GenreDefinition:
    slug = slugify_genre(definition.slug)
    name = (definition.name or definition.slug).strip().lower()
    description = (_GENRE_DESCRIPTIONS.get(slug) or definition.description or "").strip().lower()
    aliases = tuple(
        dict.fromkeys(
            normalized
            for normalized in ((alias or "").strip().lower() for alias in definition.aliases)
            if normalized
        )
    )
    parents = tuple(
        dict.fromkeys(
            normalized
            for normalized in (slugify_genre(parent_slug) for parent_slug in definition.parents)
            if normalized
        )
    )
    related = tuple(
        dict.fromkeys(
            normalized
            for normalized in (slugify_genre(related_slug) for related_slug in definition.related)
            if normalized and normalized != slug
        )
    )
    eq_gains = None
    if definition.eq_gains is not None:
        gains = tuple(float(v) for v in definition.eq_gains)
        if len(gains) == 10:
            eq_gains = gains
    return GenreDefinition(
        slug=slug,
        name=name,
        description=description,
        top_level=bool(definition.top_level),
        aliases=aliases,
        parents=parents,
        related=related,
        eq_gains=eq_gains,
    )


_RAW_GENRE_DEFINITIONS: tuple[GenreDefinition, ...] = (
    # ── Top-level families (always carry a direct preset) ──
    GenreDefinition("rock", "rock", top_level=True, aliases=("classic rock", "hard rock"), eq_gains=_EQ_ROCK),
    GenreDefinition("alternative", "alternative", top_level=True, aliases=("alternative rock", "alt rock"), eq_gains=_EQ_ROCK),
    GenreDefinition("metal", "metal", top_level=True, eq_gains=_EQ_THRASH),
    GenreDefinition("punk", "punk", top_level=True, aliases=("punk rock",), eq_gains=_EQ_PUNK),
    GenreDefinition("electronic", "electronic", top_level=True, aliases=("electronica",), eq_gains=_EQ_ELECTRONIC),
    GenreDefinition("hip-hop", "hip hop", top_level=True, aliases=("hip-hop", "rap"), eq_gains=_EQ_HIP_HOP),
    GenreDefinition("jazz", "jazz", top_level=True, related=("blues", "soul"), eq_gains=_EQ_JAZZ),
    GenreDefinition("blues", "blues", top_level=True, related=("jazz", "soul", "rock"), eq_gains=_EQ_JAZZ),
    GenreDefinition("soul", "soul", top_level=True, aliases=("r&b", "rhythm and blues"), related=("funk", "blues", "jazz"), eq_gains=_EQ_JAZZ),
    # funk inherits from soul
    GenreDefinition("funk", "funk", parents=("soul",), related=("hip-hop", "electronic")),
    GenreDefinition("folk", "folk", top_level=True, related=("country", "americana"), eq_gains=_EQ_ACOUSTIC),
    GenreDefinition("country", "country", top_level=True, aliases=("americana",), related=("folk", "rock"), eq_gains=_EQ_ACOUSTIC),
    GenreDefinition("pop", "pop", top_level=True, eq_gains=_EQ_POP),
    GenreDefinition("classical", "classical", top_level=True, related=("ambient",), eq_gains=_EQ_CLASSICAL),
    GenreDefinition("ambient", "ambient", top_level=True, related=("classical", "electronic"), eq_gains=_EQ_CLASSICAL),
    # ── Rock subgenres ──
    GenreDefinition("indie-rock", "indie rock", aliases=("indie",), parents=("alternative",), related=("garage-rock", "dream-pop", "shoegaze"), eq_gains=_EQ_LO_FI),
    # post-punk inherits → alternative
    GenreDefinition("post-punk", "post-punk", aliases=("post punk",), parents=("alternative",), related=("gothic-rock", "new-wave", "art-punk", "shoegaze")),
    GenreDefinition("shoegaze", "shoegaze", parents=("alternative",), related=("dream-pop", "noise-rock", "post-punk"), eq_gains=_EQ_SHOEGAZE),
    GenreDefinition("dream-pop", "dream pop", aliases=("dream-pop",), parents=("alternative",), related=("shoegaze", "post-punk", "indie-rock"), eq_gains=_EQ_SHOEGAZE),
    GenreDefinition("noise-rock", "noise rock", aliases=("noise-rock",), parents=("alternative",), related=("post-hardcore", "shoegaze", "art-punk"), eq_gains=_EQ_SHOEGAZE),
    GenreDefinition("new-wave", "new wave", aliases=("new-wave",), parents=("alternative",), related=("post-punk", "synthpop", "gothic-rock"), eq_gains=_EQ_ELECTRONIC),
    # gothic-rock, garage-rock, grunge inherit
    GenreDefinition("gothic-rock", "gothic rock", aliases=("gothic", "goth rock"), parents=("alternative",), related=("post-punk", "new-wave")),
    GenreDefinition("garage-rock", "garage rock", aliases=("garage-rock",), parents=("rock",), related=("indie-rock", "punk")),
    GenreDefinition("psychedelic-rock", "psychedelic rock", aliases=("psychedelic", "psych rock"), parents=("rock",), related=("stoner-rock", "doom-metal"), eq_gains=_EQ_PROGRESSIVE),
    GenreDefinition("stoner-rock", "stoner rock", aliases=("desert rock",), parents=("rock",), related=("stoner-metal", "doom-metal", "psychedelic-rock"), eq_gains=_EQ_DOOM),
    GenreDefinition("grunge", "grunge", parents=("rock",), related=("alternative", "sludge-metal", "stoner-rock")),
    # ── Metal subgenres ──
    GenreDefinition("heavy-metal", "heavy metal", parents=("metal",), related=("speed-metal", "power-metal", "thrash-metal", "doom-metal"), eq_gains=_EQ_ROCK),
    # thrash-metal / crossover-thrash / groove-metal / speed-metal inherit from metal (= _EQ_THRASH)
    GenreDefinition("thrash-metal", "thrash metal", aliases=("trash metal", "thrash"), parents=("metal",), related=("speed-metal", "groove-metal", "heavy-metal", "crossover-thrash")),
    GenreDefinition("crossover-thrash", "crossover thrash", aliases=("crossover",), parents=("metal",), related=("thrash-metal", "hardcore-punk", "punk")),
    GenreDefinition("death-metal", "death metal", parents=("metal",), related=("black-metal", "grindcore", "doom-metal"), eq_gains=_EQ_DEATH_METAL),
    GenreDefinition("black-metal", "black metal", parents=("metal",), related=("death-metal", "doom-metal", "post-metal"), eq_gains=_EQ_BLACK_METAL),
    GenreDefinition("doom-metal", "doom metal", parents=("metal",), related=("sludge-metal", "stoner-metal", "heavy-metal", "post-metal"), eq_gains=_EQ_DOOM),
    GenreDefinition("sludge-metal", "sludge metal", aliases=("sludge",), parents=("metal",), related=("doom-metal", "stoner-metal", "post-metal", "hardcore-punk"), eq_gains=_EQ_DOOM),
    GenreDefinition("stoner-metal", "stoner metal", parents=("metal",), related=("doom-metal", "sludge-metal", "stoner-rock"), eq_gains=_EQ_DOOM),
    GenreDefinition("groove-metal", "groove metal", parents=("metal",), related=("thrash-metal", "heavy-metal", "metalcore")),
    GenreDefinition("speed-metal", "speed metal", parents=("metal",), related=("heavy-metal", "thrash-metal", "power-metal")),
    GenreDefinition("power-metal", "power metal", parents=("metal",), related=("heavy-metal", "speed-metal", "progressive-metal"), eq_gains=_EQ_ROCK),
    GenreDefinition("progressive-metal", "progressive metal", aliases=("prog metal",), parents=("metal",), related=("post-metal", "power-metal", "metalcore"), eq_gains=_EQ_PROGRESSIVE),
    GenreDefinition("industrial-metal", "industrial metal", aliases=("industrial-metal",), parents=("metal",), related=("industrial", "nu-metal"), eq_gains=_EQ_ELECTRONIC),
    GenreDefinition("post-metal", "post-metal", aliases=("post metal",), parents=("metal",), related=("sludge-metal", "doom-metal", "progressive-metal", "black-metal"), eq_gains=_EQ_POST_ROCK),
    GenreDefinition("metalcore", "metalcore", parents=("metal",), related=("hardcore-punk", "post-hardcore", "melodic-hardcore", "groove-metal"), eq_gains=_EQ_HARDCORE),
    GenreDefinition("grindcore", "grindcore", parents=("metal",), related=("death-metal", "hardcore-punk", "crust-punk"), eq_gains=_EQ_DEATH_METAL),
    GenreDefinition("nu-metal", "nu metal", aliases=("nu-metal",), parents=("metal",), related=("industrial-metal", "alternative", "groove-metal"), eq_gains=_EQ_HARDCORE),
    # ── Punk subgenres ──
    GenreDefinition("hardcore-punk", "hardcore punk", aliases=("hardcore", "hc"), parents=("punk",), related=("melodic-hardcore", "post-hardcore", "crust-punk", "d-beat", "grindcore", "metalcore", "crossover-thrash"), eq_gains=_EQ_HARDCORE),
    # beatdown / powerviolence inherit from hardcore-punk
    GenreDefinition("beatdown-hardcore", "beatdown hardcore", aliases=("beatdown",), parents=("hardcore-punk",), related=("metalcore", "sludge-metal", "crossover-thrash")),
    GenreDefinition("powerviolence", "powerviolence", parents=("hardcore-punk",), related=("grindcore", "d-beat", "crust-punk")),
    GenreDefinition("melodic-hardcore", "melodic hardcore", aliases=("melodic-hardcore",), parents=("punk",), related=("hardcore-punk", "post-hardcore", "skate-punk", "emo"), eq_gains=_EQ_HARDCORE),
    GenreDefinition("post-hardcore", "post-hardcore", aliases=("post hardcore",), parents=("punk",), related=("hardcore-punk", "melodic-hardcore", "emo", "screamo", "noise-rock", "metalcore"), eq_gains=_EQ_HARDCORE),
    # skate-punk / pop-punk / crust / d-beat / anarcho / art-punk inherit from punk
    GenreDefinition("skate-punk", "skate punk", aliases=("skate-punk",), parents=("punk",), related=("melodic-hardcore", "pop-punk", "hardcore-punk")),
    GenreDefinition("pop-punk", "pop punk", aliases=("pop-punk",), parents=("punk",), related=("skate-punk", "emo", "alternative")),
    GenreDefinition("crust-punk", "crust punk", aliases=("crust",), parents=("punk",), related=("d-beat", "hardcore-punk", "grindcore", "sludge-metal")),
    GenreDefinition("d-beat", "d-beat", aliases=("dbeat",), parents=("punk",), related=("crust-punk", "hardcore-punk")),
    GenreDefinition("anarcho-punk", "anarcho-punk", aliases=("anarcho punk",), parents=("punk",), related=("art-punk", "crust-punk", "hardcore-punk")),
    GenreDefinition("art-punk", "art punk", aliases=("art-punk",), parents=("punk",), related=("post-punk", "noise-rock", "anarcho-punk")),
    GenreDefinition("emo", "emo", parents=("punk",), related=("post-hardcore", "screamo", "melodic-hardcore", "indie-rock"), eq_gains=_EQ_LO_FI),
    GenreDefinition("screamo", "screamo", parents=("punk",), related=("emo", "post-hardcore", "hardcore-punk"), eq_gains=_EQ_HARDCORE),
    # ── Electronic subgenres — industrial / synthpop / techno / house inherit ──
    GenreDefinition("industrial", "industrial", parents=("electronic",), related=("industrial-metal", "new-wave")),
    GenreDefinition("synthpop", "synthpop", parents=("electronic",), related=("new-wave", "dream-pop")),
    GenreDefinition("techno", "techno", parents=("electronic",), related=("house", "industrial")),
    GenreDefinition("house", "house", parents=("electronic",), related=("techno", "electronic")),
    GenreDefinition("trip-hop", "trip hop", aliases=("trip-hop",), parents=("electronic",), related=("hip-hop", "ambient"), eq_gains=_EQ_HIP_HOP),
)

_GENRE_DEFINITIONS: tuple[GenreDefinition, ...] = tuple(
    _normalize_genre_definition(definition) for definition in _RAW_GENRE_DEFINITIONS
)

_RUNTIME_GRAPH_CACHE: dict | None = None


def _empty_runtime_graph() -> dict:
    return {
        "nodes_by_slug": {},
        "aliases_to_slug": {},
        "alias_terms_by_slug": {},
        "parents_by_slug": {},
        "children_by_slug": {},
        "related_by_slug": {},
        "influenced_by_by_slug": {},
        "influenced_genres_by_slug": {},
        "fusion_of_by_slug": {},
        "fusion_genres_by_slug": {},
        # slug → tuple[float, ...] (length 10) when the node has its
        # own preset. Missing slugs inherit via parent BFS at resolve
        # time, so don't pre-populate fallbacks here.
        "eq_gains_by_slug": {},
    }


def _register_alias(graph: dict, canonical_slug: str, alias_value: str) -> None:
    alias_name = re.sub(r"\s+", " ", (alias_value or "").strip().lower()).strip()
    if not alias_name:
        return
    graph["aliases_to_slug"][alias_name] = canonical_slug
    alias_slug = slugify_genre(alias_name)
    if alias_slug:
        graph["aliases_to_slug"][alias_slug] = canonical_slug
    graph["alias_terms_by_slug"].setdefault(canonical_slug, set()).add(alias_name)


def _add_runtime_edge(graph: dict, source_slug: str, target_slug: str, relation_type: str) -> None:
    if not source_slug or not target_slug or source_slug == target_slug:
        return
    if relation_type == "parent":
        graph["parents_by_slug"].setdefault(source_slug, set()).add(target_slug)
        graph["children_by_slug"].setdefault(target_slug, set()).add(source_slug)
    elif relation_type == "related":
        graph["related_by_slug"].setdefault(source_slug, set()).add(target_slug)
        graph["related_by_slug"].setdefault(target_slug, set()).add(source_slug)
    elif relation_type == "influenced_by":
        graph["influenced_by_by_slug"].setdefault(source_slug, set()).add(target_slug)
        graph["influenced_genres_by_slug"].setdefault(target_slug, set()).add(source_slug)
    elif relation_type == "fusion_of":
        graph["fusion_of_by_slug"].setdefault(source_slug, set()).add(target_slug)
        graph["fusion_genres_by_slug"].setdefault(target_slug, set()).add(source_slug)


def _build_static_runtime_graph() -> dict:
    graph = _empty_runtime_graph()
    for definition in _GENRE_DEFINITIONS:
        graph["nodes_by_slug"][definition.slug] = {
            "slug": definition.slug,
            "name": definition.name,
            "description": definition.description,
            "top_level": definition.top_level,
        }
        _register_alias(graph, definition.slug, definition.slug.replace("-", " "))
        _register_alias(graph, definition.slug, definition.name)
        for alias in definition.aliases:
            _register_alias(graph, definition.slug, alias)
        for parent_slug in definition.parents:
            _add_runtime_edge(graph, definition.slug, parent_slug, "parent")
        for related_slug in definition.related:
            _add_runtime_edge(graph, definition.slug, related_slug, "related")
        if definition.eq_gains is not None:
            graph["eq_gains_by_slug"][definition.slug] = definition.eq_gains
    return graph


def _clone_runtime_graph(base: dict) -> dict:
    return {
        "nodes_by_slug": {slug: dict(meta) for slug, meta in base["nodes_by_slug"].items()},
        "aliases_to_slug": dict(base["aliases_to_slug"]),
        "alias_terms_by_slug": {slug: set(terms) for slug, terms in base["alias_terms_by_slug"].items()},
        "parents_by_slug": {slug: set(values) for slug, values in base["parents_by_slug"].items()},
        "children_by_slug": {slug: set(values) for slug, values in base["children_by_slug"].items()},
        "related_by_slug": {slug: set(values) for slug, values in base["related_by_slug"].items()},
        "influenced_by_by_slug": {slug: set(values) for slug, values in base["influenced_by_by_slug"].items()},
        "influenced_genres_by_slug": {slug: set(values) for slug, values in base["influenced_genres_by_slug"].items()},
        "fusion_of_by_slug": {slug: set(values) for slug, values in base["fusion_of_by_slug"].items()},
        "fusion_genres_by_slug": {slug: set(values) for slug, values in base["fusion_genres_by_slug"].items()},
        "eq_gains_by_slug": dict(base["eq_gains_by_slug"]),
    }


_STATIC_RUNTIME_GRAPH = _build_static_runtime_graph()


def invalidate_runtime_taxonomy_cache() -> None:
    global _RUNTIME_GRAPH_CACHE
    _RUNTIME_GRAPH_CACHE = None
    _DEPTH_CACHE.clear()


def _get_runtime_taxonomy_graph() -> dict:
    global _RUNTIME_GRAPH_CACHE

    if _RUNTIME_GRAPH_CACHE is not None:
        return _RUNTIME_GRAPH_CACHE

    graph = _clone_runtime_graph(_STATIC_RUNTIME_GRAPH)
    try:
        from crate.db.core import get_db_ctx

        with get_db_ctx() as cur:
            cur.execute(
                """
                SELECT slug, name, description, is_top_level, eq_gains
                FROM genre_taxonomy_nodes
                """
            )
            node_rows = cur.fetchall()
            cur.execute(
                """
                SELECT gta.alias_slug, gta.alias_name, tn.slug AS canonical_slug
                FROM genre_taxonomy_aliases gta
                JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
                """
            )
            alias_rows = cur.fetchall()
            cur.execute(
                """
                SELECT
                    source.slug AS source_slug,
                    target.slug AS target_slug,
                    edge.relation_type
                FROM genre_taxonomy_edges edge
                JOIN genre_taxonomy_nodes source ON source.id = edge.source_genre_id
                JOIN genre_taxonomy_nodes target ON target.id = edge.target_genre_id
                """
            )
            edge_rows = cur.fetchall()
    except Exception:
        _RUNTIME_GRAPH_CACHE = graph
        return graph

    for row in node_rows:
        slug = (row.get("slug") or "").strip().lower()
        if not slug:
            continue
        graph["nodes_by_slug"][slug] = {
            "slug": slug,
            "name": re.sub(r"\s+", " ", (row.get("name") or slug.replace("-", " ")).strip().lower()),
            "description": re.sub(r"\s+", " ", (row.get("description") or "").strip().lower()),
            "top_level": bool(row.get("is_top_level")),
        }
        _register_alias(graph, slug, slug.replace("-", " "))
        _register_alias(graph, slug, row.get("name") or slug.replace("-", " "))
        db_gains = row.get("eq_gains")
        if db_gains is not None:
            gains = tuple(float(v) for v in db_gains)
            if len(gains) == 10:
                graph["eq_gains_by_slug"][slug] = gains
        # NULL in DB → keep whatever the static seed says. The seeder
        # always upserts eq_gains to match the code, so NULL in DB only
        # happens on pre-migration installs where the column was added
        # without a re-seed; preferring the static copy keeps behavior
        # consistent without forcing a re-seed.

    for row in alias_rows:
        canonical_slug = (row.get("canonical_slug") or "").strip().lower()
        if not canonical_slug:
            continue
        _register_alias(graph, canonical_slug, row.get("alias_name") or "")
        _register_alias(graph, canonical_slug, row.get("alias_slug") or "")

    for row in edge_rows:
        source_slug = (row.get("source_slug") or "").strip().lower()
        target_slug = (row.get("target_slug") or "").strip().lower()
        relation_type = (row.get("relation_type") or "").strip().lower()
        _add_runtime_edge(graph, source_slug, target_slug, relation_type)

    _RUNTIME_GRAPH_CACHE = graph
    return graph


def get_genre_catalog() -> dict[str, dict]:
    graph = _get_runtime_taxonomy_graph()
    return {
        slug: {
            "slug": slug,
            "name": meta["name"],
            "description": meta["description"],
            "aliases": sorted(graph["alias_terms_by_slug"].get(slug, set())),
            "top_level": meta["top_level"],
            "parents": sorted(graph["parents_by_slug"].get(slug, set())),
            "related": sorted(graph["related_by_slug"].get(slug, set())),
            "influenced_by": sorted(graph["influenced_by_by_slug"].get(slug, set())),
            "fusion_of": sorted(graph["fusion_of_by_slug"].get(slug, set())),
        }
        for slug, meta in graph["nodes_by_slug"].items()
    }


def get_genre_alias_terms(slug: str) -> list[str]:
    graph = _get_runtime_taxonomy_graph()
    canonical_slug = resolve_genre_slug(slug) or slugify_genre(slug)
    if canonical_slug not in graph["nodes_by_slug"]:
        return []
    base_terms = graph["alias_terms_by_slug"].get(canonical_slug, set())
    ordered = [
        graph["nodes_by_slug"][canonical_slug]["name"],
        canonical_slug.replace("-", " "),
        *sorted(base_terms),
    ]
    terms: list[str] = []
    seen: set[str] = set()
    for candidate in ordered:
        normalized = re.sub(r"\s+", " ", (candidate or "").strip().lower()).strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            terms.append(normalized)
    return terms


def assign_genre_alias(cur, alias_value: str, canonical_slug: str) -> bool:
    alias_name = (alias_value or "").strip().lower()
    alias_slug = slugify_genre(alias_name)
    canonical_slug = (canonical_slug or "").strip().lower()
    if not alias_name or not alias_slug or not canonical_slug:
        return False

    cur.execute("SELECT id, name FROM genre_taxonomy_nodes WHERE slug = %s", (canonical_slug,))
    node_row = cur.fetchone()
    if not node_row:
        return False

    cur.execute(
        "DELETE FROM genre_taxonomy_aliases WHERE alias_name = %s AND alias_slug != %s",
        (alias_name, alias_slug),
    )
    cur.execute(
        """
        INSERT INTO genre_taxonomy_aliases (alias_slug, alias_name, genre_id)
        VALUES (%s, %s, %s)
        ON CONFLICT (alias_slug) DO UPDATE
        SET alias_name = EXCLUDED.alias_name,
            genre_id = EXCLUDED.genre_id
        """,
        (alias_slug, alias_name, node_row["id"]),
    )
    invalidate_runtime_taxonomy_cache()
    return True


def split_genre_names(value: str) -> list[str]:
    names: list[str] = []
    for part in re.split(r"[;,]", value or ""):
        normalized = part.strip().lower()
        if normalized and normalized not in names:
            names.append(normalized)
    return names


def resolve_genre_slug(value: str) -> str | None:
    normalized = (value or "").strip().lower()
    if not normalized:
        return None
    graph = _get_runtime_taxonomy_graph()
    direct = graph["aliases_to_slug"].get(normalized)
    if direct:
        return direct
    slug = slugify_genre(normalized)
    if not slug:
        return None
    if slug in graph["aliases_to_slug"]:
        return graph["aliases_to_slug"][slug]
    return slug


def get_genre_display_name(value: str) -> str:
    graph = _get_runtime_taxonomy_graph()
    slug = resolve_genre_slug(value)
    if slug and slug in graph["nodes_by_slug"]:
        return graph["nodes_by_slug"][slug]["name"]
    normalized = re.sub(r"\s+", " ", (value or "").replace("-", " ").strip().lower())
    return normalized


def is_canonical_genre_slug(slug: str) -> bool:
    """Return True iff *slug* is a node in the taxonomy graph (not an
    arbitrary slugified raw tag)."""
    if not slug:
        return False
    graph = _get_runtime_taxonomy_graph()
    return slug in graph["nodes_by_slug"]


def resolve_genre_eq_preset(value: str) -> dict | None:
    """Resolve the EQ preset for *value* (raw tag or canonical slug).

    If the node has its own ``eq_gains`` we return those directly
    (``source == "direct"``). Otherwise we BFS up through parents,
    shortest depth first, and return the first ancestor that owns a
    preset (``source == "inherited"``) along with the slug it came
    from so the UI can explain the inheritance.

    Returns ``None`` when no ancestor has a preset — the caller should
    treat that as "hold flat".
    """
    graph = _get_runtime_taxonomy_graph()
    canonical_slug = resolve_genre_slug(value)
    if not canonical_slug or canonical_slug not in graph["nodes_by_slug"]:
        return None

    own = graph["eq_gains_by_slug"].get(canonical_slug)
    if own is not None:
        return {
            "gains": list(own),
            "source": "direct",
            "slug": canonical_slug,
            "name": graph["nodes_by_slug"][canonical_slug]["name"],
        }

    # BFS up through parents; shortest depth wins. When a node has
    # multiple parents we break ties alphabetically so the result is
    # deterministic.
    queue: deque[tuple[str, int]] = deque(
        (parent_slug, 1) for parent_slug in sorted(graph["parents_by_slug"].get(canonical_slug, set()))
    )
    seen: set[str] = {canonical_slug}

    while queue:
        current_slug, _depth = queue.popleft()
        if current_slug in seen:
            continue
        seen.add(current_slug)
        gains = graph["eq_gains_by_slug"].get(current_slug)
        if gains is not None:
            return {
                "gains": list(gains),
                "source": "inherited",
                "slug": current_slug,
                "name": graph["nodes_by_slug"].get(current_slug, {}).get("name") or current_slug.replace("-", " "),
            }
        for parent_slug in sorted(graph["parents_by_slug"].get(current_slug, set())):
            if parent_slug not in seen:
                queue.append((parent_slug, _depth + 1))

    return None


def get_genre_description(value: str) -> str:
    graph = _get_runtime_taxonomy_graph()
    slug = resolve_genre_slug(value)
    if slug and slug in graph["nodes_by_slug"]:
        return graph["nodes_by_slug"][slug]["description"]
    return ""


_DEPTH_CACHE: dict[str, int] = {}


def _genre_depth(slug: str) -> int:
    if slug in _DEPTH_CACHE:
        return _DEPTH_CACHE[slug]
    graph = _get_runtime_taxonomy_graph()
    if slug not in graph["nodes_by_slug"]:
        _DEPTH_CACHE[slug] = 0
        return 0
    queue: deque[tuple[str, int]] = deque([(slug, 0)])
    seen: set[str] = {slug}
    best_depth: int | None = None
    while queue:
        current_slug, depth = queue.popleft()
        parents = graph["parents_by_slug"].get(current_slug, set())
        if not parents:
            best_depth = depth if best_depth is None else min(best_depth, depth)
            continue
        for parent_slug in sorted(parents):
            if parent_slug in seen:
                continue
            seen.add(parent_slug)
            queue.append((parent_slug, depth + 1))
    result = best_depth or 0
    _DEPTH_CACHE[slug] = result
    return result


def get_top_level_slug(value: str) -> str:
    graph = _get_runtime_taxonomy_graph()
    slug = resolve_genre_slug(value)
    if not slug:
        return ""
    queue: deque[tuple[str, int]] = deque([(slug, 0)])
    seen: set[str] = {slug}
    candidates: list[tuple[int, str, str]] = []
    while queue:
        current_slug, depth = queue.popleft()
        node = graph["nodes_by_slug"].get(current_slug)
        if not node:
            continue
        if node["top_level"]:
            candidates.append((depth, node["name"], current_slug))
            continue
        parents = graph["parents_by_slug"].get(current_slug, set())
        if not parents:
            candidates.append((depth, node["name"], current_slug))
            continue
        for parent_slug in sorted(parents):
            if parent_slug in seen:
                continue
            seen.add(parent_slug)
            queue.append((parent_slug, depth + 1))
    if candidates:
        return sorted(candidates)[0][2]
    return slug


def get_related_genre_terms(value: str, *, limit: int = 24, max_depth: int = 2) -> list[str]:
    graph = _get_runtime_taxonomy_graph()
    seed_slug = resolve_genre_slug(value)
    if not seed_slug:
        normalized = (value or "").strip().lower()
        return [normalized] if normalized else []
    if seed_slug not in graph["nodes_by_slug"]:
        normalized = seed_slug.replace("-", " ").strip().lower()
        return [normalized] if normalized else []

    scores: dict[str, int] = {seed_slug: 1000}
    queue: deque[tuple[str, int]] = deque([(seed_slug, 0)])

    while queue:
        current_slug, depth = queue.popleft()
        if depth >= max_depth:
            continue
        current = graph["nodes_by_slug"].get(current_slug)
        if not current:
            continue
        neighbors: list[tuple[str, int]] = []
        neighbors.extend((parent_slug, 170 - depth * 20) for parent_slug in graph["parents_by_slug"].get(current_slug, set()))
        neighbors.extend((child_slug, 250 - depth * 30) for child_slug in graph["children_by_slug"].get(current_slug, set()))
        neighbors.extend((related_slug, 225 - depth * 25) for related_slug in graph["related_by_slug"].get(current_slug, set()))
        neighbors.extend((influence_slug, 195 - depth * 20) for influence_slug in graph["influenced_by_by_slug"].get(current_slug, set()))
        neighbors.extend((influenced_slug, 175 - depth * 20) for influenced_slug in graph["influenced_genres_by_slug"].get(current_slug, set()))
        neighbors.extend((fusion_slug, 205 - depth * 20) for fusion_slug in graph["fusion_of_by_slug"].get(current_slug, set()))
        neighbors.extend((fusion_child_slug, 185 - depth * 20) for fusion_child_slug in graph["fusion_genres_by_slug"].get(current_slug, set()))
        for neighbor_slug, base_score in neighbors:
            candidate_score = base_score - (depth * 10)
            if candidate_score <= scores.get(neighbor_slug, -1):
                continue
            scores[neighbor_slug] = candidate_score
            queue.append((neighbor_slug, depth + 1))

    ordered_slugs = [
        slug
        for slug, _ in sorted(
            scores.items(),
            key=lambda item: (
                -item[1],
                graph["nodes_by_slug"].get(item[0], {"top_level": False})["top_level"],
                -_genre_depth(item[0]),
                graph["nodes_by_slug"].get(item[0], {"name": item[0].replace("-", " ")})["name"],
            ),
        )
    ]

    terms: list[str] = []
    seen_terms: set[str] = set()
    for slug in ordered_slugs:
        node = graph["nodes_by_slug"].get(slug)
        candidate = node["name"] if node else slug.replace("-", " ")
        normalized = (candidate or "").strip().lower()
        if not normalized or normalized in seen_terms:
            continue
        seen_terms.add(normalized)
        terms.append(normalized)
        if len(terms) >= limit:
            return terms
    for slug in ordered_slugs:
        for candidate in sorted(graph["alias_terms_by_slug"].get(slug, set())):
            normalized = (candidate or "").strip().lower()
            if not normalized or normalized in seen_terms:
                continue
            seen_terms.add(normalized)
            terms.append(normalized)
            if len(terms) >= limit:
                return terms
    return terms


def expand_genre_terms_with_aliases(terms: list[str]) -> list[str]:
    """Expand a list of genre terms to include all known aliases.

    Given ["hardcore punk"], returns ["hardcore punk", "hardcore", "hc", ...]
    so that SQL matching against raw library genre names catches every variant.
    """
    graph = _get_runtime_taxonomy_graph()
    expanded: list[str] = []
    seen: set[str] = set()

    for term in terms:
        normalized = (term or "").strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        expanded.append(normalized)

        slug = resolve_genre_slug(normalized)
        if not slug:
            continue
        # Add all alias terms for this canonical slug
        for alias in graph["alias_terms_by_slug"].get(slug, set()):
            alias_norm = alias.strip().lower()
            if alias_norm and alias_norm not in seen:
                seen.add(alias_norm)
                expanded.append(alias_norm)
        # Also add the slug itself as a hyphenated form
        slug_as_name = slug.replace("-", " ")
        if slug_as_name not in seen:
            seen.add(slug_as_name)
            expanded.append(slug_as_name)

    return expanded


def _genre_row_score(row: dict) -> float:
    return (
        float(row.get("play_count") or 0) * 100.0
        + float(row.get("complete_play_count") or 0) * 30.0
        + float(row.get("minutes_listened") or 0)
    )


def _aggregate_genre_rows(rows: list[dict]) -> list[dict]:
    graph = _get_runtime_taxonomy_graph()
    aggregated: dict[str, dict] = {}
    for row in rows:
        score = _genre_row_score(row)
        raw_names = split_genre_names(row.get("genre_name") or "")
        for raw_name in raw_names:
            slug = resolve_genre_slug(raw_name)
            canonical = slug in graph["nodes_by_slug"] if slug else False
            bucket_slug = slug or slugify_genre(raw_name)
            if not bucket_slug:
                continue
            bucket = aggregated.setdefault(
                bucket_slug,
                {
                    "slug": bucket_slug,
                    "name": get_genre_display_name(bucket_slug).lower(),
                    "score": 0.0,
                    "canonical": canonical,
                    "top_level_slug": get_top_level_slug(bucket_slug) or bucket_slug,
                    "is_top_level": graph["nodes_by_slug"].get(bucket_slug, {"top_level": False})["top_level"],
                    "sources": [],
                },
            )
            bucket["score"] += score
            if raw_name not in bucket["sources"]:
                bucket["sources"].append(raw_name)
            if canonical:
                bucket["name"] = graph["nodes_by_slug"][slug]["name"]
                bucket["canonical"] = True
                bucket["top_level_slug"] = get_top_level_slug(slug) or slug
                bucket["is_top_level"] = graph["nodes_by_slug"][slug]["top_level"]

    return sorted(
        aggregated.values(),
        key=lambda item: (
            -item["score"],
            item["is_top_level"],
            -_genre_depth(item["slug"]),
            item["name"],
        ),
    )


def summarize_taste_genres(rows: list[dict], limit: int = 8) -> list[str]:
    return [item["name"] for item in _aggregate_genre_rows(rows)[:limit]]


def _are_genres_distant(slug_a: str, slug_b: str, min_hops: int = 2) -> bool:
    """Return True if two genre nodes are at least *min_hops* apart in the graph.

    Used to allow multiple seeds from the same top-level family when
    the subgenres are distinct enough (e.g. thrash-metal vs doom-metal).
    """
    graph = _get_runtime_taxonomy_graph()
    if slug_a == slug_b:
        return False
    queue: deque[tuple[str, int]] = deque([(slug_a, 0)])
    seen: set[str] = {slug_a}
    while queue:
        current, depth = queue.popleft()
        if depth >= min_hops:
            continue
        for neighbor_set in (
            graph["parents_by_slug"].get(current, set()),
            graph["children_by_slug"].get(current, set()),
            graph["related_by_slug"].get(current, set()),
        ):
            for neighbor in neighbor_set:
                if neighbor == slug_b:
                    return depth + 1 >= min_hops
                if neighbor not in seen:
                    seen.add(neighbor)
                    queue.append((neighbor, depth + 1))
    return True  # not reachable within min_hops → definitely distant


def choose_mix_seed_genres(rows: list[dict], limit: int = 8) -> list[dict]:
    ordered = _aggregate_genre_rows(rows)
    selected: list[dict] = []
    selected_slugs: set[str] = set()
    selected_roots: dict[str, list[str]] = {}  # root → [slugs]

    # Pass 1: pick one per family to guarantee breadth
    for item in ordered:
        root = item["top_level_slug"] or item["slug"]
        if root in selected_roots:
            continue
        selected.append(item)
        selected_slugs.add(item["slug"])
        selected_roots.setdefault(root, []).append(item["slug"])
        if len(selected) >= limit:
            return selected

    # Pass 2: allow a second genre from the same family if it's
    # distant enough (≥2 hops) from all already-selected siblings
    for item in ordered:
        if item["slug"] in selected_slugs:
            continue
        root = item["top_level_slug"] or item["slug"]
        siblings = selected_roots.get(root, [])
        if siblings and not all(_are_genres_distant(item["slug"], s) for s in siblings):
            continue
        selected.append(item)
        selected_slugs.add(item["slug"])
        selected_roots.setdefault(root, []).append(item["slug"])
        if len(selected) >= limit:
            return selected

    # Pass 3: fill remaining slots with whatever is left
    for item in ordered:
        if item["slug"] in selected_slugs:
            continue
        selected.append(item)
        selected_slugs.add(item["slug"])
        if len(selected) >= limit:
            break
    return selected


def seed_genre_taxonomy(cur) -> None:
    """Upsert the static genre definitions into the taxonomy tables.

    Tables must already exist (created by _create_schema / migrations).
    This is safe to run on every boot — it only inserts or updates rows
    that diverge from the Python definitions and never touches
    user-created or externally-enriched data.
    """
    # Fast path: skip re-seeding if the node count matches AND the
    # eq_gains column is populated for every definition that owns one.
    # We need the second check because the column was added after the
    # first seeds shipped; older installs would otherwise never
    # back-fill it.
    slugs_with_gains = [d.slug for d in _GENRE_DEFINITIONS if d.eq_gains is not None]
    cur.execute(
        "SELECT COUNT(*)::INTEGER AS cnt FROM genre_taxonomy_nodes WHERE slug = ANY(%s)",
        ([d.slug for d in _GENRE_DEFINITIONS],),
    )
    existing_count = cur.fetchone()["cnt"]
    cur.execute(
        "SELECT COUNT(*)::INTEGER AS cnt FROM genre_taxonomy_nodes "
        "WHERE slug = ANY(%s) AND eq_gains IS NOT NULL",
        (slugs_with_gains,),
    )
    existing_gains_count = cur.fetchone()["cnt"]
    if existing_count == len(_GENRE_DEFINITIONS) and existing_gains_count == len(slugs_with_gains):
        return

    for definition in _GENRE_DEFINITIONS:
        cur.execute(
            """
            INSERT INTO genre_taxonomy_nodes (slug, name, description, is_top_level, eq_gains)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (slug) DO UPDATE
            SET name = EXCLUDED.name,
                description = EXCLUDED.description,
                is_top_level = EXCLUDED.is_top_level,
                eq_gains = EXCLUDED.eq_gains
            """,
            (
                definition.slug,
                definition.name,
                definition.description,
                definition.top_level,
                list(definition.eq_gains) if definition.eq_gains is not None else None,
            ),
        )

    cur.execute("SELECT id, slug FROM genre_taxonomy_nodes")
    node_ids = {row["slug"]: row["id"] for row in cur.fetchall()}

    for definition in _GENRE_DEFINITIONS:
        genre_id = node_ids.get(definition.slug)
        if genre_id is None:
            continue
        alias_entries: list[tuple[str, str]] = []
        seen_alias_slugs: set[str] = set()
        for candidate_name in (definition.slug.replace("-", " "), definition.name, *definition.aliases):
            normalized_alias = (candidate_name or "").strip().lower()
            alias_slug = slugify_genre(normalized_alias)
            if not normalized_alias or not alias_slug or alias_slug in seen_alias_slugs:
                continue
            seen_alias_slugs.add(alias_slug)
            alias_entries.append((alias_slug, normalized_alias))

        for alias_slug, alias_name in alias_entries:
            cur.execute(
                "DELETE FROM genre_taxonomy_aliases WHERE alias_name = %s AND alias_slug != %s",
                (alias_name, alias_slug),
            )
            cur.execute(
                """
                INSERT INTO genre_taxonomy_aliases (alias_slug, alias_name, genre_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (alias_slug) DO UPDATE
                SET alias_name = EXCLUDED.alias_name,
                    genre_id = EXCLUDED.genre_id
                """,
                (alias_slug, alias_name, genre_id),
            )

    for definition in _GENRE_DEFINITIONS:
        source_id = node_ids.get(definition.slug)
        if source_id is None:
            continue
        for parent_slug in definition.parents:
            target_id = node_ids.get(parent_slug)
            if target_id is None:
                continue
            cur.execute(
                """
                INSERT INTO genre_taxonomy_edges (source_genre_id, target_genre_id, relation_type, weight)
                VALUES (%s, %s, 'parent', 1.0)
                ON CONFLICT (source_genre_id, target_genre_id, relation_type) DO UPDATE
                SET weight = EXCLUDED.weight
                """,
                (source_id, target_id),
            )
        for related_slug in definition.related:
            target_id = node_ids.get(related_slug)
            if target_id is None:
                continue
            cur.execute(
                """
                INSERT INTO genre_taxonomy_edges (source_genre_id, target_genre_id, relation_type, weight)
                VALUES (%s, %s, 'related', 0.7)
                ON CONFLICT (source_genre_id, target_genre_id, relation_type) DO UPDATE
                SET weight = EXCLUDED.weight
                """,
                (source_id, target_id),
            )
