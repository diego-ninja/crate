package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
)

var ErrNotFound = errors.New("catalog item not found")

var yearPrefixRE = regexp.MustCompile(`^\d{4}\s*[-–]\s*`)
var uuidRE = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

var genreTopLevelMetadata = map[string]map[string]string{
	"rock":        {"name": "rock", "description": "broad guitar-driven family spanning classic, hard and modern rock traditions."},
	"alternative": {"name": "alternative rock", "description": "umbrella for off-mainstream rock scenes with moodier, noisier or more experimental edges."},
	"metal":       {"name": "metal", "description": "heavy guitar-based family built around distortion, power riffs and high intensity."},
	"punk":        {"name": "punk", "description": "fast, direct and confrontational guitar music rooted in diy scenes."},
	"electronic":  {"name": "electronic", "description": "music driven primarily by synths, drum machines and electronic production."},
	"hip-hop":     {"name": "hip hop", "description": "rhythm-first music built from rapping, beats, sampling and dj culture."},
	"jazz":        {"name": "jazz", "description": "improvisation-heavy tradition centered on swing, harmony and instrumental interplay."},
	"blues":       {"name": "blues", "description": "roots-based music built on expressive vocal delivery, guitar and a 12-bar harmonic backbone."},
	"soul":        {"name": "soul", "description": "groove-led black popular music built around voice, rhythm sections and emotional delivery."},
	"folk":        {"name": "folk", "description": "song-led acoustic-rooted family tied to traditional and regional forms."},
	"country":     {"name": "country", "description": "song-driven tradition rooted in storytelling, acoustic and steel guitar, and rural americana sensibility."},
	"pop":         {"name": "pop", "description": "hook-forward mainstream songwriting built for immediacy and accessibility."},
	"classical":   {"name": "classical", "description": "composed western art music spanning orchestral, chamber, choral and solo instrumental traditions."},
	"ambient":     {"name": "ambient", "description": "atmospheric, texture-driven music focused more on mood than on beat."},
}

var staticGenreTopLevel = map[string]string{
	"rock": "rock", "alternative": "alternative", "metal": "metal", "punk": "punk", "electronic": "electronic",
	"hip-hop": "hip-hop", "jazz": "jazz", "blues": "blues", "soul": "soul", "folk": "folk", "country": "country",
	"pop": "pop", "classical": "classical", "ambient": "ambient", "funk": "soul",
	"indie-rock": "alternative", "post-punk": "alternative", "shoegaze": "alternative", "dream-pop": "alternative",
	"noise-rock": "alternative", "new-wave": "alternative", "gothic-rock": "alternative", "garage-rock": "rock",
	"psychedelic-rock": "rock", "stoner-rock": "rock", "grunge": "rock",
	"heavy-metal": "metal", "thrash-metal": "metal", "crossover-thrash": "metal", "death-metal": "metal",
	"black-metal": "metal", "doom-metal": "metal", "sludge-metal": "metal", "stoner-metal": "metal",
	"groove-metal": "metal", "speed-metal": "metal", "power-metal": "metal", "progressive-metal": "metal",
	"industrial-metal": "metal", "post-metal": "metal", "metalcore": "metal", "grindcore": "metal", "nu-metal": "metal",
	"hardcore-punk": "punk", "beatdown-hardcore": "punk", "powerviolence": "punk", "melodic-hardcore": "punk",
	"post-hardcore": "punk", "skate-punk": "punk", "pop-punk": "punk", "crust-punk": "punk", "d-beat": "punk",
	"anarcho-punk": "punk", "art-punk": "punk", "emo": "punk", "screamo": "punk", "noisecore": "punk",
	"industrial": "electronic", "synthpop": "electronic", "techno": "electronic", "house": "electronic", "trip-hop": "electronic",
}

type Store struct {
	pool         *pgxpool.Pool
	queryTimeout time.Duration
}

type historyFallbackRef struct {
	index  int
	artist string
	title  string
}

func NewStore(pool *pgxpool.Pool, queryTimeout time.Duration) *Store {
	return &Store{pool: pool, queryTimeout: queryTimeout}
}

func (s *Store) AlbumByID(ctx context.Context, albumID int64) (map[string]any, error) {
	row, err := s.albumRow(ctx, "a.id = $1", albumID)
	if err != nil {
		return nil, err
	}
	return s.albumPayload(ctx, row)
}

func (s *Store) AlbumByEntityUID(ctx context.Context, entityUID string) (map[string]any, error) {
	row, err := s.albumRow(ctx, "a.entity_uid = $1::uuid", entityUID)
	if err != nil {
		return nil, err
	}
	return s.albumPayload(ctx, row)
}

func (s *Store) AlbumByArtistAndAlbumSlug(ctx context.Context, artistSlug string, albumSlug string) (map[string]any, error) {
	rows, err := s.albumRows(ctx, "ar.slug = $1", artistSlug)
	if err != nil {
		return nil, err
	}
	target := slugify(albumSlug)
	for _, row := range rows {
		if stringValue(row["slug"]) == albumSlug ||
			publicAlbumSlug(stringValue(row["slug"]), artistSlug) == target ||
			publicAlbumSlug(stringValue(row["name"]), artistSlug) == target {
			return s.albumPayload(ctx, row)
		}
	}
	return nil, ErrNotFound
}

func (s *Store) ArtistByID(ctx context.Context, artistID int64) (map[string]any, error) {
	row, err := s.artistRow(ctx, "id = $1", artistID)
	if err != nil {
		return nil, err
	}
	return s.artistPayload(ctx, row)
}

func (s *Store) ArtistByEntityUID(ctx context.Context, entityUID string) (map[string]any, error) {
	row, err := s.artistRow(ctx, "entity_uid = $1::uuid", entityUID)
	if err != nil {
		return nil, err
	}
	return s.artistPayload(ctx, row)
}

func (s *Store) ArtistBySlug(ctx context.Context, slug string) (map[string]any, error) {
	row, err := s.artistRow(ctx, "slug = $1", slug)
	if err != nil {
		return nil, err
	}
	return s.artistPayload(ctx, row)
}

func (s *Store) ArtistTopTracksByID(ctx context.Context, artistID int64, count int) ([]map[string]any, error) {
	row, err := s.artistRow(ctx, "id = $1", artistID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return []map[string]any{}, nil
		}
		return nil, err
	}
	return s.artistTopTracks(ctx, stringValue(row["name"]), count)
}

func (s *Store) ArtistTopTracksByEntityUID(ctx context.Context, entityUID string, count int) ([]map[string]any, error) {
	row, err := s.artistRow(ctx, "entity_uid = $1::uuid", entityUID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return []map[string]any{}, nil
		}
		return nil, err
	}
	return s.artistTopTracks(ctx, stringValue(row["name"]), count)
}

func (s *Store) ArtistTopTracksBySlug(ctx context.Context, slug string, count int) ([]map[string]any, error) {
	row, err := s.artistRow(ctx, "slug = $1", slug)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return []map[string]any{}, nil
		}
		return nil, err
	}
	return s.artistTopTracks(ctx, stringValue(row["name"]), count)
}

func (s *Store) Search(ctx context.Context, query string, limit int) (map[string]any, error) {
	q := strings.TrimSpace(query)
	cappedLimit := clamp(limit, 1, 50)
	if len(q) < 2 {
		return map[string]any{"artists": []any{}, "albums": []any{}, "tracks": []any{}}, nil
	}
	like := "%" + q + "%"
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()

	artists, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT id, entity_uid::text AS entity_uid, slug, name, album_count, has_photo
		FROM library_artists
		WHERE name ILIKE $1
		ORDER BY listeners DESC NULLS LAST, album_count DESC, name ASC
		LIMIT $2
	`, like, cappedLimit))
	if err != nil {
		return nil, err
	}
	for _, artist := range artists {
		artist["has_photo"] = boolValue(artist["has_photo"])
	}
	albums, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT a.id, a.entity_uid::text AS entity_uid, a.slug, a.artist, a.name, a.year, a.has_cover,
		       ar.id AS artist_id, ar.entity_uid::text AS artist_entity_uid, ar.slug AS artist_slug
		FROM library_albums a
		LEFT JOIN library_artists ar ON ar.name = a.artist
		WHERE a.name ILIKE $1 OR a.artist ILIKE $1
		ORDER BY year DESC NULLS LAST, name ASC
		LIMIT $2
	`, like, cappedLimit))
	if err != nil {
		return nil, err
	}
	for _, album := range albums {
		if album["year"] == nil {
			album["year"] = ""
		}
		album["has_cover"] = boolValue(album["has_cover"])
	}
	tracks, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT t.id, t.entity_uid::text AS entity_uid, t.slug, t.title, t.artist,
		       ar.id AS artist_id, ar.entity_uid::text AS artist_entity_uid, ar.slug AS artist_slug,
		       a.id AS album_id, a.entity_uid::text AS album_entity_uid, a.slug AS album_slug,
		       a.name AS album, t.path, t.duration
		FROM library_tracks t
		JOIN library_albums a ON t.album_id = a.id
		LEFT JOIN library_artists ar ON ar.name = t.artist
		WHERE t.title ILIKE $1 OR t.artist ILIKE $1 OR a.name ILIKE $1
		ORDER BY t.title ASC
		LIMIT $2
	`, like, cappedLimit))
	if err != nil {
		return nil, err
	}
	for _, track := range tracks {
		track["bpm"] = nil
		track["audio_key"] = nil
		track["audio_scale"] = nil
		track["energy"] = nil
		track["danceability"] = nil
		track["valence"] = nil
		track["bliss_vector"] = nil
	}
	return map[string]any{
		"artists": artists,
		"albums":  albums,
		"tracks":  tracks,
	}, nil
}

func (s *Store) Favorites(ctx context.Context) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	items, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT item_type, item_id, created_at
		FROM favorites
		ORDER BY created_at DESC
	`))
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (s *Store) FollowedArtists(ctx context.Context, userID int64) ([]map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	return rowsToMaps(s.pool.Query(ctx, `
		SELECT
			uf.artist_name,
			uf.created_at,
			la.id AS artist_id,
			la.entity_uid::text AS artist_entity_uid,
			la.slug AS artist_slug,
			la.album_count,
			la.track_count,
			la.has_photo
		FROM user_follows uf
		LEFT JOIN library_artists la ON la.name = uf.artist_name
		WHERE uf.user_id = $1
		ORDER BY uf.created_at DESC
	`, userID))
}

func (s *Store) SavedAlbums(ctx context.Context, userID int64) ([]map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	return rowsToMaps(s.pool.Query(ctx, `
		SELECT
			usa.created_at AS saved_at,
			la.id,
			la.entity_uid::text AS album_entity_uid,
			la.slug,
			la.artist,
			art.id AS artist_id,
			art.entity_uid::text AS artist_entity_uid,
			art.slug AS artist_slug,
			la.name,
			la.year,
			la.has_cover,
			la.track_count,
			la.total_duration
		FROM user_saved_albums usa
		JOIN library_albums la ON la.id = usa.album_id
		LEFT JOIN library_artists art ON art.name = la.artist
		WHERE usa.user_id = $1
		ORDER BY usa.created_at DESC
	`, userID))
}

func (s *Store) LikedTracks(ctx context.Context, userID int64, limit int) ([]map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT
			ult.track_id,
			lt.entity_uid::text AS track_entity_uid,
			ult.created_at AS liked_at,
			lt.path,
			lt.title,
			lt.artist,
			ar.id AS artist_id,
			ar.entity_uid::text AS artist_entity_uid,
			ar.slug AS artist_slug,
			lt.album,
			alb.id AS album_id,
			alb.entity_uid::text AS album_entity_uid,
			alb.slug AS album_slug,
			lt.duration,
			lt.bpm,
			lt.audio_key,
			lt.audio_scale,
			lt.energy,
			lt.danceability,
			lt.valence,
			lt.bliss_vector
		FROM user_liked_tracks ult
		JOIN library_tracks lt ON lt.id = ult.track_id
		LEFT JOIN library_albums alb ON alb.id = lt.album_id
		LEFT JOIN library_artists ar ON ar.name = lt.artist
		WHERE ult.user_id = $1
		ORDER BY ult.created_at DESC
		LIMIT $2
	`, userID, limit))
	if err != nil {
		return nil, err
	}
	for _, item := range rows {
		item["relative_path"] = relativeMusicPath(stringValue(item["path"]))
		item["bliss_vector"] = normalizeFloatSlice(item["bliss_vector"])
	}
	return rows, nil
}

func (s *Store) UserLibraryCounts(ctx context.Context, userID int64) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT
			(SELECT COUNT(*) FROM user_follows WHERE user_id = $1)::INTEGER AS followed_artists,
			(SELECT COUNT(*) FROM user_saved_albums WHERE user_id = $1)::INTEGER AS saved_albums,
			(SELECT COUNT(*) FROM user_liked_tracks WHERE user_id = $1)::INTEGER AS liked_tracks,
			(SELECT COUNT(*) FROM playlists WHERE user_id = $1)::INTEGER AS playlists
	`, userID))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return map[string]any{}, nil
	}
	return rows[0], nil
}

func (s *Store) IsFollowingArtistName(ctx context.Context, userID int64, artistName string) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT 1
		FROM user_follows
		WHERE user_id = $1 AND artist_name = $2
		LIMIT 1
	`, userID, artistName))
	if err != nil {
		return nil, err
	}
	return map[string]any{"following": len(rows) > 0}, nil
}

func (s *Store) IsFollowingArtistID(ctx context.Context, userID int64, artistID int64) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT name
		FROM library_artists
		WHERE id = $1
		LIMIT 1
	`, artistID))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return s.IsFollowingArtistName(ctx, userID, stringValue(rows[0]["name"]))
}

func (s *Store) PlayHistory(ctx context.Context, userID int64, limit int) ([]map[string]any, error) {
	hasLegacyStreamID, err := s.hasLegacyStreamIDColumn(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.playHistoryRows(ctx, userID, limit, hasLegacyStreamID)
	if err != nil {
		return nil, err
	}

	needsFallback := []historyFallbackRef{}
	for index, item := range rows {
		item["relative_path"] = relativeMusicPath(stringValue(item["track_path"]))
		if item["album_id"] == nil && stringValue(item["artist"]) != "" && stringValue(item["title"]) != "" {
			needsFallback = append(needsFallback, historyFallbackRef{
				index:  index,
				artist: stringValue(item["artist"]),
				title:  stringValue(item["title"]),
			})
		}
	}
	resolved, err := s.resolvePlayHistoryAlbumFallback(ctx, needsFallback)
	if err != nil {
		return nil, err
	}
	for _, pending := range needsFallback {
		hit := resolved[historyFallbackKey(pending.artist, pending.title)]
		if hit == nil {
			continue
		}
		item := rows[pending.index]
		item["track_id"] = hit["track_id"]
		item["track_entity_uid"] = hit["track_entity_uid"]
		if item["track_path"] == nil || stringValue(item["track_path"]) == "" {
			item["track_path"] = hit["path"]
		}
		if stringValue(hit["artist"]) != "" {
			item["artist"] = hit["artist"]
		}
		item["album_id"] = hit["album_id"]
		item["album_entity_uid"] = hit["album_entity_uid"]
		item["album_slug"] = hit["album_slug"]
		if item["album"] == nil || stringValue(item["album"]) == "" {
			item["album"] = hit["album"]
		}
		if item["artist_id"] == nil {
			item["artist_id"] = hit["artist_id"]
		}
		if item["artist_entity_uid"] == nil {
			item["artist_entity_uid"] = hit["artist_entity_uid"]
		}
		if item["artist_slug"] == nil {
			item["artist_slug"] = hit["artist_slug"]
		}
	}
	return rows, nil
}

func (s *Store) Genres(ctx context.Context) ([]map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT
			g.id,
			g.entity_uid::text AS entity_uid,
			g.name,
			g.slug,
			COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
			COUNT(DISTINCT alg.album_id)::INTEGER AS album_count,
			tn.slug AS canonical_slug,
			tn.name AS canonical_name,
			tn.description AS canonical_description,
			tn.external_description,
			tn.external_description_source,
			tn.musicbrainz_mbid,
			tn.wikidata_entity_id,
			tn.wikidata_url,
			tl.slug AS top_level_slug,
			tl.name AS top_level_name,
			tl.description AS top_level_description
		FROM genres g
		LEFT JOIN artist_genres ag ON g.id = ag.genre_id
		LEFT JOIN album_genres alg ON g.id = alg.genre_id
		LEFT JOIN genre_taxonomy_aliases gta
		  ON gta.alias_slug = g.slug OR lower(trim(gta.alias_name)) = lower(trim(g.name))
		LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
		LEFT JOIN LATERAL (`+genreTopLevelSQL("tn.slug")+`) tl ON tn.slug IS NOT NULL
		GROUP BY
			g.id,
			g.entity_uid,
			g.name,
			g.slug,
			tn.slug,
			tn.name,
			tn.description,
			tn.external_description,
			tn.external_description_source,
			tn.musicbrainz_mbid,
			tn.wikidata_entity_id,
			tn.wikidata_url,
			tl.slug,
			tl.name,
			tl.description
		HAVING COUNT(DISTINCT ag.artist_name) > 0 OR COUNT(DISTINCT alg.album_id) > 0
		ORDER BY COUNT(DISTINCT ag.artist_name) DESC
	`))
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		annotateGenreSummary(row, false)
	}
	return rows, nil
}

func (s *Store) GenreDetail(ctx context.Context, slug string) (map[string]any, error) {
	summary, err := s.genreSummaryBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	if stringValue(summary["description"]) == "" && !boolValue(summary["mapped"]) {
		summary["description"] = "raw library tag detected in your collection but not yet linked into the curated taxonomy."
	}
	genreID := intValue(summary["id"])
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()

	artists, err := rowsToMaps(s.pool.Query(queryCtx, `
		SELECT
			ag.artist_name,
			la.id AS artist_id,
			la.slug AS artist_slug,
			ag.weight,
			ag.source,
			la.album_count,
			la.track_count,
			la.has_photo,
			la.spotify_popularity,
			la.listeners
		FROM artist_genres ag
		JOIN library_artists la ON ag.artist_name = la.name
		WHERE ag.genre_id = $1
		ORDER BY ag.weight DESC, la.listeners DESC NULLS LAST
	`, genreID))
	if err != nil {
		return nil, err
	}
	albums, err := rowsToMaps(s.pool.Query(queryCtx, `
		SELECT DISTINCT ON (a.id)
			a.id AS album_id,
			a.slug AS album_slug,
			a.artist,
			ar.id AS artist_id,
			ar.slug AS artist_slug,
			a.name,
			a.year,
			a.track_count,
			a.has_cover,
			COALESCE(alg.weight, ag.weight, 0.5) AS weight
		FROM library_albums a
		LEFT JOIN library_artists ar ON ar.name = a.artist
		LEFT JOIN album_genres alg ON alg.album_id = a.id AND alg.genre_id = $1
		LEFT JOIN artist_genres ag ON ag.artist_name = a.artist AND ag.genre_id = $1
		WHERE alg.genre_id IS NOT NULL OR ag.genre_id IS NOT NULL
		ORDER BY a.id, a.year DESC NULLS LAST
	`, genreID))
	if err != nil {
		return nil, err
	}
	summary["artists"] = artists
	summary["albums"] = albums
	return summary, nil
}

func (s *Store) TrackInfoByID(ctx context.Context, trackID int64) (map[string]any, error) {
	row, err := s.trackInfoRow(ctx, "id = $1", trackID)
	if err != nil {
		return nil, err
	}
	return serializeTrackInfo(row), nil
}

func (s *Store) TrackInfoByEntityUID(ctx context.Context, entityUID string) (map[string]any, error) {
	row, err := s.trackInfoRow(ctx, "entity_uid = $1::uuid", entityUID)
	if err != nil {
		return nil, err
	}
	return serializeTrackInfo(row), nil
}

func (s *Store) TrackEQFeaturesByID(ctx context.Context, trackID int64) (map[string]any, error) {
	row, err := s.eqFeaturesRow(ctx, "id = $1", trackID)
	if err != nil {
		return nil, err
	}
	return serializeEQFeatures(row), nil
}

func (s *Store) TrackEQFeaturesByEntityUID(ctx context.Context, entityUID string) (map[string]any, error) {
	row, err := s.eqFeaturesRow(ctx, "entity_uid = $1::uuid", entityUID)
	if err != nil {
		return nil, err
	}
	return serializeEQFeatures(row), nil
}

func (s *Store) TrackGenreByID(ctx context.Context, trackID int64) (map[string]any, error) {
	return s.trackGenrePayload(ctx, "t.id = $1", trackID)
}

func (s *Store) TrackGenreByEntityUID(ctx context.Context, entityUID string) (map[string]any, error) {
	return s.trackGenrePayload(ctx, "t.entity_uid = $1::uuid", entityUID)
}

func (s *Store) TrackPlaybackByID(ctx context.Context, trackID int64) (map[string]any, error) {
	row, err := s.playbackTrackRow(ctx, "id = $1", trackID)
	if err != nil {
		return nil, err
	}
	return playbackPayload(row, "original"), nil
}

func (s *Store) TrackPlaybackByEntityUID(ctx context.Context, entityUID string) (map[string]any, error) {
	row, err := s.playbackTrackRow(ctx, "entity_uid = $1::uuid", entityUID)
	if err != nil {
		return nil, err
	}
	return playbackPayload(row, "original"), nil
}

func (s *Store) genreSummaryBySlug(ctx context.Context, slug string) (map[string]any, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(queryCtx, `
		SELECT
			g.id,
			g.entity_uid::text AS entity_uid,
			g.name,
			g.slug,
			COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
			COUNT(DISTINCT alg.album_id)::INTEGER AS album_count,
			tn.slug AS canonical_slug,
			tn.name AS canonical_name,
			tn.description AS canonical_description,
			tn.external_description,
			tn.external_description_source,
			tn.musicbrainz_mbid,
			tn.wikidata_entity_id,
			tn.wikidata_url,
			tn.eq_gains AS canonical_eq_gains,
			tn.eq_reasoning,
			tl.slug AS top_level_slug,
			tl.name AS top_level_name,
			tl.description AS top_level_description,
			preset.gains AS preset_gains,
			preset.source AS preset_source,
			preset.slug AS preset_slug,
			preset.name AS preset_name
		FROM genres g
		LEFT JOIN artist_genres ag ON g.id = ag.genre_id
		LEFT JOIN album_genres alg ON g.id = alg.genre_id
		LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
		LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
		LEFT JOIN LATERAL (`+genreTopLevelSQL("tn.slug")+`) tl ON tn.slug IS NOT NULL
		LEFT JOIN LATERAL (`+genrePresetSQL("tn.slug")+`) preset ON tn.slug IS NOT NULL
		WHERE g.slug = $1
		GROUP BY
			g.id,
			g.entity_uid,
			g.name,
			g.slug,
			tn.slug,
			tn.name,
			tn.description,
			tn.external_description,
			tn.external_description_source,
			tn.musicbrainz_mbid,
			tn.wikidata_entity_id,
			tn.wikidata_url,
			tn.eq_gains,
			tn.eq_reasoning,
			tl.slug,
			tl.name,
			tl.description,
			preset.gains,
			preset.source,
			preset.slug,
			preset.name
	`, slug))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	row := rows[0]
	annotateGenreSummary(row, true)
	return row, nil
}

func (s *Store) hasLegacyStreamIDColumn(ctx context.Context) (bool, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(queryCtx, `
		SELECT 1
		FROM information_schema.columns
		WHERE table_name = 'library_tracks'
		  AND column_name = 'navidrome_id'
		LIMIT 1
	`))
	if err != nil {
		return false, err
	}
	return len(rows) > 0, nil
}

func (s *Store) playHistoryRows(ctx context.Context, userID int64, limit int, hasLegacyStreamIDColumn bool) ([]map[string]any, error) {
	joinPredicate := `
		ON lt.id = upe.track_id
		OR (upe.track_id IS NULL AND upe.track_entity_uid IS NOT NULL AND lt.entity_uid = upe.track_entity_uid)
		OR (upe.track_id IS NULL AND COALESCE(upe.track_path, '') <> '' AND lt.path = upe.track_path)
	`
	if hasLegacyStreamIDColumn {
		joinPredicate = `
			ON lt.id = upe.track_id
			OR (upe.track_id IS NULL AND upe.track_entity_uid IS NOT NULL AND lt.entity_uid = upe.track_entity_uid)
			OR (upe.track_id IS NULL AND COALESCE(upe.track_path, '') <> '' AND lt.navidrome_id = upe.track_path)
			OR (upe.track_id IS NULL AND COALESCE(upe.track_path, '') <> '' AND lt.path = upe.track_path)
		`
	}

	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	return rowsToMaps(s.pool.Query(queryCtx, `
		SELECT
			COALESCE(lt.id, upe.track_id) AS track_id,
			lt.entity_uid::text AS track_entity_uid,
			COALESCE(lt.path, upe.track_path) AS track_path,
			COALESCE(lt.title, upe.title) AS title,
			COALESCE(ar_by_album.name, ar_by_albumartist.name, ar_by_track.name, ar_by_event.name, lt.albumartist, alb.artist, lt.artist, upe.artist) AS artist,
			COALESCE(ar_by_album.id, ar_by_albumartist.id, ar_by_track.id, ar_by_event.id) AS artist_id,
			COALESCE(
				ar_by_album.entity_uid::text,
				ar_by_albumartist.entity_uid::text,
				ar_by_track.entity_uid::text,
				ar_by_event.entity_uid::text
			) AS artist_entity_uid,
			COALESCE(ar_by_album.slug, ar_by_albumartist.slug, ar_by_track.slug, ar_by_event.slug) AS artist_slug,
			COALESCE(lt.album, upe.album) AS album,
			alb.id AS album_id,
			alb.entity_uid::text AS album_entity_uid,
			alb.slug AS album_slug,
			upe.ended_at AS played_at
		FROM user_play_events upe
		LEFT JOIN library_tracks lt
		`+joinPredicate+`
		LEFT JOIN library_albums alb ON alb.id = lt.album_id
		LEFT JOIN library_artists ar_by_album
		  ON COALESCE(alb.artist, '') <> ''
		 AND LOWER(ar_by_album.name) = LOWER(alb.artist)
		LEFT JOIN library_artists ar_by_albumartist
		  ON COALESCE(lt.albumartist, '') <> ''
		 AND LOWER(ar_by_albumartist.name) = LOWER(lt.albumartist)
		LEFT JOIN library_artists ar_by_track
		  ON COALESCE(lt.artist, '') <> ''
		 AND LOWER(ar_by_track.name) = LOWER(lt.artist)
		LEFT JOIN library_artists ar_by_event
		  ON COALESCE(upe.artist, '') <> ''
		 AND LOWER(ar_by_event.name) = LOWER(upe.artist)
		WHERE upe.user_id = $1
		ORDER BY upe.ended_at DESC
		LIMIT $2
	`, userID, limit))
}

func (s *Store) resolvePlayHistoryAlbumFallback(ctx context.Context, refs []historyFallbackRef) (map[string]map[string]any, error) {
	unique := []historyFallbackRef{}
	seen := map[string]struct{}{}
	for _, ref := range refs {
		key := historyFallbackKey(ref.artist, ref.title)
		if key == "\x00" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, ref)
	}
	out := map[string]map[string]any{}
	if len(unique) == 0 {
		return out, nil
	}

	values := make([]string, 0, len(unique))
	args := make([]any, 0, len(unique)*2)
	for index, ref := range unique {
		values = append(values, fmt.Sprintf("($%d, $%d)", index*2+1, index*2+2))
		args = append(args, strings.TrimSpace(strings.ToLower(ref.artist)), strings.TrimSpace(strings.ToLower(ref.title)))
	}

	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(queryCtx, `
		WITH input_pairs(artist, title) AS (
			VALUES `+strings.Join(values, ", ")+`
		)
		SELECT DISTINCT ON (LOWER(lt.artist), LOWER(lt.title))
			lt.id AS track_id,
			lt.entity_uid::text AS track_entity_uid,
			lt.path,
			lt.title,
			COALESCE(ar_by_album.name, ar_by_albumartist.name, ar_by_track.name, lt.albumartist, alb.artist, lt.artist) AS artist,
			alb.id AS album_id,
			alb.entity_uid::text AS album_entity_uid,
			alb.slug AS album_slug,
			alb.name AS album,
			COALESCE(ar_by_album.id, ar_by_albumartist.id, ar_by_track.id) AS artist_id,
			COALESCE(
				ar_by_album.entity_uid::text,
				ar_by_albumartist.entity_uid::text,
				ar_by_track.entity_uid::text
			) AS artist_entity_uid,
			COALESCE(ar_by_album.slug, ar_by_albumartist.slug, ar_by_track.slug) AS artist_slug
		FROM library_tracks lt
		LEFT JOIN library_albums alb ON alb.id = lt.album_id
		LEFT JOIN library_artists ar_by_album
		  ON COALESCE(alb.artist, '') <> ''
		 AND LOWER(ar_by_album.name) = LOWER(alb.artist)
		LEFT JOIN library_artists ar_by_albumartist
		  ON COALESCE(lt.albumartist, '') <> ''
		 AND LOWER(ar_by_albumartist.name) = LOWER(lt.albumartist)
		LEFT JOIN library_artists ar_by_track
		  ON COALESCE(lt.artist, '') <> ''
		 AND LOWER(ar_by_track.name) = LOWER(lt.artist)
		JOIN input_pairs ip
		  ON LOWER(lt.artist) = ip.artist
		 AND LOWER(lt.title) = ip.title
		ORDER BY
			LOWER(lt.artist),
			LOWER(lt.title),
			CASE WHEN alb.id IS NULL THEN 1 ELSE 0 END,
			lt.id DESC
	`, args...))
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[historyFallbackKey(stringValue(row["artist"]), stringValue(row["title"]))] = row
	}
	return out, nil
}

func (s *Store) albumRow(ctx context.Context, predicate string, args ...any) (map[string]any, error) {
	rows, err := s.albumRows(ctx, predicate, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}

func (s *Store) albumRows(ctx context.Context, predicate string, args ...any) ([]map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	return rowsToMaps(s.pool.Query(ctx, `
		SELECT a.id, a.entity_uid::text AS entity_uid, a.slug, a.artist, a.name, a.path,
		       a.track_count, a.total_size, a.total_duration, a.formats_json, a.year, a.genre,
		       a.has_cover, a.musicbrainz_albumid, a.popularity, a.popularity_score,
		       a.popularity_confidence,
		       ar.id AS artist_id, ar.entity_uid::text AS artist_entity_uid, ar.slug AS artist_slug
		FROM library_albums a
		LEFT JOIN library_artists ar ON ar.name = a.artist
		WHERE `+predicate+`
	`, args...))
}

func (s *Store) albumPayload(ctx context.Context, album map[string]any) (map[string]any, error) {
	albumID := intValue(album["id"])
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()

	tracks, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT id, entity_uid::text AS entity_uid, storage_id::text AS storage_id, filename,
		       format, size, bitrate, sample_rate, bit_depth, bpm, audio_key, audio_scale,
		       energy, danceability, valence, bliss_vector, duration, popularity,
		       popularity_score, popularity_confidence, rating, title, artist, album,
		       albumartist, track_number, disc_number, year, genre, musicbrainz_albumid,
		       musicbrainz_trackid, path
		FROM library_tracks
		WHERE album_id = $1
		ORDER BY disc_number, track_number
	`, albumID))
	if err != nil {
		return nil, err
	}
	trackIDs := make([]int64, 0, len(tracks))
	for _, track := range tracks {
		if id := intValue(track["id"]); id > 0 {
			trackIDs = append(trackIDs, id)
		}
	}
	variantMap, err := s.variantSummaries(ctx, trackIDs)
	if err != nil {
		return nil, err
	}
	lyricsMap, err := s.lyricsStatus(ctx, albumID)
	if err != nil {
		return nil, err
	}
	trackList := make([]map[string]any, 0, len(tracks))
	albumTags := map[string]any{}
	var totalSize int64
	var totalLength int64
	for _, track := range tracks {
		size := intValue(track["size"])
		totalSize += size
		length := int64(math.Round(floatValue(track["duration"])))
		totalLength += length
		trackID := intValue(track["id"])
		if len(albumTags) == 0 && stringValue(track["album"]) != "" {
			albumTags = map[string]any{
				"artist":              firstNonEmpty(stringValue(track["albumartist"]), stringValue(track["artist"])),
				"album":               stringValue(track["album"]),
				"year":                firstN(stringValue(track["year"]), 4),
				"genre":               stringValue(track["genre"]),
				"musicbrainz_albumid": track["musicbrainz_albumid"],
			}
		}
		trackList = append(trackList, map[string]any{
			"id":                    trackID,
			"entity_uid":            track["entity_uid"],
			"storage_id":            track["storage_id"],
			"filename":              stringValue(track["filename"]),
			"format":                stringValue(track["format"]),
			"size_mb":               roundFloat(float64(size)/(1024*1024), 1),
			"bitrate":               bitrateKbps(track["bitrate"]),
			"sample_rate":           track["sample_rate"],
			"bit_depth":             track["bit_depth"],
			"bpm":                   track["bpm"],
			"audio_key":             track["audio_key"],
			"audio_scale":           track["audio_scale"],
			"energy":                track["energy"],
			"danceability":          track["danceability"],
			"valence":               track["valence"],
			"bliss_vector":          normalizeFloatSlice(track["bliss_vector"]),
			"length_sec":            length,
			"popularity":            track["popularity"],
			"popularity_score":      track["popularity_score"],
			"popularity_confidence": track["popularity_confidence"],
			"rating":                intValue(track["rating"]),
			"stream_variants":       variantMap[trackID],
			"lyrics":                lyricsForTrack(lyricsMap, trackID),
			"tags": map[string]any{
				"title":               stringValue(track["title"]),
				"artist":              stringValue(track["artist"]),
				"album":               stringValue(track["album"]),
				"albumartist":         stringValue(track["albumartist"]),
				"tracknumber":         stringValue(track["track_number"]),
				"discnumber":          stringValue(track["disc_number"]),
				"date":                stringValue(track["year"]),
				"genre":               stringValue(track["genre"]),
				"musicbrainz_albumid": stringValue(track["musicbrainz_albumid"]),
				"musicbrainz_trackid": stringValue(track["musicbrainz_trackid"]),
			},
			"path": relativeMusicPath(stringValue(track["path"])),
		})
	}
	genres, profile, err := s.albumGenres(ctx, albumID)
	if err != nil {
		return nil, err
	}
	if len(genres) > 0 {
		albumTags["genre"] = strings.Join(anyStrings(genres), ", ")
	}
	if mbid := stringValue(album["musicbrainz_albumid"]); mbid != "" {
		albumTags["musicbrainz_albumid"] = mbid
	}

	return map[string]any{
		"id":                    albumID,
		"entity_uid":            album["entity_uid"],
		"slug":                  album["slug"],
		"artist_id":             album["artist_id"],
		"artist_entity_uid":     album["artist_entity_uid"],
		"artist_slug":           album["artist_slug"],
		"artist":                stringValue(album["artist"]),
		"name":                  stringValue(album["name"]),
		"display_name":          displayName(stringValue(album["name"])),
		"path":                  stringValue(album["path"]),
		"track_count":           len(tracks),
		"total_size_mb":         int64(math.Round(float64(totalSize) / (1024 * 1024))),
		"total_length_sec":      totalLength,
		"has_cover":             boolValue(album["has_cover"]),
		"cover_file":            nil,
		"tracks":                trackList,
		"album_tags":            albumTags,
		"musicbrainz_albumid":   album["musicbrainz_albumid"],
		"genres":                genres,
		"genre_profile":         profile,
		"popularity":            album["popularity"],
		"popularity_score":      album["popularity_score"],
		"popularity_confidence": album["popularity_confidence"],
	}, nil
}

func (s *Store) artistRow(ctx context.Context, predicate string, args ...any) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT id, entity_uid::text AS entity_uid, slug, name, folder_name, album_count,
		       track_count, total_size, formats_json, primary_format, has_photo, updated_at,
		       popularity, popularity_score, popularity_confidence
		FROM library_artists
		WHERE `+predicate+`
		LIMIT 1
	`, args...))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}

func (s *Store) artistPayload(ctx context.Context, artist map[string]any) (map[string]any, error) {
	name := stringValue(artist["name"])
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	albums, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT a.id, a.entity_uid::text AS entity_uid, a.slug, a.name, a.track_count AS tracks,
		       a.formats_json AS formats, q.bit_depth, q.sample_rate, a.total_size,
		       a.year, a.has_cover, a.musicbrainz_albumid, a.popularity,
		       a.popularity_score, a.popularity_confidence
		FROM library_albums a
		LEFT JOIN (
			SELECT album_id, MAX(bit_depth) AS bit_depth, MAX(sample_rate) AS sample_rate
			FROM library_tracks
			WHERE format IS NOT NULL
			GROUP BY album_id
		) q ON q.album_id = a.id
		WHERE lower(a.artist) = lower($1) AND a.quarantined_at IS NULL
		ORDER BY a.year, a.name
	`, name))
	if err != nil {
		return nil, err
	}
	for _, album := range albums {
		album["display_name"] = displayName(stringValue(album["name"]))
		album["size_mb"] = int64(math.Round(float64(intValue(album["total_size"])) / (1024 * 1024)))
		delete(album, "total_size")
		album["has_cover"] = boolValue(album["has_cover"])
		if album["formats"] == nil {
			album["formats"] = []any{}
		}
	}
	genres, profile, err := s.artistGenres(ctx, name)
	if err != nil {
		return nil, err
	}
	issueCount, err := s.artistIssueCount(ctx, name)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id":                    artist["id"],
		"entity_uid":            artist["entity_uid"],
		"slug":                  artist["slug"],
		"name":                  name,
		"updated_at":            artist["updated_at"],
		"albums":                albums,
		"total_tracks":          intValue(artist["track_count"]),
		"total_size_mb":         int64(math.Round(float64(intValue(artist["total_size"])) / (1024 * 1024))),
		"primary_format":        artist["primary_format"],
		"genres":                genres,
		"genre_profile":         profile,
		"issue_count":           issueCount,
		"is_v2":                 looksLikeUUID(stringValue(artist["folder_name"])),
		"popularity":            artist["popularity"],
		"popularity_score":      artist["popularity_score"],
		"popularity_confidence": artist["popularity_confidence"],
	}, nil
}

func (s *Store) artistTopTracks(ctx context.Context, artistName string, count int) ([]map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT
			t.id, t.title, t.artist, t.album, t.path, t.duration,
			t.track_number, t.format, t.bpm, t.audio_key, t.audio_scale,
			t.energy, t.danceability, t.valence, t.bliss_vector,
			t.entity_uid::text AS track_entity_uid,
			a.id AS album_id, a.entity_uid::text AS album_entity_uid, a.slug AS album_slug, a.year,
			ar.id AS artist_id, ar.entity_uid::text AS artist_entity_uid, ar.slug AS artist_slug
		FROM library_tracks t
		LEFT JOIN library_albums a ON a.id = t.album_id
		LEFT JOIN library_artists ar ON ar.name = t.artist
		WHERE t.artist = $1
	`, artistName))
	if err != nil {
		return nil, err
	}
	seenTitles := map[string]map[string]any{}
	for _, row := range rows {
		key := strings.ToLower(stringValue(row["title"]))
		if _, ok := seenTitles[key]; !ok {
			seenTitles[key] = row
		}
	}
	remaining := make([]map[string]any, 0, len(seenTitles))
	for _, row := range seenTitles {
		remaining = append(remaining, row)
	}
	sort.Slice(remaining, func(i, j int) bool {
		yi := stringValue(remaining[i]["year"])
		yj := stringValue(remaining[j]["year"])
		if yi != yj {
			return yi > yj
		}
		return intValue(remaining[i]["track_number"]) > intValue(remaining[j]["track_number"])
	})
	limit := clamp(count, 1, 50)
	if len(remaining) > limit {
		remaining = remaining[:limit]
	}
	out := make([]map[string]any, 0, len(remaining))
	for _, row := range remaining {
		out = append(out, formatArtistTopTrack(row))
	}
	return out, nil
}

func (s *Store) trackInfoRow(ctx context.Context, predicate string, args ...any) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT entity_uid::text AS entity_uid, storage_id::text AS storage_id, title, artist, album,
		       format, bitrate, sample_rate, bit_depth, bpm, audio_key, audio_scale,
		       energy, danceability, valence, acousticness, instrumentalness, loudness,
		       dynamic_range, mood_json, lastfm_listeners, lastfm_playcount,
		       popularity, rating, bliss_vector, path
		FROM library_tracks
		WHERE `+predicate+`
		LIMIT 1
	`, args...))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}

func (s *Store) eqFeaturesRow(ctx context.Context, predicate string, args ...any) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT energy, loudness, dynamic_range, spectral_complexity,
		       danceability, valence, acousticness, instrumentalness
		FROM library_tracks
		WHERE `+predicate+`
		LIMIT 1
	`, args...))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}

func (s *Store) playbackTrackRow(ctx context.Context, predicate string, args ...any) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT id, entity_uid::text AS entity_uid, path, title, artist, album,
		       format, bitrate, sample_rate, bit_depth, duration, size
		FROM library_tracks
		WHERE `+predicate+`
		LIMIT 1
	`, args...))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}

func (s *Store) trackGenrePayload(ctx context.Context, predicate string, args ...any) (map[string]any, error) {
	trackID, err := s.trackID(ctx, predicate, args...)
	if err != nil {
		return nil, err
	}
	albumRows, err := s.trackAlbumGenreRows(ctx, trackID)
	if err != nil {
		return nil, err
	}
	artistRows, err := s.trackArtistGenreRows(ctx, trackID)
	if err != nil {
		return nil, err
	}

	if picked, err := s.pickTrackGenre(ctx, albumRows, true); err != nil {
		return nil, err
	} else if picked != nil {
		picked["source"] = "album"
		return picked, nil
	}
	if picked, err := s.pickTrackGenre(ctx, artistRows, true); err != nil {
		return nil, err
	} else if picked != nil {
		picked["source"] = "artist"
		return picked, nil
	}
	if picked, err := s.pickTrackGenre(ctx, albumRows, false); err != nil {
		return nil, err
	} else if picked != nil {
		picked["source"] = "album"
		return picked, nil
	}
	if picked, err := s.pickTrackGenre(ctx, artistRows, false); err != nil {
		return nil, err
	} else if picked != nil {
		picked["source"] = "artist"
		return picked, nil
	}
	return emptyTrackGenrePayload(), nil
}

func (s *Store) trackID(ctx context.Context, predicate string, args ...any) (int64, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(queryCtx, `
		SELECT t.id
		FROM library_tracks t
		WHERE `+predicate+`
		LIMIT 1
	`, args...))
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, ErrNotFound
	}
	return intValue(rows[0]["id"]), nil
}

func (s *Store) trackAlbumGenreRows(ctx context.Context, trackID int64) ([]map[string]any, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	return rowsToMaps(s.pool.Query(queryCtx, `
		SELECT g.name, g.slug, ag.weight, tn.slug AS canonical_slug, tn.name AS canonical_name
		FROM library_tracks t
		JOIN album_genres ag ON ag.album_id = t.album_id
		JOIN genres g ON g.id = ag.genre_id
		LEFT JOIN genre_taxonomy_aliases gta
		  ON gta.alias_slug = g.slug OR lower(trim(gta.alias_name)) = lower(trim(g.name))
		LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
		WHERE t.id = $1
		ORDER BY ag.weight DESC NULLS LAST, g.name ASC
		LIMIT 10
	`, trackID))
}

func (s *Store) trackArtistGenreRows(ctx context.Context, trackID int64) ([]map[string]any, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	return rowsToMaps(s.pool.Query(queryCtx, `
		SELECT g.name, g.slug, MAX(arg.weight) AS weight, tn.slug AS canonical_slug, tn.name AS canonical_name
		FROM library_tracks t
		LEFT JOIN library_albums a ON a.id = t.album_id
		JOIN artist_genres arg ON arg.artist_name IN (t.artist, a.artist)
		JOIN genres g ON g.id = arg.genre_id
		LEFT JOIN genre_taxonomy_aliases gta
		  ON gta.alias_slug = g.slug OR lower(trim(gta.alias_name)) = lower(trim(g.name))
		LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
		WHERE t.id = $1
		GROUP BY g.name, g.slug, tn.slug, tn.name
		ORDER BY MAX(arg.weight) DESC NULLS LAST, g.name ASC
		LIMIT 10
	`, trackID))
}

func (s *Store) pickTrackGenre(ctx context.Context, rows []map[string]any, canonicalOnly bool) (map[string]any, error) {
	for _, row := range rows {
		canonicalSlug := strings.TrimSpace(stringValue(row["canonical_slug"]))
		if canonicalSlug != "" {
			topLevel, preset, err := s.genreTaxonomyContext(ctx, canonicalSlug)
			if err != nil {
				return nil, err
			}
			return map[string]any{
				"primary": map[string]any{
					"slug":      canonicalSlug,
					"name":      firstNonEmpty(stringValue(row["canonical_name"]), canonicalSlug),
					"canonical": true,
				},
				"topLevel": topLevel,
				"preset":   preset,
			}, nil
		}
		if canonicalOnly {
			continue
		}
		rawSlug := strings.TrimSpace(strings.ToLower(stringValue(row["slug"])))
		rawName := strings.TrimSpace(strings.ToLower(stringValue(row["name"])))
		if rawSlug == "" && rawName == "" {
			continue
		}
		if rawName == "" {
			rawName = strings.ReplaceAll(rawSlug, "-", " ")
		}
		return map[string]any{
			"primary": map[string]any{
				"slug":      rawSlug,
				"name":      rawName,
				"canonical": false,
			},
			"topLevel": nil,
			"preset":   nil,
		}, nil
	}
	return nil, nil
}

func (s *Store) genreTaxonomyContext(ctx context.Context, canonicalSlug string) (any, any, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(queryCtx, `
		WITH RECURSIVE ancestors AS (
			SELECT 0 AS depth, n.id, n.slug, n.name, n.is_top_level, n.eq_gains
			FROM genre_taxonomy_nodes n
			WHERE n.slug = $1
			UNION ALL
			SELECT a.depth + 1, parent.id, parent.slug, parent.name, parent.is_top_level, parent.eq_gains
			FROM ancestors a
			JOIN genre_taxonomy_edges e
			  ON e.source_genre_id = a.id
			 AND e.relation_type = 'parent'
			JOIN genre_taxonomy_nodes parent ON parent.id = e.target_genre_id
			WHERE a.depth < 8
		)
		SELECT
			(
				SELECT jsonb_build_object('slug', slug, 'name', name, 'canonical', NULL)
				FROM ancestors
				WHERE is_top_level
				ORDER BY depth, slug
				LIMIT 1
			) AS top_level,
			(
				SELECT jsonb_build_object(
					'gains', eq_gains,
					'source', CASE WHEN depth = 0 THEN 'direct' ELSE 'inherited' END,
					'inheritedFrom', CASE
						WHEN depth = 0 THEN NULL
						ELSE jsonb_build_object('slug', slug, 'name', name)
					END
				)
				FROM ancestors
				WHERE eq_gains IS NOT NULL
				ORDER BY depth, slug
				LIMIT 1
			) AS preset
	`, canonicalSlug))
	if err != nil {
		return nil, nil, err
	}
	if len(rows) == 0 {
		return nil, nil, nil
	}
	return rows[0]["top_level"], rows[0]["preset"], nil
}

func genreTopLevelSQL(seedExpr string) string {
	return `
		WITH RECURSIVE ancestors AS (
			SELECT 0 AS depth, n.id, n.slug, n.name, n.description, n.is_top_level
			FROM genre_taxonomy_nodes n
			WHERE n.slug = ` + seedExpr + `
			UNION ALL
			SELECT a.depth + 1, parent.id, parent.slug, parent.name, parent.description, parent.is_top_level
			FROM ancestors a
			JOIN genre_taxonomy_edges e
			  ON e.source_genre_id = a.id
			 AND e.relation_type = 'parent'
			JOIN genre_taxonomy_nodes parent ON parent.id = e.target_genre_id
			WHERE a.depth < 8
		)
		SELECT slug, name, description
		FROM ancestors a
		WHERE a.is_top_level
		   OR NOT EXISTS (
		       SELECT 1
		       FROM genre_taxonomy_edges e
		       WHERE e.source_genre_id = a.id
		         AND e.relation_type = 'parent'
		   )
		ORDER BY depth, name, slug
		LIMIT 1
	`
}

func genrePresetSQL(seedExpr string) string {
	return `
		WITH RECURSIVE ancestors AS (
			SELECT 0 AS depth, n.id, n.slug, n.name, n.eq_gains
			FROM genre_taxonomy_nodes n
			WHERE n.slug = ` + seedExpr + `
			UNION ALL
			SELECT a.depth + 1, parent.id, parent.slug, parent.name, parent.eq_gains
			FROM ancestors a
			JOIN genre_taxonomy_edges e
			  ON e.source_genre_id = a.id
			 AND e.relation_type = 'parent'
			JOIN genre_taxonomy_nodes parent ON parent.id = e.target_genre_id
			WHERE a.depth < 8
		)
		SELECT
			eq_gains AS gains,
			CASE WHEN depth = 0 THEN 'direct' ELSE 'inherited' END AS source,
			slug,
			name
		FROM ancestors
		WHERE eq_gains IS NOT NULL
		ORDER BY depth, slug
		LIMIT 1
	`
}

func (s *Store) albumGenres(ctx context.Context, albumID int64) ([]any, []map[string]any, error) {
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT g.name, g.slug, ag.weight, ag.source
		FROM album_genres ag
		JOIN genres g ON ag.genre_id = g.id
		WHERE ag.album_id = $1
		ORDER BY ag.weight DESC NULLS LAST, g.name ASC
		LIMIT 8
	`, albumID))
	if err != nil {
		return nil, nil, err
	}
	genres := make([]any, 0, len(rows))
	for _, row := range rows {
		genres = append(genres, stringValue(row["name"]))
	}
	return genres, buildGenreProfile(rows, 6), nil
}

func (s *Store) artistGenres(ctx context.Context, artistName string) ([]any, []map[string]any, error) {
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT g.name, g.slug, ag.weight, ag.source
		FROM artist_genres ag
		JOIN genres g ON g.id = ag.genre_id
		WHERE ag.artist_name = $1
		ORDER BY ag.weight DESC NULLS LAST, g.name ASC
		LIMIT 8
	`, artistName))
	if err != nil {
		return nil, nil, err
	}
	genres := make([]any, 0, len(rows))
	for _, row := range rows {
		genres = append(genres, stringValue(row["name"]))
	}
	return genres, buildGenreProfile(rows, 8), nil
}

func (s *Store) artistIssueCount(ctx context.Context, artistName string) (int64, error) {
	var count int64
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) AS cnt FROM health_issues
		WHERE status = 'open'
		  AND (details_json->>'artist' = $1 OR details_json->>'db_artist' = $1)
	`, artistName).Scan(&count)
	return count, err
}

func (s *Store) variantSummaries(ctx context.Context, trackIDs []int64) (map[int64][]map[string]any, error) {
	out := map[int64][]map[string]any{}
	if len(trackIDs) == 0 {
		return out, nil
	}
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT
			sv.id, sv.track_id, sv.preset, sv.status, sv.delivery_format,
			sv.delivery_codec, sv.delivery_bitrate, sv.delivery_sample_rate,
			sv.bytes, sv.error, sv.task_id, sv.updated_at, sv.completed_at,
			t.status AS task_status
		FROM stream_variants sv
		JOIN library_tracks lt
		  ON lt.id = sv.track_id
		 AND lt.path = sv.source_path
		 AND COALESCE(lt.size, 0) = sv.source_size
		LEFT JOIN tasks t ON t.id = sv.task_id
		WHERE sv.track_id = ANY($1)
		ORDER BY sv.track_id, sv.preset, sv.updated_at DESC
	`, trackIDs))
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		id := intValue(row["track_id"])
		out[id] = append(out[id], row)
	}
	return out, nil
}

func (s *Store) lyricsStatus(ctx context.Context, albumID int64) (map[int64]map[string]any, error) {
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT DISTINCT ON (lt.id)
			lt.id AS track_id, tl.provider, tl.found,
			(tl.plain_lyrics IS NOT NULL AND length(tl.plain_lyrics) > 0) AS has_plain,
			(tl.synced_lyrics IS NOT NULL AND length(tl.synced_lyrics) > 0) AS has_synced,
			tl.updated_at
		FROM library_tracks lt
		LEFT JOIN track_lyrics tl ON tl.track_id = lt.id OR tl.track_entity_uid = lt.entity_uid
		WHERE lt.album_id = $1
		ORDER BY lt.id, tl.updated_at DESC NULLS LAST
	`, albumID))
	if err != nil {
		return nil, err
	}
	out := map[int64]map[string]any{}
	for _, row := range rows {
		if row["provider"] == nil {
			continue
		}
		found := boolValue(row["found"])
		hasPlain := boolValue(row["has_plain"])
		hasSynced := boolValue(row["has_synced"])
		status := "none"
		if found {
			status = "found"
		}
		if hasSynced {
			status = "synced"
		} else if hasPlain {
			status = "plain"
		}
		out[intValue(row["track_id"])] = map[string]any{
			"status":     status,
			"found":      found,
			"has_plain":  hasPlain,
			"has_synced": hasSynced,
			"provider":   firstNonEmpty(stringValue(row["provider"]), "lrclib"),
			"updated_at": row["updated_at"],
		}
	}
	return out, nil
}

func rowsToMaps(rows pgx.Rows, err error) ([]map[string]any, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fields := rows.FieldDescriptions()
	out := []map[string]any{}
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		row := make(map[string]any, len(values))
		for index, field := range fields {
			row[string(field.Name)] = normalizeValue(values[index])
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func normalizeValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case []byte:
		var decoded any
		if json.Valid(typed) && json.Unmarshal(typed, &decoded) == nil {
			return decoded
		}
		return string(typed)
	case [16]byte:
		return fmt.Sprintf("%x-%x-%x-%x-%x", typed[0:4], typed[4:6], typed[6:8], typed[8:10], typed[10:16])
	default:
		return value
	}
}

func buildGenreProfile(rows []map[string]any, limit int) []map[string]any {
	if limit > 0 && len(rows) > limit {
		rows = rows[:limit]
	}
	prepared := []map[string]any{}
	for _, row := range rows {
		name := strings.TrimSpace(stringValue(row["name"]))
		if name == "" {
			continue
		}
		weight := floatValue(row["weight"])
		if weight < 0 {
			weight = 0
		}
		prepared = append(prepared, map[string]any{
			"name":   name,
			"slug":   row["slug"],
			"source": row["source"],
			"weight": weight,
		})
	}
	if len(prepared) == 0 {
		return []map[string]any{}
	}
	var total float64
	var maxWeight float64
	for _, item := range prepared {
		weight := floatValue(item["weight"])
		total += weight
		if weight > maxWeight {
			maxWeight = weight
		}
	}
	if total <= 0 {
		total = float64(len(prepared))
		for _, item := range prepared {
			item["weight"] = float64(1)
		}
		maxWeight = 1
	}
	out := make([]map[string]any, 0, len(prepared))
	for _, item := range prepared {
		weight := floatValue(item["weight"])
		share := float64(0)
		if total > 0 {
			share = weight / total
		}
		percent := int64(0)
		if maxWeight > 0 {
			percent = int64(math.Round((weight / maxWeight) * 100))
		}
		if weight > 0 && percent < 1 {
			percent = 1
		}
		out = append(out, map[string]any{
			"name":    item["name"],
			"slug":    item["slug"],
			"source":  item["source"],
			"weight":  roundFloat(weight, 4),
			"share":   roundFloat(share, 4),
			"percent": percent,
		})
	}
	return out
}

func annotateGenreSummary(row map[string]any, includeEQ bool) {
	canonicalSlug := strings.TrimSpace(stringValue(row["canonical_slug"]))
	mapped := canonicalSlug != ""
	row["mapped"] = mapped

	if mapped {
		if shouldUseStaticTopLevel(canonicalSlug, stringValue(row["top_level_slug"])) {
			topLevelSlug := staticGenreTopLevel[canonicalSlug]
			row["top_level_slug"] = topLevelSlug
			if meta, ok := genreTopLevelMetadata[topLevelSlug]; ok {
				row["top_level_name"] = meta["name"]
				row["top_level_description"] = meta["description"]
			} else {
				row["top_level_name"] = strings.ReplaceAll(topLevelSlug, "-", " ")
				row["top_level_description"] = ""
			}
		}
		if strings.TrimSpace(stringValue(row["top_level_slug"])) == "" {
			row["top_level_slug"] = canonicalSlug
			row["top_level_name"] = firstNonEmpty(stringValue(row["canonical_name"]), canonicalSlug)
			row["top_level_description"] = stringValue(row["canonical_description"])
		}
		row["description"] = stringValue(row["canonical_description"])
	} else {
		row["top_level_slug"] = nil
		row["top_level_name"] = nil
		row["top_level_description"] = nil
		row["description"] = nil
		row["external_description"] = nil
		row["external_description_source"] = nil
		row["musicbrainz_mbid"] = nil
		row["wikidata_entity_id"] = nil
		row["wikidata_url"] = nil
	}

	if includeEQ {
		row["eq_gains"] = normalizeFloatSlice(row["canonical_eq_gains"])
		if row["preset_gains"] != nil {
			row["eq_preset_resolved"] = map[string]any{
				"gains":  normalizeFloatSlice(row["preset_gains"]),
				"source": row["preset_source"],
				"slug":   row["preset_slug"],
				"name":   row["preset_name"],
			}
		} else {
			row["eq_preset_resolved"] = nil
		}
	} else {
		row["eq_gains"] = nil
		row["eq_preset_resolved"] = nil
	}
	delete(row, "canonical_eq_gains")
	delete(row, "preset_gains")
	delete(row, "preset_source")
	delete(row, "preset_slug")
	delete(row, "preset_name")
}

func shouldUseStaticTopLevel(canonicalSlug string, currentTopLevelSlug string) bool {
	staticTopLevelSlug, ok := staticGenreTopLevel[canonicalSlug]
	if !ok || staticTopLevelSlug == "" || staticTopLevelSlug == canonicalSlug {
		return false
	}
	current := strings.TrimSpace(currentTopLevelSlug)
	return current == "" || current == canonicalSlug
}

func formatArtistTopTrack(row map[string]any) map[string]any {
	return map[string]any{
		"id":           stringValue(row["id"]),
		"track_id":     row["id"],
		"title":        row["title"],
		"artist":       row["artist"],
		"artist_id":    row["artist_id"],
		"artist_slug":  row["artist_slug"],
		"album":        row["album"],
		"album_id":     row["album_id"],
		"album_slug":   row["album_slug"],
		"duration":     firstNonNil(row["duration"], int64(0)),
		"track":        firstNonNil(row["track_number"], int64(0)),
		"format":       row["format"],
		"bpm":          row["bpm"],
		"audio_key":    row["audio_key"],
		"audio_scale":  row["audio_scale"],
		"energy":       row["energy"],
		"danceability": row["danceability"],
		"valence":      row["valence"],
		"bliss_vector": normalizeFloatSlice(row["bliss_vector"]),
	}
}

func serializeTrackInfo(row map[string]any) map[string]any {
	payload := cloneMap(row)
	delete(payload, "storage_id")
	delete(payload, "path")
	blissVector := payload["bliss_vector"]
	delete(payload, "bliss_vector")
	payload["bliss_signature"] = deriveBlissSignature(blissVector)
	return payload
}

func serializeEQFeatures(row map[string]any) map[string]any {
	return map[string]any{
		"energy":           row["energy"],
		"loudness":         row["loudness"],
		"dynamicRange":     row["dynamic_range"],
		"brightness":       row["spectral_complexity"],
		"danceability":     row["danceability"],
		"valence":          row["valence"],
		"acousticness":     row["acousticness"],
		"instrumentalness": row["instrumentalness"],
	}
}

func emptyTrackGenrePayload() map[string]any {
	return map[string]any{
		"primary":  nil,
		"topLevel": nil,
		"source":   nil,
		"preset":   nil,
	}
}

func playbackPayload(row map[string]any, requestedPolicy string) map[string]any {
	sourceFormat := inferFormat(stringValue(row["format"]), stringValue(row["path"]))
	source := map[string]any{
		"format":      sourceFormat,
		"bitrate":     bitrateKbps(row["bitrate"]),
		"sample_rate": row["sample_rate"],
		"bit_depth":   row["bit_depth"],
		"bytes":       row["size"],
		"lossless":    isLossless(sourceFormat),
	}
	return map[string]any{
		"stream_url":       streamURL(row, requestedPolicy),
		"requested_policy": "original",
		"effective_policy": "original",
		"source":           source,
		"delivery":         withReason(source, "original_requested"),
		"transcoded":       false,
		"cache_hit":        false,
		"preparing":        false,
		"task_id":          nil,
		"variant_id":       nil,
		"variant_status":   nil,
	}
}

func streamURL(row map[string]any, policy string) string {
	query := ""
	if policy != "" && policy != "original" {
		query = "?delivery=" + url.QueryEscape(policy)
	}
	if entityUID := stringValue(row["entity_uid"]); entityUID != "" {
		return "/api/tracks/by-entity/" + url.PathEscape(entityUID) + "/stream" + query
	}
	if id := intValue(row["id"]); id > 0 {
		return "/api/tracks/" + strconv.FormatInt(id, 10) + "/stream" + query
	}
	return "/api/stream/" + strings.TrimLeft(stringValue(row["path"]), "/") + query
}

func deriveBlissSignature(value any) map[string]any {
	values := normalizeFloatSlice(value)
	if len(values) == 0 {
		return nil
	}
	var sumAbs float64
	var maxAbs float64
	nonZero := 0
	for _, value := range values {
		abs := math.Abs(value)
		sumAbs += abs
		if abs > maxAbs {
			maxAbs = abs
		}
		if abs > 0.0001 {
			nonZero++
		}
	}
	meanAbs := sumAbs / float64(len(values))
	densityRaw := float64(nonZero) / float64(len(values))
	var textureRaw float64
	for i := 1; i < len(values); i++ {
		textureRaw += math.Abs(values[i] - values[i-1])
	}
	if len(values) > 1 {
		textureRaw /= float64(len(values) - 1)
	}
	half := max(1, len(values)/2)
	front := avg(values[:half])
	back := avg(values[half:])
	motionRaw := math.Abs(back - front)
	return map[string]any{
		"texture": roundFloat(math.Tanh(textureRaw*1.35), 3),
		"motion":  roundFloat(math.Tanh((motionRaw+meanAbs*0.35)*1.55), 3),
		"density": roundFloat(math.Tanh((densityRaw*0.9+meanAbs*0.5)*1.2), 3),
	}
}

func defaultLyrics() map[string]any {
	return map[string]any{
		"status":     "none",
		"found":      false,
		"has_plain":  false,
		"has_synced": false,
		"provider":   "lrclib",
		"updated_at": nil,
	}
}

func lyricsForTrack(items map[int64]map[string]any, trackID int64) map[string]any {
	if item, ok := items[trackID]; ok {
		return item
	}
	return defaultLyrics()
}

func cloneMap(input map[string]any) map[string]any {
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func displayName(value string) string {
	return yearPrefixRE.ReplaceAllString(value, "")
}

func relativeMusicPath(path string) string {
	if strings.HasPrefix(path, "/music/") {
		return strings.TrimPrefix(path, "/music/")
	}
	return strings.TrimLeft(path, "/")
}

func looksLikeUUID(value string) bool {
	return uuidRE.MatchString(strings.TrimSpace(value))
}

func publicAlbumSlug(value string, artistSlug string) string {
	slug := slugify(displayName(value))
	prefix := slugify(artistSlug)
	if prefix != "" && strings.HasPrefix(slug, prefix+"-") {
		return strings.TrimPrefix(slug, prefix+"-")
	}
	return slug
}

func slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	previousDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
			previousDash = false
			continue
		}
		if builder.Len() > 0 && !previousDash {
			builder.WriteByte('-')
			previousDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func normalizeFloatSlice(value any) []float64 {
	switch typed := value.(type) {
	case nil:
		return nil
	case []float64:
		return typed
	case []any:
		out := make([]float64, 0, len(typed))
		for _, item := range typed {
			out = append(out, floatValue(item))
		}
		return out
	default:
		return nil
	}
}

func inferFormat(format string, path string) string {
	cleaned := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(format)), ".")
	if cleaned == "m4a" {
		return "aac"
	}
	if cleaned != "" {
		return cleaned
	}
	if index := strings.LastIndex(path, "."); index >= 0 && index < len(path)-1 {
		ext := strings.ToLower(path[index+1:])
		if ext == "m4a" {
			return "aac"
		}
		return ext
	}
	return ""
}

func bitrateKbps(value any) any {
	number := intValue(value)
	if number <= 0 {
		return nil
	}
	if number > 4000 {
		return int64(math.Round(float64(number) / 1000))
	}
	return number
}

func isLossless(format string) bool {
	switch strings.ToLower(format) {
	case "flac", "wav", "alac", "aiff", "aif":
		return true
	default:
		return false
	}
}

func withReason(input map[string]any, reason string) map[string]any {
	output := cloneMap(input)
	output["reason"] = reason
	return output
}

func historyFallbackKey(artist string, title string) string {
	return strings.TrimSpace(strings.ToLower(artist)) + "\x00" + strings.TrimSpace(strings.ToLower(title))
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func firstN(value string, length int) string {
	if len(value) <= length {
		return value
	}
	return value[:length]
}

func anyStrings(values []any) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		text := strings.TrimSpace(stringValue(value))
		if text != "" {
			out = append(out, text)
		}
	}
	return out
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func intValue(value any) int64 {
	switch typed := value.(type) {
	case nil:
		return 0
	case int:
		return int64(typed)
	case int32:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(typed)
	case string:
		parsed, _ := strconv.ParseInt(typed, 10, 64)
		return parsed
	default:
		return 0
	}
}

func floatValue(value any) float64 {
	switch typed := value.(type) {
	case nil:
		return 0
	case float32:
		return float64(typed)
	case float64:
		return typed
	case int:
		return float64(typed)
	case int32:
		return float64(typed)
	case int64:
		return float64(typed)
	case string:
		parsed, _ := strconv.ParseFloat(typed, 64)
		return parsed
	default:
		return 0
	}
}

func boolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case int:
		return typed != 0
	case int32:
		return typed != 0
	case int64:
		return typed != 0
	case string:
		return typed == "true" || typed == "1"
	default:
		return false
	}
}

func roundFloat(value float64, places int) float64 {
	factor := math.Pow(10, float64(places))
	return math.Round(value*factor) / factor
}

func avg(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	var total float64
	for _, value := range values {
		total += value
	}
	return total / float64(len(values))
}

func clamp(value int, minValue int, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func max(a int, b int) int {
	if a > b {
		return a
	}
	return b
}
