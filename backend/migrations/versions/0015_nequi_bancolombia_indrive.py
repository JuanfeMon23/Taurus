"""split Transferencias into Nequi and Bancolombia; Saldo inDrive account that pays the commission

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-12 09:00:00.000000

- `transferencias` conserva su id (el historial no se reescribe) y pasa a llamarse «Nequi»; el
  medio `transfer` también («Nequi»).
- Cuentas nuevas `bancolombia` y `indrive` («Saldo inDrive»); medio nuevo `bancolombia` -> cuenta
  `bancolombia` (no afecta caja).
- `accounts.commission_since date null`: la cuenta que lo lleva descuenta (en el frontend) la
  comisión + IVA de los viajes inDrive con fecha >= ese valor. A lo sumo una cuenta lo lleva
  (índice único parcial) y no puede ser la caja (CHECK).
- Triggers: un medio de pago no puede apuntar a la cuenta de comisión (diferido, como 0014) y una
  cuenta con movimientos no se puede desactivar ni marcar borrada.
"""

from collections.abc import Sequence
from datetime import date, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | Sequence[str] | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEED_AT = datetime.fromisoformat("2000-01-01T00:00:00+00:00")
COMMISSION_SINCE = date(2026, 11, 12)

NEW_ACCOUNTS = [
    {"id": "bancolombia", "name": "Bancolombia", "order": 4, "since": None},
    {"id": "indrive", "name": "Saldo inDrive", "order": 5, "since": COMMISSION_SINCE},
]

TRIGGER_FUNCTIONS = """
create function check_payment_method_not_commission_account() returns trigger language plpgsql
as $$
begin
    if exists (select 1 from accounts
               where id = new.account_id and commission_since is not null) then
        raise exception 'payment_methods.account_id cannot be the commission account (method %)',
            new.id using errcode = 'check_violation';
    end if;
    return null;
end $$;

create function check_account_not_commission_target() returns trigger language plpgsql as $$
begin
    if new.commission_since is not null
       and exists (select 1 from payment_methods where account_id = new.id) then
        raise exception 'payment methods cannot point to the commission account (account %)',
            new.id using errcode = 'check_violation';
    end if;
    return null;
end $$;

create function check_account_deactivation() returns trigger language plpgsql as $$
begin
    if (new.deleted or not new.active)
       and exists (select 1 from movements
                   where not deleted and (account_id = new.id or to_account_id = new.id)) then
        raise exception 'account % has movements and cannot be deactivated or deleted', new.id
            using errcode = 'check_violation';
    end if;
    return new;
end $$;
"""

FUNCTION_NAMES = (
    "check_payment_method_not_commission_account(), check_account_not_commission_target(), "
    "check_account_deactivation()"
)


def upgrade() -> None:
    op.add_column("accounts", sa.Column("commission_since", sa.Date(), nullable=True))
    op.create_check_constraint(
        op.f("ck_accounts_commission_not_cash_box"),
        "accounts",
        "commission_since IS NULL OR NOT is_cash_box",
    )
    op.create_index(
        "uq_accounts_commission_since",
        "accounts",
        [sa.text("(commission_since IS NOT NULL)")],
        unique=True,
        postgresql_where=sa.text("commission_since IS NOT NULL"),
    )

    # Renombres: updated_at = now() para que los clientes reciban el nombre nuevo (LWW).
    op.execute("update accounts set name = 'Nequi', updated_at = now() where id = 'transferencias'")
    op.execute(
        "update payment_methods set name = 'Nequi', updated_at = now() where id = 'transfer'"
    )
    for row in NEW_ACCOUNTS:
        op.execute(
            sa.text(
                "insert into accounts (id, name, is_cash_box, sort_order, commission_since, "
                "active, deleted, updated_at) "
                "values (:id, :name, false, :order, :since, true, false, :at)"
            ).bindparams(at=SEED_AT, **row)
        )
    op.execute(
        sa.text(
            "insert into payment_methods (id, name, affects_cash, account_id, sort_order, active, "
            "deleted, updated_at) values "
            "('bancolombia', 'Bancolombia', false, 'bancolombia', 3, true, false, :at)"
        ).bindparams(at=SEED_AT)
    )

    for function_sql in TRIGGER_FUNCTIONS.split("end $$;"):  # asyncpg: una sentencia por execute
        if function_sql.strip():
            op.execute(function_sql + "end $$;")
    op.execute(
        "create constraint trigger trg_payment_methods_not_commission_account "
        "after insert or update on payment_methods deferrable initially deferred "
        "for each row execute function check_payment_method_not_commission_account()"
    )
    op.execute(
        "create constraint trigger trg_accounts_not_commission_target "
        "after update of commission_since on accounts deferrable initially deferred "
        "for each row execute function check_account_not_commission_target()"
    )
    op.execute(
        "create trigger trg_accounts_deactivation before update of active, deleted on accounts "
        "for each row execute function check_account_deactivation()"
    )


def downgrade() -> None:
    op.execute("drop trigger trg_accounts_deactivation on accounts")
    op.execute("drop trigger trg_accounts_not_commission_target on accounts")
    op.execute("drop trigger trg_payment_methods_not_commission_account on payment_methods")
    op.execute(f"drop function {FUNCTION_NAMES}")

    # Lo que no cabe en el modelo anterior: Bancolombia se funde en Transferencias y los
    # traslados que dejan de tener sentido (hacia/desde inDrive o entre las dos) se descartan.
    op.execute("delete from movements where account_id = 'indrive' or to_account_id = 'indrive'")
    op.execute(
        "delete from movements where account_id in ('transferencias', 'bancolombia') "
        "and to_account_id in ('transferencias', 'bancolombia')"
    )
    op.execute(
        "update movements set account_id = 'transferencias', updated_at = now() "
        "where account_id = 'bancolombia'"
    )
    op.execute(
        "update movements set to_account_id = 'transferencias', updated_at = now() "
        "where to_account_id = 'bancolombia'"
    )
    op.execute("update movements set method = 'transfer' where method = 'bancolombia'")
    op.execute("update services set method = 'transfer' where method = 'bancolombia'")
    # Las FK diferidas dejan eventos pendientes; que se resuelvan antes de borrar.
    op.execute("set constraints all immediate")
    op.execute("delete from payment_methods where id = 'bancolombia'")
    op.execute("delete from accounts where id in ('bancolombia', 'indrive')")
    op.execute(
        "update payment_methods set name = 'Transferencia', updated_at = now() "
        "where id = 'transfer'"
    )
    op.execute(
        "update accounts set name = 'Transferencias', updated_at = now() "
        "where id = 'transferencias'"
    )

    op.drop_index("uq_accounts_commission_since", table_name="accounts")
    op.drop_constraint(op.f("ck_accounts_commission_not_cash_box"), "accounts", type_="check")
    op.drop_column("accounts", "commission_since")
