"""Generic identity-key registry for domain entities."""


def create_library_identity_schema(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS entity_identity_keys (
            id BIGSERIAL PRIMARY KEY,
            entity_type TEXT NOT NULL,
            entity_uid UUID NOT NULL,
            key_type TEXT NOT NULL,
            key_value TEXT NOT NULL,
            is_primary BOOLEAN NOT NULL DEFAULT FALSE,
            metadata_json JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (entity_type, key_type, key_value),
            UNIQUE (entity_type, entity_uid, key_type, key_value)
        )
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_entity_identity_keys_entity
        ON entity_identity_keys(entity_type, entity_uid)
        """
    )


__all__ = ["create_library_identity_schema"]
