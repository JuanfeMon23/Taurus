from datetime import date, time
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.cash.models import CashDay, DepositMovement, Movement
from app.modules.categories.models import Category
from app.modules.days.models import Day
from app.modules.services.models import Service
from app.modules.settings.models import Setting

DEFAULT_DATE = date(2026, 11, 4)


def service(**overrides: Any) -> Service:
    return Service(
        **{"id": "s1", "date": DEFAULT_DATE, "amount": 10, "method": "cash", **overrides}
    )


def movement(**overrides: Any) -> Movement:
    return Movement(
        **{"id": "m1", "date": DEFAULT_DATE, "type": "expense", "amount": 5, **overrides}
    )


def category(**overrides: Any) -> Category:
    return Category(**{"id": "c1", "name": "Gas", "rate_mode": "direct", **overrides})


async def assert_rejected(session: AsyncSession, instance: Any, constraint: str) -> None:
    session.add(instance)
    with pytest.raises(IntegrityError, match=constraint):
        await session.flush()


async def test_service_defaults_and_nullable_trip_fields(session: AsyncSession) -> None:
    session.add(service())
    await session.flush()
    record = (await session.execute(select(Service))).scalar_one()
    assert record.deleted is False
    assert record.updated_at is not None
    assert record.start_time is None and record.distance_km is None and record.origin is None


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
    session.add(Day(id="2026-11-04", date=DEFAULT_DATE, km=10, costs=costs))
    await session.flush()
    session.expire_all()
    assert (await session.get(Day, "2026-11-04")).costs == costs


async def test_day_rejects_negative_km(session: AsyncSession) -> None:
    await assert_rejected(session, Day(id="d", date=DEFAULT_DATE, km=-1), "ck_days_km_non_negative")


async def test_cash_day_rejects_negative_opening(session: AsyncSession) -> None:
    await assert_rejected(
        session,
        CashDay(id="2026-11-04", date=DEFAULT_DATE, opening=-1, opened_at=text("now()")),
        "ck_cash_days_opening_non_negative",
    )


def cash_day(**overrides: Any) -> CashDay:
    return CashDay(
        **{
            "id": "2026-11-04",
            "date": DEFAULT_DATE,
            "opening": 0,
            "opened_at": text("now()"),
            **overrides,
        }
    )


async def test_cash_day_to_deposit_defaults_to_null(session: AsyncSession) -> None:
    session.add(cash_day())
    await session.flush()
    session.expire_all()
    assert (await session.execute(select(CashDay))).scalar_one().to_deposit is None


async def test_cash_day_accepts_to_deposit(session: AsyncSession) -> None:
    session.add(cash_day(to_deposit=12.5))
    await session.flush()
    session.expire_all()
    record = (await session.execute(select(CashDay))).scalar_one()
    assert record.to_deposit == Decimal("12.50")


async def test_cash_day_rejects_negative_to_deposit(session: AsyncSession) -> None:
    await assert_rejected(session, cash_day(to_deposit=-1), "ck_cash_days_to_deposit_non_negative")


async def test_deposit_movement_defaults_and_accepts_note_null(session: AsyncSession) -> None:
    session.add(DepositMovement(id="dm1", date=DEFAULT_DATE, amount=7))
    await session.flush()
    session.expire_all()
    record = (await session.execute(select(DepositMovement))).scalar_one()
    assert record.deleted is False and record.note is None and record.amount == Decimal("7.00")


async def test_deposit_movement_rejects_negative_amount(session: AsyncSession) -> None:
    await assert_rejected(
        session,
        DepositMovement(id="dm1", date=DEFAULT_DATE, amount=-1),
        "ck_deposit_movements_amount_non_negative",
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
            "where indexname in ('ix_services_date', 'ix_movements_date', "
            "'ix_deposit_movements_date')"
        )
    )
    assert len(rows.all()) == 3


async def test_service_commission_defaults(session: AsyncSession) -> None:
    session.add(service())
    await session.flush()
    session.expire_all()
    record = (await session.execute(select(Service))).scalar_one()
    assert record.is_indrive is True
    assert record.commission == 0 and record.commission_vat == 0


async def test_service_accepts_commission_and_own_trip(session: AsyncSession) -> None:
    session.add(service(is_indrive=False, commission=855, commission_vat=162.45))
    await session.flush()
    session.expire_all()
    record = (await session.execute(select(Service))).scalar_one()
    assert record.is_indrive is False
    assert record.commission_vat == Decimal("162.45")


async def test_service_rejects_negative_commission(session: AsyncSession) -> None:
    await assert_rejected(session, service(commission=-1), "ck_services_commission_non_negative")


async def test_service_rejects_negative_commission_vat(session: AsyncSession) -> None:
    await assert_rejected(
        session, service(commission_vat=-1), "ck_services_commission_vat_non_negative"
    )


async def test_settings_seeded_with_default_rates(session: AsyncSession) -> None:
    record = await session.get(Setting, "rates")
    assert record is not None and record.deleted is False
    assert record.commission_rate == Decimal("0.0950")
    assert record.vat_rate == Decimal("0.1900")


@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        ({"commission_rate": -0.1}, "ck_settings_commission_rate_range"),
        ({"commission_rate": 1.1}, "ck_settings_commission_rate_range"),
        ({"vat_rate": -0.1}, "ck_settings_vat_rate_range"),
        ({"vat_rate": 1.1}, "ck_settings_vat_rate_range"),
    ],
)
async def test_settings_reject_rates_out_of_range(
    session: AsyncSession, overrides: dict[str, float], constraint: str
) -> None:
    rates = {"commission_rate": 0.1, "vat_rate": 0.1, **overrides}
    await assert_rejected(session, Setting(id="other", **rates), constraint)
