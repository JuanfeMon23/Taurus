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
    "fund_movements",
    "settings",
    "shifts",
    "shift_templates",
    "payment_methods",
    "movement_types",
    "fund_movement_types",
    "expense_categories",
    "rate_modes",
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


async def test_funds_added_and_removed_by_0005(test_url: str, alembic: Callable[..., None]) -> None:
    new_columns = {"category_id", "method"}
    assert new_columns <= await _columns(test_url, "movements")
    assert "fund_movements" in await _tables(test_url)
    alembic("downgrade", "0004")
    try:
        assert not new_columns & await _columns(test_url, "movements")
        assert "fund_movements" not in await _tables(test_url)
    finally:
        alembic("upgrade", "head")
    assert new_columns <= await _columns(test_url, "movements")
    assert "fund_movements" in await _tables(test_url)


async def test_shifts_table_added_and_removed_by_0006(
    test_url: str, alembic: Callable[..., None]
) -> None:
    assert "shifts" in await _tables(test_url)
    alembic("downgrade", "0005")
    try:
        assert "shifts" not in await _tables(test_url)
    finally:
        alembic("upgrade", "head")
    assert "shifts" in await _tables(test_url)


async def test_shift_templates_added_and_removed_by_0007(
    test_url: str, alembic: Callable[..., None]
) -> None:
    assert "shift_templates" in await _tables(test_url)
    assert "template_id" in await _columns(test_url, "shifts")
    alembic("downgrade", "0006")
    try:
        assert "shift_templates" not in await _tables(test_url)
        assert "template_id" not in await _columns(test_url, "shifts")
    finally:
        alembic("upgrade", "head")
    assert "shift_templates" in await _tables(test_url)
    assert "template_id" in await _columns(test_url, "shifts")


async def test_0008_backfills_category_and_roundtrips(
    test_url: str, alembic: Callable[..., None]
) -> None:
    engine = create_async_engine(test_url)
    alembic("downgrade", "0007")
    try:
        assert "category" in await _columns(test_url, "movements")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into movements (id, date, type, amount, category, method, deleted) "
                    "values ('a', '2026-11-01', 'expense', 5, '  Gasolina ', 'cash', false), "
                    "('b', '2026-11-01', 'expense', 5, 'GASOLINA', 'cash', false), "
                    "('c', '2026-11-01', 'expense', 5, 'comida', 'cash', false), "
                    "('d', '2026-11-01', 'expense', 5, '   ', 'cash', false), "
                    "('e', '2026-11-01', 'expense', 5, null, 'cash', false)"
                )
            )
        alembic("upgrade", "0008")
        assert "category" not in await _columns(test_url, "movements")
        async with engine.connect() as conn:
            ids = {
                r.id: r.category_id
                for r in await conn.execute(text("select id, category_id from movements"))
            }
            cats = {
                r.id: r.name
                for r in await conn.execute(text("select id, name from expense_categories"))
            }
        assert ids == {"a": "gasolina", "b": "gasolina", "c": "comida", "d": None, "e": None}
        assert set(cats) == {"comida", "parqueadero", "varios", "gasolina"}
        assert cats["comida"] == "Comida" and cats["gasolina"] in {"Gasolina", "GASOLINA"}
        async with engine.begin() as conn:
            await conn.execute(text("update movements set method = 'card' where id = 'e'"))
        alembic("downgrade", "0007")
        async with engine.connect() as conn:
            restored = {
                r.id: (r.category, r.method)
                for r in await conn.execute(text("select id, category, method from movements"))
            }
        assert restored["c"] == ("Comida", "cash")
        assert restored["a"][0] == restored["b"][0] == cats["gasolina"]
        assert restored["d"][0] is None and restored["e"] == (None, "cash")
        names = await _tables(test_url)
        assert "payment_methods" not in names and "expense_categories" not in names
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("delete from movements where id in ('a','b','c','d','e')"))
        alembic("upgrade", "head")
        await engine.dispose()
    assert "category_id" in await _columns(test_url, "movements")


async def test_0009_has_category_default_backfill_and_roundtrip(
    test_url: str, alembic: Callable[..., None]
) -> None:
    engine = create_async_engine(test_url)
    try:
        async with engine.connect() as conn:
            flags = {
                r.id: r.has_category
                for r in await conn.execute(text("select id, has_category from movement_types"))
            }
        assert flags["expense"] is True
        assert [k for k, v in flags.items() if v] == ["expense"]
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into movement_types (id, name, sign, deleted) "
                    "values ('t9', 'Prueba', 1, false)"
                )
            )
        async with engine.connect() as conn:
            default = (
                await conn.execute(text("select has_category from movement_types where id='t9'"))
            ).scalar_one()
        assert default is False
        alembic("downgrade", "0008")
        assert "has_category" not in await _columns(test_url, "movement_types")
        alembic("upgrade", "0009")
        async with engine.connect() as conn:
            again = {
                r.id: r.has_category
                for r in await conn.execute(text("select id, has_category from movement_types"))
            }
        assert again["expense"] is True and again["t9"] is False
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("delete from movement_types where id = 't9'"))
        alembic("upgrade", "head")
        await engine.dispose()


async def test_0010_seeds_rate_modes_and_roundtrips(
    test_url: str, alembic: Callable[..., None]
) -> None:
    engine = create_async_engine(test_url)
    try:
        async with engine.connect() as conn:
            modes = {
                r.id: (r.name, r.uses_rate_per_km, r.uses_cost_interval, r.sort_order)
                for r in await conn.execute(text("select * from rate_modes"))
            }
            fks = (
                (
                    await conn.execute(
                        text(
                            "select conname from pg_constraint where contype = 'f' "
                            "and condeferrable and condeferred"
                        )
                    )
                )
                .scalars()
                .all()
            )
        assert modes["direct"] == ("Valor por km", True, False, 1)
        assert modes["derived"] == ("Costo cada X km", False, True, 2)
        assert {
            "fk_categories_rate_mode_rate_modes",
            "fk_services_method_payment_methods",
            "fk_movements_method_payment_methods",
            "fk_movements_type_movement_types",
            "fk_movements_category_id_expense_categories",
            "fk_fund_movements_type_fund_movement_types",
        } <= set(fks)
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into rate_modes (id, name, deleted) values ('custom', 'Propio', false)"
                )
            )
            await conn.execute(
                text(
                    "insert into categories (id, name, rate_mode, deleted) "
                    "values ('c10', 'Seguro', 'custom', false)"
                )
            )
        alembic("downgrade", "0009")
        assert "rate_modes" not in await _tables(test_url)
        async with engine.connect() as conn:
            mode = (
                await conn.execute(text("select rate_mode from categories where id = 'c10'"))
            ).scalar_one()
            check = await conn.scalar(
                text("select count(*) from pg_constraint where conname = 'ck_categories_rate_mode'")
            )
        assert mode == "direct" and check == 1
        alembic("upgrade", "head")
        assert "rate_modes" in await _tables(test_url)
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("delete from categories where id = 'c10'"))
        alembic("upgrade", "head")
        async with engine.begin() as conn:
            await conn.execute(text("delete from rate_modes where id = 'custom'"))
        await engine.dispose()


async def test_0011_fund_category_fk_roundtrip(test_url: str, alembic: Callable[..., None]) -> None:
    query = text(
        "select count(*) from pg_constraint where conname = "
        "'fk_fund_movements_category_id_categories' and condeferrable and condeferred"
    )
    engine = create_async_engine(test_url)
    try:
        async with engine.connect() as conn:
            assert await conn.scalar(query) == 1
        alembic("downgrade", "0010")
        async with engine.connect() as conn:
            assert await conn.scalar(query) == 0
        alembic("upgrade", "head")
        async with engine.connect() as conn:
            assert await conn.scalar(query) == 1
    finally:
        alembic("upgrade", "head")
        await engine.dispose()
