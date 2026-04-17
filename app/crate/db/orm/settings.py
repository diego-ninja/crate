from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from crate.db.engine import Base


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)
