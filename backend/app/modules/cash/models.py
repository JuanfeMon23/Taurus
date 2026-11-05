from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, Index, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, SyncMixin


class CashDay(SyncMixin, Base):
    """id = fecha (YYYY-MM-DD)."""

    __tablename__ = "cash_days"
    __table_args__ = (
        CheckConstraint("opening >= 0", name="opening_non_negative"),
        CheckConstraint("counted >= 0", name="counted_non_negative"),
    )

    date: Mapped[date] = mapped_column(Date)
    opening: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    counted: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))


class Movement(SyncMixin, Base):
    __tablename__ = "movements"
    __table_args__ = (
        CheckConstraint("type in ('expense', 'withdrawal', 'deposit')", name="type"),
        CheckConstraint("amount >= 0", name="amount_non_negative"),
        Index("ix_movements_date", "date"),
    )

    date: Mapped[date] = mapped_column(Date)
    type: Mapped[str] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    note: Mapped[str | None] = mapped_column(Text)
