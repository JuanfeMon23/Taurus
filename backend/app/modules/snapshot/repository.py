from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db.base import Base

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
