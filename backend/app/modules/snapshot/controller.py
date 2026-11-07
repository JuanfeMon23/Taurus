from typing import Any

from pydantic.alias_generators import to_camel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db.base import Base
from app.modules.cash.models import CashDay, DepositMovement, Movement
from app.modules.categories.models import Category
from app.modules.days.models import Day
from app.modules.services.models import Service
from app.modules.settings.models import Setting
from app.modules.snapshot import repository
from app.modules.snapshot.schemas import SnapshotRead, SnapshotResult, SnapshotWrite

# colección del snapshot -> modelo
MODELS: dict[str, type[Base]] = {
    "categories": Category,
    "days": Day,
    "services": Service,
    "cash": CashDay,
    "movements": Movement,
    "deposit_movements": DepositMovement,
    "settings": Setting,
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


async def apply_snapshot(session: AsyncSession, snapshot: SnapshotWrite) -> SnapshotResult:
    """Aplica el snapshot parcial en una sola transacción."""
    applied: dict[str, int] = {}
    skipped: dict[str, int] = {}
    for col, model in MODELS.items():
        incoming = getattr(snapshot, col)
        unique = _latest_per_id(incoming)
        rows = [rec.model_dump() for rec in unique]
        key = to_camel(col)
        applied[key] = await repository.upsert_lww(session, model, rows) if rows else 0
        skipped[key] = len(incoming) - applied[key]
    await session.commit()
    return SnapshotResult(applied=applied, skipped=skipped)
