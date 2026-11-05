from datetime import datetime

from sqlalchemy import Boolean, DateTime, MetaData, Text, func, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "pk": "pk_%(table_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ix": "ix_%(column_0_label)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class SyncMixin:
    """Campos comunes de todo registro sincronizable. El id lo genera el cliente."""

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
