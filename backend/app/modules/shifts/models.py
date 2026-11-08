from datetime import date

from sqlalchemy import Boolean, CheckConstraint, Date, Index, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, SyncMixin

HHMM = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"


class Shift(SyncMixin, Base):
    """Turno de trabajo de un día (varios por día). `end_time` NULL = turno en curso.

    Puede cruzar medianoche: no se exige end_time > start_time.
    """

    __tablename__ = "shifts"
    __table_args__ = (
        CheckConstraint(f"start_time ~ '{HHMM}'", name="start_time_format"),
        CheckConstraint(f"end_time is null or end_time ~ '{HHMM}'", name="end_time_format"),
        Index("ix_shifts_date", "date"),
    )

    date: Mapped[date] = mapped_column(Date)
    start_time: Mapped[str] = mapped_column(Text)
    end_time: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    # Sin FK: el sync LWW por registro puede traer el turno antes que su plantilla.
    template_id: Mapped[str | None] = mapped_column(Text)


class ShiftTemplate(SyncMixin, Base):
    """Plantilla reutilizable de turno; cada día se aplican las trabajadas como `Shift`.

    Puede cruzar medianoche: no se exige end_time > start_time.
    """

    __tablename__ = "shift_templates"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="name_not_empty"),
        CheckConstraint(f"start_time ~ '{HHMM}'", name="start_time_format"),
        CheckConstraint(f"end_time ~ '{HHMM}'", name="end_time_format"),
    )

    name: Mapped[str] = mapped_column(Text)
    start_time: Mapped[str] = mapped_column(Text)
    end_time: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
