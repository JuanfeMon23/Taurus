from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db.base import Base
from app.modules.accounts.models import Account
from app.modules.cash.models import Movement
from app.modules.catalogs.models import MovementType, PaymentMethod

CHUNK = 500


async def fetch_all(session: AsyncSession, model: type[Base]) -> list[Any]:
    """Todos los registros, lápidas incluidas, en orden estable."""
    result = await session.scalars(select(model).order_by(model.id))  # type: ignore[attr-defined]
    return list(result)


async def upsert_lww(session: AsyncSession, model: type[Base], rows: list[dict[str, Any]]) -> int:
    """Upsert por id, last-write-wins. Devuelve cuántas filas se aplicaron.

    Se aplica si `updated_at` entrante es mayor; en empate gana la lápida (no se revive
    un registro borrado con el mismo `updated_at`).
    """
    applied = 0
    for start in range(0, len(rows), CHUNK):
        stmt = insert(model).values(rows[start : start + CHUNK])
        table = model.__table__  # type: ignore[attr-defined]
        excluded = stmt.excluded
        stmt = stmt.on_conflict_do_update(
            index_elements=["id"],
            set_={
                column.name: excluded[column.name]
                for column in table.columns
                if column.name != "id"
            },
            where=or_(
                excluded.updated_at > table.c.updated_at,
                and_(
                    excluded.updated_at == table.c.updated_at,
                    or_(excluded.deleted, ~table.c.deleted),
                ),
            ),
        ).returning(table.c.id)
        applied += len((await session.execute(stmt)).all())
    return applied


async def payment_method_accounts(session: AsyncSession, method_ids: list[str]) -> dict[str, str]:
    """`{medio: cuenta}` de los medios guardados (los del mismo PUT los suma el controller)."""
    if not method_ids:
        return {}
    rows = await session.execute(
        select(PaymentMethod.id, PaymentMethod.account_id).where(PaymentMethod.id.in_(method_ids))
    )
    return {method_id: account_id for method_id, account_id in rows}


async def payment_methods_incoherent_with_account(
    session: AsyncSession, method_ids: list[str]
) -> list[str]:
    """Medios cuyo `affects_cash` no coincide con `is_cash_box` de su cuenta (ya escritos)."""
    if not method_ids:
        return []
    result = await session.scalars(
        select(PaymentMethod.id)
        .join(Account, Account.id == PaymentMethod.account_id)
        .where(PaymentMethod.id.in_(method_ids), PaymentMethod.affects_cash != Account.is_cash_box)
        .order_by(PaymentMethod.id)
    )
    return list(result)


async def movements_with_wrong_destination(
    session: AsyncSession, movement_ids: list[str]
) -> tuple[list[str], list[str]]:
    """`(sin destino siendo traslado, con destino sin ser traslado)` entre los ya escritos."""
    if not movement_ids:
        return [], []
    rows = await session.execute(
        select(Movement.id, MovementType.requires_destination)
        .join(MovementType, MovementType.id == Movement.type)
        .where(
            Movement.id.in_(movement_ids),
            MovementType.requires_destination != Movement.to_account_id.is_not(None),
        )
        .order_by(Movement.id)
    )
    rows = rows.all()
    missing = [movement_id for movement_id, required in rows if required]
    forbidden = [movement_id for movement_id, required in rows if not required]
    return missing, forbidden


async def payment_methods_pointing_to_commission_account(session: AsyncSession) -> list[str]:
    """Medios (ya escritos) cuya cuenta es la de comisión: ninguno puede apuntar a ella."""
    result = await session.scalars(
        select(PaymentMethod.id)
        .join(Account, Account.id == PaymentMethod.account_id)
        .where(Account.commission_since.is_not(None))
        .order_by(PaymentMethod.id)
    )
    return list(result)
