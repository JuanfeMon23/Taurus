from datetime import date, time
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.cash.models import CashDay, Movement
from app.modules.categories.models import Category
from app.modules.days.models import Day
from app.modules.services.models import Service

D = date(2026, 11, 4)


def service(**kw: Any) -> Service:
    return Service(**{"id": "s1", "date": D, "amount": 10, "method": "cash", **kw})


def movement(**kw: Any) -> Movement:
    return Movement(**{"id": "m1", "date": D, "type": "expense", "amount": 5, **kw})


def category(**kw: Any) -> Category:
    return Category(**{"id": "c1", "name": "Gas", "rate_mode": "direct", **kw})


async def assert_rejected(session: AsyncSession, obj: Any, constraint: str) -> None:
    session.add(obj)
    with pytest.raises(IntegrityError, match=constraint):
        await session.flush()


async def test_service_defaults_and_nullable_trip_fields(session: AsyncSession) -> None:
    session.add(service())
    await session.flush()
    row = (await session.execute(select(Service))).scalar_one()
    assert row.deleted is False
    assert row.updated_at is not None
    assert row.start_time is None and row.distance_km is None and row.origin is None


async def test_service_accepts_trip_fields(session: AsyncSession) -> None:
    session.add(
        service(
            start_time=time(8, 0),
            end_time=time(8, 25),
            distance_km=4.5,
            origin="A",
            destination="B",
        )
    )
    await session.flush()


async def test_service_rejects_invalid_method(session: AsyncSession) -> None:
    await assert_rejected(session, service(method="card"), "ck_services_method")


async def test_service_rejects_negative_amount(session: AsyncSession) -> None:
    await assert_rejected(session, service(amount=-1), "ck_services_amount_non_negative")


async def test_service_rejects_negative_distance(session: AsyncSession) -> None:
    await assert_rejected(
        session, service(distance_km=-0.1), "ck_services_distance_km_non_negative"
    )


async def test_service_bonus_defaults_to_zero(session: AsyncSession) -> None:
    session.add(service())
    await session.flush()
    session.expire_all()
    assert (await session.execute(select(Service))).scalar_one().bonus == 0


async def test_service_accepts_bonus(session: AsyncSession) -> None:
    session.add(service(bonus=2.5))
    await session.flush()
    session.expire_all()
    assert (await session.execute(select(Service))).scalar_one().bonus == Decimal("2.50")


async def test_service_rejects_negative_bonus(session: AsyncSession) -> None:
    await assert_rejected(session, service(bonus=-1), "ck_services_bonus_non_negative")


async def test_movement_rejects_invalid_type(session: AsyncSession) -> None:
    await assert_rejected(session, movement(type="gift"), "ck_movements_type")


@pytest.mark.parametrize("type_", ["expense", "withdrawal", "deposit"])
async def test_movement_accepts_valid_types(session: AsyncSession, type_: str) -> None:
    session.add(movement(type=type_))
    await session.flush()


async def test_movement_rejects_negative_amount(session: AsyncSession) -> None:
    await assert_rejected(session, movement(amount=-5), "ck_movements_amount_non_negative")


async def test_category_rejects_invalid_rate_mode(session: AsyncSession) -> None:
    await assert_rejected(session, category(rate_mode="x"), "ck_categories_rate_mode")


async def test_category_rejects_zero_interval(session: AsyncSession) -> None:
    await assert_rejected(session, category(interval_km=0), "ck_categories_interval_km_positive")


async def test_day_costs_snapshot_roundtrip(session: AsyncSession) -> None:
    costs = [{"categoryId": "c1", "name": "Gas", "rate": 0.5, "amount": 5}]
    session.add(Day(id="2026-11-04", date=D, km=10, costs=costs))
    await session.flush()
    session.expire_all()
    assert (await session.get(Day, "2026-11-04")).costs == costs


async def test_day_rejects_negative_km(session: AsyncSession) -> None:
    await assert_rejected(session, Day(id="d", date=D, km=-1), "ck_days_km_non_negative")


async def test_cash_day_rejects_negative_opening(session: AsyncSession) -> None:
    await assert_rejected(
        session,
        CashDay(id="2026-11-04", date=D, opening=-1, opened_at=text("now()")),
        "ck_cash_days_opening_non_negative",
    )


async def test_duplicate_id_rejected(session: AsyncSession) -> None:
    session.add(service())
    await session.flush()
    session.expunge_all()
    await assert_rejected(session, service(), "pk_services")


async def test_date_indexes_exist(session: AsyncSession) -> None:
    rows = await session.execute(
        text(
            "select indexname from pg_indexes "
            "where indexname in ('ix_services_date', 'ix_movements_date')"
        )
    )
    assert len(rows.all()) == 2
