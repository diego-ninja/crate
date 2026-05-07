package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thecrateapp/crate/app/readplane/internal/config"
)

func Connect(ctx context.Context, cfg config.Config) (*pgxpool.Pool, error) {
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	poolCfg.MaxConns = cfg.MaxDBConns
	poolCfg.MinConns = cfg.MinDBConns
	poolCfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeCacheStatement
	poolCfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, "SET default_transaction_read_only = on")
		return err
	}
	return pgxpool.NewWithConfig(ctx, poolCfg)
}

func WithTimeout(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		timeout = 800 * time.Millisecond
	}
	return context.WithTimeout(parent, timeout)
}

func IsUndefinedTable(err error) bool {
	var pgErr *pgconn.PgError
	return err != nil && AsPgError(err, &pgErr) && pgErr.Code == "42P01"
}

func AsPgError(err error, target **pgconn.PgError) bool {
	return errors.As(err, target)
}

func RequiredTablesReady(ctx context.Context, pool *pgxpool.Pool) error {
	const query = `
		SELECT
			to_regclass('public.users') IS NOT NULL
			AND to_regclass('public.sessions') IS NOT NULL
			AND to_regclass('public.user_external_identities') IS NOT NULL
			AND to_regclass('public.settings') IS NOT NULL
			AND to_regclass('public.ui_snapshots') IS NOT NULL
	`
	var ok bool
	if err := pool.QueryRow(ctx, query).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("required readplane tables are missing")
	}
	return nil
}
