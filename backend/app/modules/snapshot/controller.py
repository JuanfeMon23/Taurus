import re
from typing import Any

from pydantic.alias_generators import to_camel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db.base import Base
from app.modules.cash.models import CashDay, DepositMovement, FundMovement, Movement
from app.modules.catalogs.models import (
    ExpenseCategory,
    FundMovementType,
    MovementType,
    PaymentMethod,
    RateMode,
)
from app.modules.categories.models import Category
from app.modules.days.models import Day
from app.modules.services.models import Service
from app.modules.settings.models import Setting
from app.modules.shifts.models import Shift, ShiftTemplate
from app.modules.snapshot import repository
from app.modules.snapshot.exceptions import TripRequiresShift, UnknownCatalogCode
from app.modules.snapshot.schemas import SnapshotRead, SnapshotResult, SnapshotWrite

FOREIGN_KEY_VIOLATION = "23503"
CHECK_VIOLATION = "23514"
SHIFT_REQUIRED_CONSTRAINT = "ck_services_shift_required"
KEY_DETAIL = re.compile(r"\((?P<column>\w+)\)=\((?P<value>.*?)\)")  # sin depender del idioma

# colección del snapshot -> modelo
# Orden: catálogos primero (las FK son diferidas, pero así el orden es legible).
MODELS: dict[str, type[Base]] = {
    "rate_modes": RateMode,
    "categories": Category,
    "days": Day,
    "services": Service,
    "cash": CashDay,
    "movements": Movement,
    "deposit_movements": DepositMovement,
    "fund_movements": FundMovement,
    "settings": Setting,
    "shifts": Shift,
    "shift_templates": ShiftTemplate,
    "payment_methods": PaymentMethod,
    "movement_types": MovementType,
    "fund_movement_types": FundMovementType,
    "expense_categories": ExpenseCategory,
}


def _beats(candidate: Any, incumbent: Any) -> bool:
    """True si el registro `candidate` gana sobre `incumbent` (más nuevo; en empate, la lápida)."""
    if candidate.updated_at != incumbent.updated_at:
        return candidate.updated_at > incumbent.updated_at
    return candidate.deleted and not incumbent.deleted


def _latest_per_id(records: list[Any]) -> list[Any]:
    winners: dict[str, Any] = {}
    for rec in records:
        current = winners.get(rec.id)
        if current is None or _beats(rec, current):
            winners[rec.id] = rec
    return list(winners.values())


async def get_snapshot(session: AsyncSession) -> SnapshotRead:
    data = {col: await repository.fetch_all(session, model) for col, model in MODELS.items()}
    return SnapshotRead.model_validate(data)


def _unknown_code_detail(error: IntegrityError) -> dict[str, str] | None:
    """Detalle `{campo, mensaje}` si el error es una FK de código de catálogo; si no, None."""
    cause = getattr(error.orig, "__cause__", None) or error.orig
    if getattr(cause, "sqlstate", None) != FOREIGN_KEY_VIOLATION:
        return None
    match = KEY_DETAIL.search(str(getattr(cause, "detail", "") or ""))
    table = getattr(cause, "table_name", "") or ""
    if not match:
        return None
    collection = next(
        (to_camel(col) for col, model in MODELS.items() if model.__tablename__ == table), table
    )  # type: ignore[attr-defined]
    return {
        "campo": f"{collection}.{to_camel(match['column'])}",
        "mensaje": f"Código de catálogo desconocido: {match['value']}",
    }


async def _commit_checking_catalog_codes(session: AsyncSession) -> None:
    """Valida ya las FK diferidas (el orden de los registros no importa) y confirma.

    Un código inexistente deshace todo (nada parcial) y se traduce a 422.
    """
    try:
        await session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        detail = _unknown_code_detail(error)
        if detail is None:
            raise
        raise UnknownCatalogCode([detail]) from error


def ensure_live_trips_have_shift(services: list[Any]) -> None:
    """Un viaje vivo sin `shift_id` se rechaza antes de tocar la BD (la lápida no lo exige)."""
    if any(not service.deleted and service.shift_id is None for service in services):
        raise TripRequiresShift


def _is_shift_required_violation(error: IntegrityError) -> bool:
    cause = getattr(error.orig, "__cause__", None) or error.orig
    return (
        getattr(cause, "sqlstate", None) == CHECK_VIOLATION
        and getattr(cause, "constraint_name", None) == SHIFT_REQUIRED_CONSTRAINT
    )


async def apply_snapshot(session: AsyncSession, snapshot: SnapshotWrite) -> SnapshotResult:
    """Aplica el snapshot parcial en una sola transacción."""
    ensure_live_trips_have_shift(_latest_per_id(snapshot.services))
    applied: dict[str, int] = {}
    skipped: dict[str, int] = {}
    try:
        # En una sesión reutilizada puede arrastrar IMMEDIATE de un PUT anterior.
        await session.execute(text("SET CONSTRAINTS ALL DEFERRED"))
        for col, model in MODELS.items():
            incoming = getattr(snapshot, col)
            unique = _latest_per_id(incoming)
            rows = [rec.model_dump() for rec in unique]
            key = to_camel(col)
            applied[key] = await repository.upsert_lww(session, model, rows) if rows else 0
            skipped[key] = len(incoming) - applied[key]
    except IntegrityError as error:  # red de seguridad: el CHECK del turno da el mismo 422
        await session.rollback()
        if _is_shift_required_violation(error):
            raise TripRequiresShift from error
        raise
    await _commit_checking_catalog_codes(session)
    return SnapshotResult(applied=applied, skipped=skipped)
