from collections.abc import Callable
from decimal import Decimal

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.db import registry  # noqa: F401
from app.core.db.base import Base

TABLES = {
    "categories",
    "days",
    "cash_days",
    "movements",
    "services",
    "deposit_movements",
    "settings",
}


async def _tables(url: str) -> set[str]:
    engine = create_async_engine(url)
    async with engine.connect() as conn:
        names = await conn.run_sync(lambda sync_conn: set(inspect(sync_conn).get_table_names()))
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


async def _columns(url: str, table: str) -> set[str]:
    engine = create_async_engine(url)
    async with engine.connect() as conn:
        column_names = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns(table)}
        )
    await engine.dispose()
    return column_names


async def test_bonus_column_added_and_removed_by_0002(
    test_url: str, alembic: Callable[..., None]
) -> None:
    assert "bonus" in await _columns(test_url, "services")
    alembic("downgrade", "0001")
    try:
        assert "bonus" not in await _columns(test_url, "services")
    finally:
        alembic("upgrade", "head")
    assert "bonus" in await _columns(test_url, "services")


async def test_deposit_added_and_removed_by_0003(
    test_url: str, alembic: Callable[..., None]
) -> None:
    assert "to_deposit" in await _columns(test_url, "cash_days")
    alembic("downgrade", "0002")
    try:
        assert "to_deposit" not in await _columns(test_url, "cash_days")
        assert "deposit_movements" not in await _tables(test_url)
    finally:
        alembic("upgrade", "head")
    assert "to_deposit" in await _columns(test_url, "cash_days")
    assert "deposit_movements" in await _tables(test_url)


async def test_commission_added_and_removed_by_0004(
    test_url: str, alembic: Callable[..., None]
) -> None:
    new_columns = {"is_indrive", "commission", "commission_vat"}
    assert new_columns <= await _columns(test_url, "services")
    alembic("downgrade", "0003")
    try:
        assert not new_columns & await _columns(test_url, "services")
        assert "settings" not in await _tables(test_url)
    finally:
        alembic("upgrade", "head")
    assert new_columns <= await _columns(test_url, "services")
    assert "settings" in await _tables(test_url)


async def test_0004_backfills_live_services_and_seeds_rates(
    test_url: str, alembic: Callable[..., None]
) -> None:
    engine = create_async_engine(test_url)
    alembic("downgrade", "0003")
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into services (id, date, amount, method, deleted, updated_at) values "
                    "('live', '2026-11-01', 9000, 'cash', false, '2026-01-01'), "
                    "('dead', '2026-11-01', 9000, 'cash', true, '2026-01-01')"
                )
            )
        alembic("upgrade", "0004")
        async with engine.connect() as conn:
            rows = {
                row.id: row
                for row in await conn.execute(
                    text(
                        "select id, is_indrive, commission, commission_vat, "
                        "updated_at > '2026-06-01' as touched from services"
                    )
                )
            }
            rates = (
                await conn.execute(text("select commission_rate, vat_rate from settings"))
            ).one()
        assert rows["live"].commission == Decimal("855.00")
        assert rows["live"].commission_vat == Decimal("162.45")
        assert rows["live"].touched and rows["live"].is_indrive
        assert rows["dead"].commission == 0 and rows["dead"].commission_vat == 0
        assert not rows["dead"].touched
        assert (rates.commission_rate, rates.vat_rate) == (Decimal("0.0950"), Decimal("0.1900"))
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("delete from services where id in ('live', 'dead')"))
        alembic("upgrade", "head")
        await engine.dispose()
