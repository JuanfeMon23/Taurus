from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import CheckConstraint, Date, Numeric, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, SyncMixin


class Day(SyncMixin, Base):
    """id = fecha (YYYY-MM-DD). `costs` es el snapshot CostLine[] aplicado al guardar."""

    __tablename__ = "days"
    __table_args__ = (CheckConstraint("km >= 0", name="km_non_negative"),)

    date: Mapped[date] = mapped_column(Date)
    km: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    note: Mapped[str | None] = mapped_column(Text)
    costs: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
