package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
)

const (
	listenCookieName  = "crate_session_listen"
	defaultCookieName = "crate_session"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrUnavailable  = errors.New("auth unavailable")
)

type ConnectedAccount struct {
	Provider string `json:"provider"`
	Status   string `json:"status"`
}

type User struct {
	ID                int64              `json:"id"`
	Email             string             `json:"email"`
	Name              *string            `json:"name"`
	Avatar            *string            `json:"avatar"`
	Role              string             `json:"role"`
	Username          *string            `json:"username"`
	Bio               *string            `json:"bio"`
	SessionID         *string            `json:"session_id"`
	ConnectedAccounts []ConnectedAccount `json:"connected_accounts"`
}

type Authenticator struct {
	pool         *pgxpool.Pool
	queryTimeout time.Duration
	envSecret    string

	mu             sync.Mutex
	cachedDBSecret string
	secretLoadedAt time.Time
}

func NewAuthenticator(pool *pgxpool.Pool, envSecret string, queryTimeout time.Duration) *Authenticator {
	return &Authenticator{
		pool:         pool,
		envSecret:    strings.TrimSpace(envSecret),
		queryTimeout: queryTimeout,
	}
}

func (a *Authenticator) Authenticate(r *http.Request, allowQueryToken bool) (*User, error) {
	token := ExtractToken(r, allowQueryToken)
	if token == "" {
		return nil, ErrUnauthorized
	}

	secret, err := a.jwtSecret(r.Context())
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	payload, err := VerifyHS256(token, secret, time.Now())
	if err != nil {
		return nil, ErrUnauthorized
	}

	user, err := a.loadUser(r.Context(), payload)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUnauthorized
		}
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return user, nil
}

func ExtractToken(r *http.Request, allowQueryToken bool) string {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if authHeader != "" {
		scheme, token, ok := strings.Cut(authHeader, " ")
		if ok && strings.EqualFold(scheme, "Bearer") {
			return strings.TrimSpace(token)
		}
	}
	if allowQueryToken {
		if token := strings.TrimSpace(r.URL.Query().Get("token")); token != "" {
			return token
		}
	}
	if cookie, err := r.Cookie(listenCookieName); err == nil {
		return strings.TrimSpace(cookie.Value)
	}
	if cookie, err := r.Cookie(defaultCookieName); err == nil {
		return strings.TrimSpace(cookie.Value)
	}
	return ""
}

func (a *Authenticator) jwtSecret(ctx context.Context) (string, error) {
	if a.envSecret != "" {
		return a.envSecret, nil
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cachedDBSecret != "" && time.Since(a.secretLoadedAt) < time.Minute {
		return a.cachedDBSecret, nil
	}

	queryCtx, cancel := postgres.WithTimeout(ctx, a.queryTimeout)
	defer cancel()

	var secret sql.NullString
	if err := a.pool.QueryRow(queryCtx, "SELECT value FROM settings WHERE key = 'jwt_secret'").Scan(&secret); err != nil {
		return "", err
	}
	if !secret.Valid || strings.TrimSpace(secret.String) == "" {
		return "", fmt.Errorf("settings.jwt_secret is empty")
	}
	a.cachedDBSecret = strings.TrimSpace(secret.String)
	a.secretLoadedAt = time.Now()
	return a.cachedDBSecret, nil
}

func (a *Authenticator) loadUser(ctx context.Context, payload JWTPayload) (*User, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, a.queryTimeout)
	defer cancel()

	user := &User{}
	var username, name, bio, avatar sql.NullString
	var sessionID sql.NullString

	if payload.SessionID != "" {
		const query = `
			SELECT
				u.id,
				u.email,
				u.role,
				u.username,
				u.name,
				u.bio,
				u.avatar,
				s.id
			FROM sessions s
			JOIN users u ON u.id = s.user_id
			WHERE s.id = $1
			  AND s.user_id = $2
			  AND s.revoked_at IS NULL
			  AND s.expires_at > now()
			LIMIT 1
		`
		if err := a.pool.QueryRow(queryCtx, query, payload.SessionID, payload.UserID).Scan(
			&user.ID,
			&user.Email,
			&user.Role,
			&username,
			&name,
			&bio,
			&avatar,
			&sessionID,
		); err != nil {
			return nil, err
		}
	} else {
		const query = `
			SELECT id, email, role, username, name, bio, avatar
			FROM users
			WHERE id = $1
			LIMIT 1
		`
		if err := a.pool.QueryRow(queryCtx, query, payload.UserID).Scan(
			&user.ID,
			&user.Email,
			&user.Role,
			&username,
			&name,
			&bio,
			&avatar,
		); err != nil {
			return nil, err
		}
	}

	user.Username = nullableString(username)
	user.Name = nullableString(name)
	user.Bio = nullableString(bio)
	user.Avatar = nullableString(avatar)
	user.SessionID = nullableString(sessionID)
	if user.Role == "" {
		user.Role = "user"
	}

	accounts, err := a.connectedAccounts(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	user.ConnectedAccounts = accounts
	return user, nil
}

func (a *Authenticator) connectedAccounts(ctx context.Context, userID int64) ([]ConnectedAccount, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, a.queryTimeout)
	defer cancel()

	rows, err := a.pool.Query(queryCtx, `
		SELECT provider, status
		FROM user_external_identities
		WHERE user_id = $1
		ORDER BY provider
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	accounts := make([]ConnectedAccount, 0)
	for rows.Next() {
		var account ConnectedAccount
		if err := rows.Scan(&account.Provider, &account.Status); err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return accounts, nil
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}
