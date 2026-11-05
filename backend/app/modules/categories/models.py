from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, SyncMixin


class Category(SyncMixin, Base):
    __tablename__ = "categories"
    __table_args__ = (
        CheckConstraint("rate_mode in ('direct', 'derived')", name="rate_mode"),
        CheckConstraint("rate_per_km >= 0", name="rate_per_km_non_negative"),
        CheckConstraint("total_cost >= 0", name="total_cost_non_negative"),
        CheckConstraint("interval_km > 0", name="interval_km_positive"),
    )

    name: Mapped[str] = mapped_column(Text)
    rate_mode: Mapped[str] = mapped_column(Text)
    rate_per_km: Mapped[Decimal | None] = mapped_column(Numeric(14, 6))
    total_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    interval_km: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    active: Mapped[bool] = mapped_column(Boolean, server_default="true")
