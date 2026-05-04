import uuid
from typing import Optional

from sqlalchemy import Boolean, Float, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crate.db.engine import Base


class GenreTaxonomyNode(Base):
    __tablename__ = "genre_taxonomy_nodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_uid: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    external_description: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    external_description_source: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    musicbrainz_mbid: Mapped[Optional[str]] = mapped_column(Text)
    wikidata_entity_id: Mapped[Optional[str]] = mapped_column(Text)
    wikidata_url: Mapped[Optional[str]] = mapped_column(Text)
    is_top_level: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    eq_gains: Mapped[Optional[list[float]]] = mapped_column(ARRAY(Float))

    aliases: Mapped[list["GenreTaxonomyAlias"]] = relationship(back_populates="genre")
    outgoing_edges: Mapped[list["GenreTaxonomyEdge"]] = relationship(
        foreign_keys="GenreTaxonomyEdge.source_genre_id",
        back_populates="source_genre",
    )
    incoming_edges: Mapped[list["GenreTaxonomyEdge"]] = relationship(
        foreign_keys="GenreTaxonomyEdge.target_genre_id",
        back_populates="target_genre",
    )


class GenreTaxonomyAlias(Base):
    __tablename__ = "genre_taxonomy_aliases"

    alias_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    alias_name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    genre_id: Mapped[int] = mapped_column(Integer, ForeignKey("genre_taxonomy_nodes.id", ondelete="CASCADE"), nullable=False)

    genre: Mapped["GenreTaxonomyNode"] = relationship(back_populates="aliases")


class GenreTaxonomyEdge(Base):
    __tablename__ = "genre_taxonomy_edges"

    source_genre_id: Mapped[int] = mapped_column(Integer, ForeignKey("genre_taxonomy_nodes.id", ondelete="CASCADE"), primary_key=True)
    target_genre_id: Mapped[int] = mapped_column(Integer, ForeignKey("genre_taxonomy_nodes.id", ondelete="CASCADE"), primary_key=True)
    relation_type: Mapped[str] = mapped_column(Text, primary_key=True)
    weight: Mapped[float] = mapped_column(Float, nullable=False, server_default="1.0")

    source_genre: Mapped["GenreTaxonomyNode"] = relationship(
        foreign_keys=[source_genre_id],
        back_populates="outgoing_edges",
    )
    target_genre: Mapped["GenreTaxonomyNode"] = relationship(
        foreign_keys=[target_genre_id],
        back_populates="incoming_edges",
    )
