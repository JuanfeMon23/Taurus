from collections.abc import Callable

from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.db import registry  # noqa: F401
from app.core.db.base import Base

TABLES = {"categories", "days", "cash_days", "movements", "services"}


async def _tables(url: str) -> set[str]:
    engine = create_async_engine(url)
    async with engine.connect() as conn:
        names = await conn.run_sync(lambda c: set(inspect(c).get_table_names()))
    await engine.dispose()
    return names - {"alembic_version"}


async def test_head_matches_metadata(test_url: str) -> None:
    assert await _tables(test_url) == TABLES == set(Base.metadata.tables)


async def test_downgrade_base_and_upgrade_head(test_url: str, alembic: Callable[..., None]) -> None:
    alembic("downgrade", "base")
    try:
        assert await _tables(test_url) == set()
    finally:
        alembic("upgrade", "head")
    assert await _tables(test_url) == TABLES


async def _service_columns(url: str) -> set[str]:
    engine = create_async_engine(url)
    async with engine.connect() as conn:
        cols = await conn.run_sync(
            lambda c: {x["name"] for x in inspect(c).get_columns("services")}
        )
    await engine.dispose()
    return cols


async def test_bonus_column_added_and_removed_by_0002(
    test_url: str, alembic: Callable[..., None]
) -> None:
    assert "bonus" in await _service_columns(test_url)
    alembic("downgrade", "0001")
    try:
        assert "bonus" not in await _service_columns(test_url)
    finally:
        alembic("upgrade", "head")
    assert "bonus" in await _service_columns(test_url)
