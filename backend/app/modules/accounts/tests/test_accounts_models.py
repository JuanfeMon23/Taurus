from collections.abc import Callable
from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.modules.accounts.models import Account
from app.modules.cash.models import Movement
from app.modules.catalogs.models import MovementType, PaymentMethod

DEFAULT_DATE = date(2026, 11, 11)


def movement(**overrides: Any) -> Movement:
    return Movement(
        **{"id": "m1", "date": DEFAULT_DATE, "type": "expense", "amount": 5, **overrides}
    )


async def check_deferred_constraints(session: AsyncSession) -> None:
    await session.execute(text("set constraints all immediate"))


async def test_accounts_are_seeded_with_cash_box_only_in_caja(session: AsyncSession) -> None:
    rows = (await session.execute(select(Account).order_by(Account.sort_order))).scalars().all()
    assert [(row.id, row.name, row.is_cash_box) for row in rows] == [
        ("caja", "Caja", True),
        ("transferencias", "Transferencias", False),
        ("deposito", "Depósito", False),
    ]
    assert all(row.initial_balance == 0 and row.active and not row.deleted for row in rows)
    assert all(row.updated_at.year == 2000 for row in rows)


async def test_second_cash_box_account_is_rejected(session: AsyncSession) -> None:
    session.add(Account(id="otra", name="Otra", is_cash_box=True))
    with pytest.raises(IntegrityError, match="uq_accounts_is_cash_box"):
        await session.flush()


async def test_account_rejects_empty_name(session: AsyncSession) -> None:
    session.add(Account(id="vacia", name="  "))
    with pytest.raises(IntegrityError, match="ck_accounts_name_not_empty"):
        await session.flush()


async def test_payment_methods_point_to_their_account(session: AsyncSession) -> None:
    rows = (await session.execute(select(PaymentMethod))).scalars().all()
    assert {row.id: row.account_id for row in rows} == {
        "cash": "caja",
        "transfer": "transferencias",
    }


async def test_payment_method_affects_cash_must_match_cash_box_account(
    session: AsyncSession,
) -> None:
    session.add(
        PaymentMethod(id="tarjeta", name="Tarjeta", account_id="deposito", affects_cash=True)
    )
    await session.flush()
    with pytest.raises(IntegrityError, match="affects_cash"):
        await check_deferred_constraints(session)


async def test_payment_method_coherent_with_account_is_accepted(session: AsyncSession) -> None:
    session.add(
        PaymentMethod(id="billetera", name="Billetera", account_id="caja", affects_cash=True)
    )
    session.add(PaymentMethod(id="giro", name="Giro", account_id="deposito", affects_cash=False))
    await session.flush()
    await check_deferred_constraints(session)


async def test_changing_cash_box_flag_with_methods_pointing_to_it_is_rejected(
    session: AsyncSession,
) -> None:
    await session.execute(text("update accounts set is_cash_box = false where id = 'caja'"))
    with pytest.raises(IntegrityError, match="affects_cash"):
        await check_deferred_constraints(session)


async def test_movement_defaults_to_caja_account_without_destination(
    session: AsyncSession,
) -> None:
    session.add(movement())
    await session.flush()
    session.expire_all()
    record = (await session.execute(select(Movement))).scalar_one()
    assert record.account_id == "caja" and record.to_account_id is None


async def test_movement_unknown_account_rejected_at_commit(session: AsyncSession) -> None:
    session.add(movement(account_id="nope"))
    await session.flush()
    with pytest.raises(IntegrityError, match="fk_movements_account_id_accounts"):
        await check_deferred_constraints(session)


async def test_movement_rejects_same_origin_and_destination(session: AsyncSession) -> None:
    session.add(movement(type="traslado", account_id="caja", to_account_id="caja"))
    with pytest.raises(IntegrityError, match="ck_movements_distinct_accounts"):
        await session.flush()


async def test_traslado_type_is_seeded_and_requires_destination(session: AsyncSession) -> None:
    records = {row.id: row for row in (await session.execute(select(MovementType))).scalars().all()}
    assert records["traslado"].requires_destination is True and records["traslado"].sign == -1
    assert not any(row.requires_destination for code, row in records.items() if code != "traslado")


async def test_traslado_with_destination_is_accepted(session: AsyncSession) -> None:
    session.add(movement(type="traslado", account_id="caja", to_account_id="deposito"))
    await session.flush()
    await check_deferred_constraints(session)


async def test_traslado_without_destination_is_rejected(session: AsyncSession) -> None:
    session.add(movement(type="traslado"))
    await session.flush()
    with pytest.raises(IntegrityError, match="destination"):
        await check_deferred_constraints(session)


async def test_non_traslado_with_destination_is_rejected(session: AsyncSession) -> None:
    session.add(movement(type="expense", to_account_id="deposito"))
    await session.flush()
    with pytest.raises(IntegrityError, match="destination"):
        await check_deferred_constraints(session)


async def test_0014_backfills_accounts_and_migrates_deposit_withdrawals(
    test_url: str, alembic: Callable[..., None]
) -> None:
    engine = create_async_engine(test_url)
    alembic("downgrade", "0013")
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into movements (id, date, type, amount, method, deleted, updated_at) "
                    "values ('mc', '2026-11-01', 'expense', 5, 'cash', false, '2026-01-01'), "
                    "('mt', '2026-11-01', 'expense', 6, 'transfer', false, '2026-01-01')"
                )
            )
            await conn.execute(
                text(
                    "insert into deposit_movements (id, date, amount, note, deleted, updated_at) "
                    "values ('d1', '2026-11-02', 40, 'retiro', false, '2026-02-02'), "
                    "('d2', '2026-11-03', 10, null, true, '2026-02-03')"
                )
            )
        alembic("upgrade", "head")
        async with engine.connect() as conn:
            moved = {
                row.id: row
                for row in await conn.execute(
                    text(
                        "select id, account_id, to_account_id, type, amount, note, deleted, "
                        "date, updated_at from movements"
                    )
                )
            }
            deposit_count = (
                await conn.execute(text("select count(*) from deposit_movements"))
            ).scalar_one()
        assert moved["mc"].account_id == "caja" and moved["mt"].account_id == "transferencias"
        assert moved["d1"].account_id == "deposito" and moved["d1"].to_account_id is None
        assert moved["d1"].type == "withdrawal" and moved["d1"].amount == Decimal("40.00")
        assert moved["d1"].note == "retiro" and moved["d1"].date == date(2026, 11, 2)
        assert moved["d1"].updated_at.year == 2026 and moved["d1"].deleted is False
        assert moved["d2"].deleted is True and moved["d2"].note is None
        assert deposit_count == 2
    finally:
        alembic("upgrade", "head")
        async with engine.begin() as conn:
            await conn.execute(text("delete from movements where id in ('mc','mt','d1','d2')"))
            await conn.execute(text("delete from deposit_movements where id in ('d1','d2')"))
        await engine.dispose()
