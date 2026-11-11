import re
from typing import Any

from pydantic.alias_generators import to_camel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db.base import Base
from app.modules.accounts.models import Account
from app.modules.cash.models import CashDay, FundMovement, Movement
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
from app.modules.snapshot.exceptions import (
    AccountRuleViolation,
    TripRequiresShift,
    UnknownCatalogCode,
)
from app.modules.snapshot.schemas import (
    DepositMovementRec,
    MovementRec,
    PaymentMethodRec,
    SnapshotRead,
    SnapshotResult,
    SnapshotWrite,
)

FOREIGN_KEY_VIOLATION = "23503"
CHECK_VIOLATION = "23514"
SHIFT_REQUIRED_CONSTRAINT = "ck_services_shift_required"
DISTINCT_ACCOUNTS_CONSTRAINT = "ck_movements_distinct_accounts"
# Los triggers de 0014 no nombran constraint: se reconocen por su mensaje.
CASH_COHERENCE_MESSAGE = "affects_cash must match"
DESTINATION_MESSAGE = "to_account_id"
CASH_BOX_ACCOUNT = "caja"
DEPOSIT_ACCOUNT = "deposito"
DEPOSIT_WITHDRAWAL_TYPE = "withdrawal"
KEY_DETAIL = re.compile(r"\((?P<column>\w+)\)=\((?P<value>.*?)\)")  # sin depender del idioma

# colección del snapshot -> modelo
# Orden: catálogos primero (las FK son diferidas, pero así el orden es legible).
MODELS: dict[str, type[Base]] = {
    "accounts": Account,
    "rate_modes": RateMode,
    "categories": Category,
    "days": Day,
    "services": Service,
    "cash": CashDay,
    "movements": Movement,
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
        if (detail := _unknown_code_detail(error)) is not None:
            raise UnknownCatalogCode([detail]) from error
        if (detail := _account_rule_detail(error)) is not None:
            raise AccountRuleViolation([detail]) from error
        raise


def ensure_live_trips_have_shift(services: list[Any]) -> None:
    """Un viaje vivo sin `shift_id` se rechaza antes de tocar la BD (la lápida no lo exige)."""
    if any(not service.deleted and service.shift_id is None for service in services):
        raise TripRequiresShift


def _check_violation_cause(error: IntegrityError) -> Any | None:
    cause = getattr(error.orig, "__cause__", None) or error.orig
    return cause if getattr(cause, "sqlstate", None) == CHECK_VIOLATION else None


def _is_shift_required_violation(error: IntegrityError) -> bool:
    cause = _check_violation_cause(error)
    return getattr(cause, "constraint_name", None) == SHIFT_REQUIRED_CONSTRAINT


def _account_rule_detail(error: IntegrityError) -> dict[str, str] | None:
    """Detalle `{campo, mensaje}` si el CHECK o trigger de cuentas falló; si no, None."""
    cause = _check_violation_cause(error)
    if cause is None:
        return None
    message = str(getattr(cause, "message", "") or cause)
    if getattr(cause, "constraint_name", None) == DISTINCT_ACCOUNTS_CONSTRAINT:
        return _SAME_ACCOUNT_DETAIL
    if CASH_COHERENCE_MESSAGE in message:
        return _CASH_COHERENCE_DETAIL
    if DESTINATION_MESSAGE in message:
        return _DESTINATION_DETAIL
    return None


_SAME_ACCOUNT_DETAIL = {
    "campo": "movements.toAccountId",
    "mensaje": "El destino debe ser distinto de la cuenta de origen",
}
_CASH_COHERENCE_DETAIL = {
    "campo": "paymentMethods.affectsCash",
    "mensaje": "affectsCash debe ser verdadero solo si la cuenta es la caja",
}
_DESTINATION_DETAIL = {
    "campo": "movements.toAccountId",
    "mensaje": "El traslado necesita cuenta de destino y los demás movimientos no la admiten",
}


async def resolve_movement_accounts(
    session: AsyncSession,
    movements: list[MovementRec],
    payment_methods: list[PaymentMethodRec],
) -> list[MovementRec]:
    """Completa `account_id` de un cliente viejo: la cuenta de su `method` o, si no, la caja."""
    pending_methods = [rec.method for rec in movements if rec.account_id is None and rec.method]
    method_accounts = await repository.payment_method_accounts(session, pending_methods)
    method_accounts.update({rec.id: rec.account_id for rec in payment_methods})
    return [
        rec
        if rec.account_id is not None
        else rec.model_copy(
            update={"account_id": method_accounts.get(rec.method or "", CASH_BOX_ACCOUNT)}
        )
        for rec in movements
    ]


def ensure_transfer_accounts_differ(movements: list[MovementRec]) -> None:
    if any(
        rec.to_account_id is not None and rec.to_account_id == rec.account_id for rec in movements
    ):
        raise AccountRuleViolation([_SAME_ACCOUNT_DETAIL])


async def check_account_rules(
    session: AsyncSession, payment_methods: list[PaymentMethodRec], movements: list[MovementRec]
) -> None:
    """Con los registros ya escritos (aún sin confirmar): coherencia `affectsCash`/caja y
    destino de traslados. Lanza 422 con el detalle por campo."""
    details: list[dict[str, str]] = []
    incoherent = await repository.payment_methods_incoherent_with_account(
        session, [rec.id for rec in payment_methods]
    )
    details += [
        {"campo": "paymentMethods.affectsCash", "mensaje": _CASH_COHERENCE_DETAIL["mensaje"]}
        for _ in incoherent
    ]
    missing, forbidden = await repository.movements_with_wrong_destination(
        session, [rec.id for rec in movements]
    )
    details += [
        {"campo": "movements.toAccountId", "mensaje": "El traslado necesita cuenta de destino"}
        for _ in missing
    ]
    details += [
        {"campo": "movements.toAccountId", "mensaje": "Solo un traslado lleva cuenta de destino"}
        for _ in forbidden
    ]
    if details:
        raise AccountRuleViolation(details)


def convert_deposit_movement(record: DepositMovementRec) -> MovementRec:
    """Salida del depósito de un cliente viejo -> movimiento `withdrawal` de la cuenta depósito."""
    return MovementRec(
        id=record.id,
        updated_at=record.updated_at,
        deleted=record.deleted,
        date=record.date,
        type=DEPOSIT_WITHDRAWAL_TYPE,
        amount=record.amount,
        account_id=DEPOSIT_ACCOUNT,
        note=record.note,
    )


async def _upsert_collection(
    session: AsyncSession, model: type[Base], records: list[Any]
) -> tuple[int, int]:
    unique = _latest_per_id(records)
    rows = [rec.model_dump() for rec in unique]
    count = await repository.upsert_lww(session, model, rows) if rows else 0
    return count, len(records) - count


async def apply_snapshot(session: AsyncSession, snapshot: SnapshotWrite) -> SnapshotResult:
    """Aplica el snapshot parcial en una sola transacción."""
    ensure_live_trips_have_shift(_latest_per_id(snapshot.services))
    movements = await resolve_movement_accounts(
        session, snapshot.movements, snapshot.payment_methods
    )
    ensure_transfer_accounts_differ(movements)
    incoming = {col: getattr(snapshot, col) for col in MODELS}
    incoming["movements"] = movements
    applied: dict[str, int] = {}
    skipped: dict[str, int] = {}
    try:
        # En una sesión reutilizada puede arrastrar IMMEDIATE de un PUT anterior.
        await session.execute(text("SET CONSTRAINTS ALL DEFERRED"))
        for col, model in MODELS.items():
            key = to_camel(col)
            applied[key], skipped[key] = await _upsert_collection(session, model, incoming[col])
        # Compatibilidad con clientes viejos: sus salidas del depósito pasan a `movements`.
        deposits = [convert_deposit_movement(rec) for rec in snapshot.deposit_movements]
        applied["depositMovements"], skipped["depositMovements"] = await _upsert_collection(
            session, Movement, deposits
        )
        await check_account_rules(session, snapshot.payment_methods, movements + deposits)
    except IntegrityError as error:  # red de seguridad: el CHECK del turno da el mismo 422
        await session.rollback()
        if _is_shift_required_violation(error):
            raise TripRequiresShift from error
        if (detail := _account_rule_detail(error)) is not None:
            raise AccountRuleViolation([detail]) from error
        raise
    except AccountRuleViolation:
        await session.rollback()
        raise
    await _commit_checking_catalog_codes(session)
    return SnapshotResult(applied=applied, skipped=skipped)
