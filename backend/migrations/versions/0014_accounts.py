"""accounts catalog; movements and payment methods point to an account; transfers between accounts

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-11 10:00:00.000000

- `accounts` (Caja, Transferencias, Depósito) con saldo inicial; una sola `is_cash_box`.
- `payment_methods.account_id` (backfill: cash -> caja, transfer -> transferencias, el resto por
  `affects_cash`); `affects_cash` se conserva y un trigger diferido vigila que sea true <=> la
  cuenta es la caja.
- `movements.account_id` (backfill por el medio; sin medio o huérfano -> caja) y
  `movements.to_account_id` (traslados); `method` queda nullable y sin uso nuevo.
- Tipo `traslado` (sign -1 sobre la cuenta de origen, `requires_destination`).
- `deposit_movements` se copia a `movements` (cuenta `deposito`, tipo `withdrawal`); la tabla
  queda sin escrituras nuevas y no se borra.
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Fecha antigua fija: cualquier edición del usuario gana por LWW.
SEED_AT = datetime.fromisoformat("2000-01-01T00:00:00+00:00")

ACCOUNTS = [
    {"id": "caja", "name": "Caja", "cash_box": True, "order": 1},
    {"id": "transferencias", "name": "Transferencias", "cash_box": False, "order": 2},
    {"id": "deposito", "name": "Depósito", "cash_box": False, "order": 3},
]

# (tabla, columna): FK diferida al catálogo de cuentas
ACCOUNT_FKS = [
    ("payment_methods", "account_id"),
    ("movements", "account_id"),
    ("movements", "to_account_id"),
]

TRIGGER_FUNCTIONS = """
create function check_payment_method_cash_coherence() returns trigger language plpgsql as $$
declare box boolean;
begin
    select is_cash_box into box from accounts where id = new.account_id;
    if found and box is distinct from new.affects_cash then
        raise exception 'payment_methods.affects_cash must match accounts.is_cash_box (method %)',
            new.id using errcode = 'check_violation';
    end if;
    return null;
end $$;

create function check_account_cash_coherence() returns trigger language plpgsql as $$
begin
    if exists (select 1 from payment_methods
               where account_id = new.id and affects_cash is distinct from new.is_cash_box) then
        raise exception 'payment_methods.affects_cash must match accounts.is_cash_box (account %)',
            new.id using errcode = 'check_violation';
    end if;
    return null;
end $$;

create function check_movement_destination() returns trigger language plpgsql as $$
declare required boolean;
begin
    select requires_destination into required from movement_types where id = new.type;
    if found and required is distinct from (new.to_account_id is not null) then
        raise exception 'movements.to_account_id (destination) is required for transfers and '
            'forbidden otherwise (movement %)', new.id using errcode = 'check_violation';
    end if;
    return null;
end $$;

create function check_movement_type_destination() returns trigger language plpgsql as $$
begin
    if exists (select 1 from movements
               where type = new.id and (to_account_id is not null) <> new.requires_destination) then
        raise exception 'movements.to_account_id (destination) conflicts with movement type %',
            new.id using errcode = 'check_violation';
    end if;
    return null;
end $$;
"""

TRIGGERS = [
    ("trg_payment_methods_cash_coherence", "payment_methods", "insert or update",
     "check_payment_method_cash_coherence"),
    ("trg_accounts_cash_coherence", "accounts", "update of is_cash_box",
     "check_account_cash_coherence"),
    ("trg_movements_destination", "movements", "insert or update", "check_movement_destination"),
    ("trg_movement_types_destination", "movement_types", "update of requires_destination",
     "check_movement_type_destination"),
]  # fmt: skip


def _create_accounts_table() -> None:
    op.create_table(
        "accounts",
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "initial_balance", sa.Numeric(12, 2), server_default=sa.text("0"), nullable=False
        ),
        sa.Column("is_cash_box", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint("length(trim(name)) > 0", name=op.f("ck_accounts_name_not_empty")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_accounts")),
    )
    op.create_index(
        "uq_accounts_is_cash_box",
        "accounts",
        ["is_cash_box"],
        unique=True,
        postgresql_where=sa.text("is_cash_box"),
    )
    for row in ACCOUNTS:
        op.execute(
            sa.text(
                "insert into accounts (id, name, is_cash_box, sort_order, active, deleted, "
                "updated_at) values (:id, :name, :cash_box, :order, true, false, :at)"
            ).bindparams(at=SEED_AT, **row)
        )


def upgrade() -> None:
    _create_accounts_table()

    # Medios de pago -> cuenta (affects_cash se alinea con la cuenta asignada).
    op.add_column("payment_methods", sa.Column("account_id", sa.Text(), nullable=True))
    op.execute(
        """
        update payment_methods set account_id = case
            when id = 'cash' then 'caja'
            when id = 'transfer' then 'transferencias'
            when affects_cash then 'caja'
            else 'transferencias' end
        """
    )
    # Semillas intactas conservan su fecha antigua; las editadas o creadas por el usuario se
    # tocan para que los clientes reciban la cuenta.
    op.execute(
        sa.text(
            "update payment_methods set affects_cash = (account_id = 'caja'), "
            "updated_at = case when updated_at = :at then updated_at else now() end"
        ).bindparams(at=SEED_AT)
    )
    op.alter_column("payment_methods", "account_id", nullable=False)

    # Tipo de traslado.
    op.add_column(
        "movement_types",
        sa.Column(
            "requires_destination", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
    )
    op.execute(
        sa.text(
            "insert into movement_types (id, name, sign, has_category, requires_destination, "
            "sort_order, active, deleted, updated_at) values "
            "('traslado', 'Traslado', -1, false, true, 4, true, false, :at)"
        ).bindparams(at=SEED_AT)
    )

    # Movimientos -> cuenta de origen (por el medio) y destino opcional.
    op.add_column("movements", sa.Column("account_id", sa.Text(), nullable=True))
    op.add_column("movements", sa.Column("to_account_id", sa.Text(), nullable=True))
    op.execute(
        """
        update movements set updated_at = now(), account_id = coalesce(
            (select pm.account_id from payment_methods pm where pm.id = movements.method), 'caja')
        """
    )
    op.alter_column("movements", "account_id", nullable=False, server_default=sa.text("'caja'"))
    op.alter_column("movements", "method", existing_type=sa.Text(), nullable=True)
    op.create_check_constraint(
        op.f("ck_movements_distinct_accounts"),
        "movements",
        "to_account_id IS NULL OR to_account_id <> account_id",
    )

    # Salidas del depósito -> movements de la cuenta 'deposito'.
    op.execute(
        """
        insert into movements (id, date, type, amount, note, method, account_id, deleted,
                               updated_at)
        select id, date, 'withdrawal', amount, note, null, 'deposito', deleted, updated_at
        from deposit_movements
        """
    )
    # Las FK diferidas dejan eventos pendientes que impiden el DDL siguiente.
    op.execute("set constraints all immediate")

    for table, column in ACCOUNT_FKS:
        op.create_index(op.f(f"ix_{table}_{column}"), table, [column])
        op.create_foreign_key(
            op.f(f"fk_{table}_{column}_accounts"),
            table,
            "accounts",
            [column],
            ["id"],
            deferrable=True,
            initially="DEFERRED",
        )

    for function_sql in TRIGGER_FUNCTIONS.split("end $$;"):  # asyncpg: una sentencia por execute
        if function_sql.strip():
            op.execute(function_sql + "end $$;")
    for name, table, events, function in TRIGGERS:
        op.execute(
            f"create constraint trigger {name} after {events} on {table} "
            f"deferrable initially deferred for each row execute function {function}()"
        )


def downgrade() -> None:
    for name, table, _events, _function in TRIGGERS:
        op.execute(f"drop trigger {name} on {table}")
    op.execute(
        "drop function check_payment_method_cash_coherence(), check_account_cash_coherence(), "
        "check_movement_destination(), check_movement_type_destination()"
    )
    for table, column in reversed(ACCOUNT_FKS):
        op.drop_constraint(op.f(f"fk_{table}_{column}_accounts"), table, type_="foreignkey")
        op.drop_index(op.f(f"ix_{table}_{column}"), table_name=table)

    # Las salidas del depósito vuelven a su tabla (upsert: conserva ediciones hechas desde 0014).
    op.execute(
        """
        insert into deposit_movements (id, date, amount, note, deleted, updated_at)
        select m.id, m.date, m.amount, m.note, m.deleted, m.updated_at
        from movements m join movement_types t on t.id = m.type
        where m.account_id = 'deposito' and m.to_account_id is null and t.sign = -1
        on conflict (id) do update set date = excluded.date, amount = excluded.amount,
            note = excluded.note, deleted = excluded.deleted, updated_at = excluded.updated_at
        """
    )
    # Sin cuentas, lo que no cabe en el modelo anterior (otros movimientos del depósito y los
    # traslados) se descarta; el resto recupera su medio de pago.
    op.execute("delete from movements where account_id = 'deposito' or type = 'traslado'")
    op.execute(
        """
        update movements set method = coalesce(
            (select pm.id from payment_methods pm where pm.account_id = movements.account_id
             order by pm.sort_order limit 1), 'cash')
        where method is null
        """
    )
    # Las FK diferidas dejan eventos pendientes que impiden el ALTER TABLE siguiente.
    op.execute("set constraints all immediate")
    op.drop_constraint(op.f("ck_movements_distinct_accounts"), "movements", type_="check")
    op.alter_column("movements", "method", existing_type=sa.Text(), nullable=False)
    op.drop_column("movements", "to_account_id")
    op.drop_column("movements", "account_id")

    op.execute("delete from movement_types where id = 'traslado'")
    op.drop_column("movement_types", "requires_destination")
    op.drop_column("payment_methods", "account_id")
    op.drop_index("uq_accounts_is_cash_box", table_name="accounts")
    op.drop_table("accounts")
