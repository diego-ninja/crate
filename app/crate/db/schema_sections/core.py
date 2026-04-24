"""Core schema bootstrap section."""


def create_core_schema(cur) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            progress TEXT DEFAULT '',
            params_json JSONB DEFAULT '{}',
            result_json JSONB,
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            priority INTEGER DEFAULT 2,
            pool TEXT DEFAULT 'default',
            parent_task_id TEXT,
            max_duration_sec INTEGER DEFAULT 1800,
            heartbeat_at TIMESTAMPTZ,
            worker_id TEXT,
            retry_count INTEGER DEFAULT 0,
            max_retries INTEGER DEFAULT 0,
            started_at TIMESTAMPTZ
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at)")
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_tasks_dispatch
        ON tasks (pool, priority, created_at) WHERE status = 'pending'
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_tasks_parent
        ON tasks (parent_task_id) WHERE parent_task_id IS NOT NULL
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_tasks_heartbeat
        ON tasks (heartbeat_at) WHERE status = 'running'
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS scan_results (
            id SERIAL PRIMARY KEY,
            task_id TEXT REFERENCES tasks(id),
            issues_json JSONB NOT NULL,
            scanned_at TIMESTAMPTZ NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS health_issues (
            id SERIAL PRIMARY KEY,
            check_type TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'medium',
            description TEXT NOT NULL,
            details_json JSONB DEFAULT '{}',
            auto_fixable BOOLEAN DEFAULT FALSE,
            status TEXT NOT NULL DEFAULT 'open',
            created_at TIMESTAMPTZ NOT NULL,
            resolved_at TIMESTAMPTZ
        )
    """)
    cur.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_health_issues_dedup
        ON health_issues (check_type, md5(description)) WHERE status = 'open'
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS task_events (
            id SERIAL PRIMARY KEY,
            task_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            data_json JSONB DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, id)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS mb_cache (
            key TEXT PRIMARY KEY,
            value_json JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_mb_cache_created ON mb_cache(created_at)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS cache (
            key TEXT PRIMARY KEY,
            value_json JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS dir_mtimes (
            path TEXT PRIMARY KEY,
            mtime DOUBLE PRECISION NOT NULL,
            data_json JSONB
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMPTZ NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_name TEXT NOT NULL,
            details_json JSONB DEFAULT '{}',
            user_id INTEGER,
            task_id TEXT
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC)")
