from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, Index, Numeric, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, SyncMixin, catalog_fk
from app.modules.accounts.models import Account  # noqa: F401  (FK de movements.account_id)


class CashDay(SyncMixin, Base):
    """id = fecha (YYYY-MM-DD)."""

    __tablename__ = "cash_days"
    __table_args__ = (
        CheckConstraint("opening >= 0", name="opening_non_negative"),
        CheckConstraint("counted >= 0", name="counted_non_negative"),
        CheckConstraint("to_deposit >= 0", name="to_deposit_non_negative"),
    )

    date: Mapped[date] = mapped_column(Date)
    opening: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    counted: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    to_deposit: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))


class Movement(SyncMixin, Base):
    __tablename__ = "movements"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="amount_non_negative"),
        Index("ix_movements_date", "date"),
        Index("ix_movements_type", "type"),
        Index("ix_movements_method", "method"),
        Index("ix_movements_account_id", "account_id"),
        Index("ix_movements_to_account_id", "to_account_id"),
        CheckConstraint(
            "to_account_id IS NULL OR to_account_id <> account_id", name="distinct_accounts"
        ),
        Index("ix_movements_category_id", "category_id"),
    )

    date: Mapped[date] = mapped_column(Date)
    type: Mapped[str] = mapped_column(Text, catalog_fk("movement_types"))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    note: Mapped[str | None] = mapped_column(Text)
    category_id: Mapped[str | None] = mapped_column(Text, catalog_fk("expense_categories"))
    # Cuenta de origen (la afectada por `type.sign`) y, en un traslado, la de destino; el trigger
    # diferido exige to_account_id solo si el tipo tiene requires_destination.
    account_id: Mapped[str] = mapped_column(
        Text, catalog_fk("accounts"), server_default=text("'caja'")
    )
    to_account_id: Mapped[str | None] = mapped_column(Text, catalog_fk("accounts"))
    # Obsoleto: lo reemplaza account_id; se conserva sin uso nuevo.
    method: Mapped[str | None] = mapped_column(
        Text, catalog_fk("payment_methods"), server_default=text("'cash'")
    )


class DepositMovement(SyncMixin, Base):
    """Salida registrada del depósito; saldo = sum(cash_days.to_deposit) - sum(amount)."""

    __tablename__ = "deposit_movements"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="amount_non_negative"),
        Index("ix_deposit_movements_date", "date"),
    )

    date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    note: Mapped[str | None] = mapped_column(Text)


class FundMovement(SyncMixin, Base):
    """Fondo por categoría de costo: 'transfer' = envío al fondo, 'spend' = gasto pagado con él.

    `type` y `category_id` son FK diferidas (a `fund_movement_types` y `categories`).
    """

    __tablename__ = "fund_movements"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="amount_non_negative"),
        Index("ix_fund_movements_date", "date"),
        Index("ix_fund_movements_category_id", "category_id"),
        Index("ix_fund_movements_type", "type"),
    )

    date: Mapped[date] = mapped_column(Date)
    category_id: Mapped[str] = mapped_column(Text, catalog_fk("categories"))
    type: Mapped[str] = mapped_column(Text, catalog_fk("fund_movement_types"))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    note: Mapped[str | None] = mapped_column(Text)
