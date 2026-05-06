from crate.db.tx import read_scope
from sqlalchemy import text


def get_runtime_taxonomy_rows() -> tuple[list[dict], list[dict], list[dict]]:
    with read_scope() as session:
        node_rows = session.execute(
            text(
                "SELECT slug, name, description, is_top_level, eq_gains "
                "FROM genre_taxonomy_nodes"
            )
        ).mappings().all()
        alias_rows = session.execute(
            text(
                "SELECT gta.alias_slug, gta.alias_name, tn.slug AS canonical_slug "
                "FROM genre_taxonomy_aliases gta "
                "JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id"
            )
        ).mappings().all()
        edge_rows = session.execute(
            text(
                "SELECT source.slug AS source_slug, target.slug AS target_slug, edge.relation_type "
                "FROM genre_taxonomy_edges edge "
                "JOIN genre_taxonomy_nodes source ON source.id = edge.source_genre_id "
                "JOIN genre_taxonomy_nodes target ON target.id = edge.target_genre_id"
            )
        ).mappings().all()
    return (
        [dict(row) for row in node_rows],
        [dict(row) for row in alias_rows],
        [dict(row) for row in edge_rows],
    )
