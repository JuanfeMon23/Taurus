from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db.base import Base
from app.modules.cash.models import CashDay, Movement
from app.modules.categories.models import Category
from app.modules.days.models import Day
from app.modules.services.models import Service
from app.modules.snapshot import repository
from app.modules.snapshot.schemas import SnapshotRead, SnapshotResult, SnapshotWrite

# colección del snapshot -> modelo
MODELS: dict[str, type[Base]] = {
    "categories": Category,
    "days": Day,
    "services": Service,
    "cash": CashDay,
    "movements": Movement,
}


def _beats(a: Any, b: Any) -> bool:
    """True si el registro `a` gana sobre `b` (más nuevo; en empate, la lápida)."""
    if a.updated_at != b.updated_at:
        return a.updated_at > b.updated_at
    return a.deleted and not b.deleted


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


async def apply_snapshot(session: AsyncSession, snapshot: SnapshotWrite) -> SnapshotResult:
    """Aplica el snapshot parcial en una sola transacción."""
    applied: dict[str, int] = {}
    skipped: dict[str, int] = {}
    for col, model in MODELS.items():
        incoming = getattr(snapshot, col)
        unique = _latest_per_id(incoming)
        rows = [rec.model_dump() for rec in unique]
        applied[col] = await repository.upsert_lww(session, model, rows) if rows else 0
        skipped[col] = len(incoming) - applied[col]
    await session.commit()
    return SnapshotResult(applied=applied, skipped=skipped)
