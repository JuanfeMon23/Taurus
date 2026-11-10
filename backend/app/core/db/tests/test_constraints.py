from datetime import date, time
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.modules.cash.models import CashDay, DepositMovement, FundMovement, Movement
from app.modules.catalogs.models import (
    ExpenseCategory,
    FundMovementType,
    MovementType,
    PaymentMethod,
    RateMode,
)
from app.modules.categories.models import Category
from app.modules.days.models import Day
from app.modules.services.models import Service
from app.modules.settings.models import Setting
from app.modules.shifts.models import Shift, ShiftTemplate

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


async def test_service_unknown_method_passes_flush_until_commit(session: AsyncSession) -> None:
    session.add(service(method="card"))
    await session.flush()


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


async def test_movement_unknown_type_passes_flush_until_commit(session: AsyncSession) -> None:
    session.add(movement(type="gift"))
    await session.flush()


@pytest.mark.parametrize("type_", ["expense", "withdrawal", "deposit"])
async def test_movement_accepts_valid_types(session: AsyncSession, type_: str) -> None:
    session.add(movement(type=type_))
    await session.flush()


async def test_movement_rejects_negative_amount(session: AsyncSession) -> None:
    await assert_rejected(session, movement(amount=-5), "ck_movements_amount_non_negative")


async def test_category_unknown_rate_mode_rejected_when_checked(
    session: AsyncSession,
) -> None:
    session.add(category(rate_mode="x"))
    await session.flush()
    with pytest.raises(IntegrityError, match="fk_categories_rate_mode_rate_modes"):
        await session.execute(text("set constraints all immediate"))


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
            "'ix_deposit_movements_date', 'ix_fund_movements_date', "
            "'ix_fund_movements_category_id')"
        )
    )
    assert len(rows.all()) == 5


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


def fund(**overrides: Any) -> FundMovement:
    return FundMovement(
        **{
            "id": "f1",
            "date": DEFAULT_DATE,
            "category_id": "c1",
            "type": "transfer",
            "amount": 10,
            **overrides,
        }
    )


async def test_movement_defaults_to_cash_without_category(session: AsyncSession) -> None:
    session.add(movement())
    await session.flush()
    session.expire_all()
    record = (await session.execute(select(Movement))).scalar_one()
    assert record.method == "cash" and record.category_id is None


async def test_movement_accepts_category_and_transfer(session: AsyncSession) -> None:
    session.add(movement(category_id="comida", method="transfer"))
    await session.flush()
    session.expire_all()
    record = (await session.execute(select(Movement))).scalar_one()
    assert record.category_id == "comida" and record.method == "transfer"


async def test_movement_unknown_method_passes_flush_until_commit(session: AsyncSession) -> None:
    session.add(movement(method="card"))
    await session.flush()


async def test_fund_movement_defaults_and_roundtrip(session: AsyncSession) -> None:
    session.add(fund())
    await session.flush()
    session.expire_all()
    record = (await session.execute(select(FundMovement))).scalar_one()
    assert record.deleted is False and record.note is None
    assert record.amount == Decimal("10.00") and record.category_id == "c1"


@pytest.mark.parametrize("type_", ["transfer", "spend"])
async def test_fund_movement_accepts_valid_types(session: AsyncSession, type_: str) -> None:
    session.add(fund(type=type_))
    await session.flush()


async def test_fund_movement_unknown_type_passes_flush_until_commit(
    session: AsyncSession,
) -> None:
    session.add(fund(type="gift"))
    await session.flush()


async def test_fund_movement_rejects_negative_amount(session: AsyncSession) -> None:
    await assert_rejected(session, fund(amount=-1), "ck_fund_movements_amount_non_negative")


@pytest.mark.parametrize("bad", ["7:30", "24:00", "07:60", "0730", "07:30:00", ""])
async def test_shift_rejects_bad_start_time_format(session: AsyncSession, bad: str) -> None:
    await assert_rejected(
        session,
        Shift(id="sh1", date=DEFAULT_DATE, start_time=bad),
        "ck_shifts_start_time_format",
    )


async def test_shift_rejects_bad_end_time_format(session: AsyncSession) -> None:
    await assert_rejected(
        session,
        Shift(id="sh1", date=DEFAULT_DATE, start_time="04:30", end_time="25:00"),
        "ck_shifts_end_time_format",
    )


async def test_shift_allows_open_and_midnight_crossing(session: AsyncSession) -> None:
    session.add_all(
        [
            Shift(id="sh1", date=DEFAULT_DATE, start_time="14:30"),
            Shift(id="sh2", date=DEFAULT_DATE, start_time="22:00", end_time="02:15"),
            Shift(id="sh3", date=DEFAULT_DATE, start_time="04:30", end_time="07:30", note="a"),
        ]
    )
    await session.flush()
    rows = (await session.execute(select(Shift).order_by(Shift.id))).scalars().all()
    assert [r.end_time for r in rows] == [None, "02:15", "07:30"]
    assert all(r.deleted is False and r.updated_at is not None for r in rows)


@pytest.mark.parametrize("name", ["", "   "])
async def test_shift_template_rejects_empty_name(session: AsyncSession, name: str) -> None:
    await assert_rejected(
        session,
        ShiftTemplate(id="t1", name=name, start_time="04:30", end_time="07:30"),
        "ck_shift_templates_name_not_empty",
    )


@pytest.mark.parametrize("bad", ["7:30", "24:00", "07:60", ""])
async def test_shift_template_rejects_bad_times(session: AsyncSession, bad: str) -> None:
    await assert_rejected(
        session,
        ShiftTemplate(id="t1", name="A", start_time=bad, end_time="07:30"),
        "ck_shift_templates_start_time_format",
    )
    await session.rollback()
    await assert_rejected(
        session,
        ShiftTemplate(id="t2", name="A", start_time="04:30", end_time=bad),
        "ck_shift_templates_end_time_format",
    )


async def test_shift_template_defaults_and_midnight_crossing(session: AsyncSession) -> None:
    session.add(ShiftTemplate(id="t1", name="Noche", start_time="22:00", end_time="02:15"))
    session.add(Shift(id="sh1", date=DEFAULT_DATE, start_time="22:00", template_id="t1"))
    await session.flush()
    row = (await session.execute(select(ShiftTemplate))).scalar_one()
    assert row.sort_order == 0 and row.active is True and row.deleted is False
    shift = (await session.execute(select(Shift))).scalar_one()
    assert shift.template_id == "t1"


async def test_catalog_seeds_present_with_old_timestamp(session: AsyncSession) -> None:
    rows = await session.execute(
        text(
            "select 'payment_methods', id, name, sort_order, affects_cash::text "
            "from payment_methods "
            "union all select 'movement_types', id, name, sort_order, sign::text "
            "from movement_types "
            "union all select 'fund_movement_types', id, name, sort_order, sign::text "
            "from fund_movement_types "
            "union all select 'expense_categories', id, name, sort_order, '' "
            "from expense_categories where id in ('comida', 'parqueadero', 'varios')"
        )
    )
    got = {(r[0], r[1]): (r[2], r[3], r[4]) for r in rows}
    assert got[("payment_methods", "cash")] == ("Efectivo", 1, "true")
    assert got[("payment_methods", "transfer")] == ("Transferencia", 2, "false")
    assert got[("movement_types", "expense")] == ("Gasto", 1, "-1")
    assert got[("movement_types", "withdrawal")] == ("Retiro", 2, "-1")
    assert got[("movement_types", "deposit")] == ("Aporte", 3, "1")
    assert got[("fund_movement_types", "transfer")] == ("Env\u00edo", 1, "1")
    assert got[("fund_movement_types", "spend")] == ("Gasto del fondo", 2, "-1")
    assert {k[1] for k in got if k[0] == "expense_categories"} == {
        "comida",
        "parqueadero",
        "varios",
    }
    recent = await session.scalar(
        text(
            "select count(*) from payment_methods where id in ('cash', 'transfer') "
            "and updated_at <> '2000-01-01T00:00:00+00:00'"
        )
    )
    assert recent == 0


@pytest.mark.parametrize("model", [MovementType, FundMovementType])
@pytest.mark.parametrize("sign", [0, 2, -2])
async def test_type_catalog_rejects_invalid_sign(
    session: AsyncSession, model: Any, sign: int
) -> None:
    constraint = f"ck_{model.__tablename__}_sign"
    await assert_rejected(session, model(id="x", name="X", sign=sign), constraint)


@pytest.mark.parametrize(
    ("model", "extra"),
    [
        (PaymentMethod, {"affects_cash": True}),
        (MovementType, {"sign": 1}),
        (FundMovementType, {"sign": 1}),
        (ExpenseCategory, {}),
    ],
)
@pytest.mark.parametrize("name", ["", "   "])
async def test_catalog_rejects_empty_name(
    session: AsyncSession, model: Any, extra: dict[str, Any], name: str
) -> None:
    constraint = f"ck_{model.__tablename__}_name_not_empty"
    await assert_rejected(session, model(id="x", name=name, **extra), constraint)


async def test_catalog_defaults(session: AsyncSession) -> None:
    session.add(ExpenseCategory(id="nueva", name="Nueva"))
    await session.flush()
    session.expire_all()
    record = await session.get(ExpenseCategory, "nueva")
    assert record is not None
    assert record.sort_order == 0 and record.active is True and record.deleted is False


async def test_rate_modes_seeded_with_behavior_flags(session: AsyncSession) -> None:
    direct = await session.get(RateMode, "direct")
    derived = await session.get(RateMode, "derived")
    assert direct is not None and derived is not None
    assert (direct.name, direct.uses_rate_per_km, direct.uses_cost_interval) == (
        "Valor por km",
        True,
        False,
    )
    assert (derived.name, derived.uses_rate_per_km, derived.uses_cost_interval) == (
        "Costo cada X km",
        False,
        True,
    )
    assert direct.updated_at.year == 2000 and derived.deleted is False


async def test_rate_mode_defaults_and_empty_name(session: AsyncSession) -> None:
    session.add(RateMode(id="mine", name="Mía"))
    await session.flush()
    session.expire_all()
    record = await session.get(RateMode, "mine")
    assert record is not None
    assert record.uses_rate_per_km is False and record.uses_cost_interval is False
    assert record.active is True and record.sort_order == 0
    await assert_rejected(session, RateMode(id="x", name="  "), "ck_rate_modes_name_not_empty")


ORPHAN_INSERTS = [
    ("services", "insert into services (id, date, amount, method) values ('{k}', now(), 1, 'zz')"),
    (
        "movements",
        "insert into movements (id, date, type, amount, method) "
        "values ('{k}', now(), 'expense', 1, 'zz')",
    ),
    ("movements", "insert into movements (id, date, type, amount) values ('{k}', now(), 'zz', 1)"),
    (
        "movements",
        "insert into movements (id, date, type, amount, category_id) "
        "values ('{k}', now(), 'expense', 1, 'zz')",
    ),
    (
        "fund_movements",
        "insert into fund_movements (id, date, category_id, type, amount) "
        "values ('{k}', now(), 'c1', 'zz', 1)",
    ),
    (
        "fund_movements",
        "insert into fund_movements (id, date, category_id, type, amount) "
        "values ('{k}', now(), 'zz', 'spend', 1)",
    ),
    ("categories", "insert into categories (id, name, rate_mode) values ('{k}', 'N', 'zz')"),
]


@pytest.mark.parametrize(("table", "sql"), ORPHAN_INSERTS)
async def test_unknown_catalog_code_fails_at_commit(test_url: str, table: str, sql: str) -> None:
    engine = create_async_engine(test_url)
    key = f"fk-test-{table}"
    try:
        with pytest.raises(IntegrityError, match="fk_"):
            async with engine.begin() as conn:
                await conn.execute(text(sql.format(k=key)))
        async with engine.connect() as conn:
            assert await conn.scalar(text(f"select count(*) from {table} where id = '{key}'")) == 0
    finally:
        await engine.dispose()


async def test_child_before_catalog_in_same_transaction_commits(test_url: str) -> None:
    engine = create_async_engine(test_url)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into services (id, date, amount, method) "
                    "values ('fk-early', now(), 1, 'card')"
                )
            )
            await conn.execute(
                text(
                    "insert into payment_methods (id, name, affects_cash, deleted) "
                    "values ('card', 'Tarjeta', false, false)"
                )
            )
        async with engine.connect() as conn:
            method = await conn.scalar(text("select method from services where id = 'fk-early'"))
        assert method == "card"
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("delete from services where id = 'fk-early'"))
            await conn.execute(text("delete from payment_methods where id = 'card'"))
        await engine.dispose()


async def test_tombstoned_catalog_row_keeps_references_valid(test_url: str) -> None:
    engine = create_async_engine(test_url)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into payment_methods (id, name, affects_cash, deleted) "
                    "values ('old', 'Vieja', false, false)"
                )
            )
            await conn.execute(
                text(
                    "insert into services (id, date, amount, method) "
                    "values ('fk-tomb', now(), 1, 'old')"
                )
            )
        async with engine.begin() as conn:
            await conn.execute(text("update payment_methods set deleted = true where id = 'old'"))
        async with engine.connect() as conn:
            assert await conn.scalar(text("select count(*) from services where id='fk-tomb'")) == 1
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("delete from services where id = 'fk-tomb'"))
            await conn.execute(text("delete from payment_methods where id = 'old'"))
        await engine.dispose()
