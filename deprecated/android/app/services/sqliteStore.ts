import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import { fromLegacy } from './legacy'
import { emptySnapshot, type Collection, type Meta, type Snapshot, type Store } from './types'

const MIGRATIONS = [
  // v1 y v2: esquema anterior (se conserva para poder migrar bases existentes).
  `CREATE TABLE category (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, rate_mode TEXT NOT NULL,
    rate_per_km REAL, total_cost REAL, interval_km REAL, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE day (date TEXT PRIMARY KEY, km REAL NOT NULL, note TEXT, gross REAL NOT NULL, total_cost REAL NOT NULL, net REAL NOT NULL);
  CREATE TABLE service (id INTEGER PRIMARY KEY AUTOINCREMENT, day_date TEXT NOT NULL, amount REAL NOT NULL, note TEXT);
  CREATE TABLE day_cost (day_date TEXT NOT NULL, category_id INTEGER NOT NULL, category_name TEXT NOT NULL, rate_applied REAL NOT NULL, amount REAL NOT NULL);`,
  `ALTER TABLE service ADD COLUMN method TEXT NOT NULL DEFAULT 'cash';
  CREATE TABLE cash_day (date TEXT PRIMARY KEY, opening REAL NOT NULL, opened_at TEXT NOT NULL, closed_at TEXT, counted REAL);
  CREATE TABLE cash_movement (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL, note TEXT);`,
  // v3: un registro por fila con id único, fecha de edición y lápida (sincronizable).
  `CREATE TABLE record (
    kind TEXT NOT NULL, id TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL,
    PRIMARY KEY (kind, id)
  );`,
]

const rows = async (db: SQLiteDBConnection, sql: string) => (await db.query(sql)).values ?? []

/** Lee el esquema v1/v2 con la forma del formato anterior para pasarlo por fromLegacy. */
async function readLegacy(db: SQLiteDBConnection) {
  const categories = (await rows(db, 'SELECT * FROM category ORDER BY id')).map(row => ({
    id: row.id, name: row.name, rateMode: row.rate_mode, ratePerKm: row.rate_per_km ?? undefined,
    totalCost: row.total_cost ?? undefined, intervalKm: row.interval_km ?? undefined, active: !!row.active,
  }))
  const services = await rows(db, 'SELECT * FROM service ORDER BY id')
  const costs = await rows(db, 'SELECT * FROM day_cost')
  const days: Record<string, any> = {}
  for (const day of await rows(db, 'SELECT * FROM day')) {
    days[day.date] = {
      date: day.date, km: day.km, note: day.note ?? undefined,
      services: services.filter(service => service.day_date === day.date).map(service => ({ amount: service.amount, method: service.method, note: service.note ?? undefined })),
      costs: costs.filter(cost => cost.day_date === day.date).map(cost => ({ categoryId: cost.category_id, name: cost.category_name, rate: cost.rate_applied, amount: cost.amount })),
    }
  }
  const movements = await rows(db, 'SELECT * FROM cash_movement ORDER BY id')
  const cash: Record<string, any> = {}
  for (const cashDay of await rows(db, 'SELECT * FROM cash_day')) {
    cash[cashDay.date] = {
      date: cashDay.date, opening: cashDay.opening, openedAt: cashDay.opened_at, closedAt: cashDay.closed_at ?? undefined, counted: cashDay.counted ?? undefined,
      movements: movements.filter(movement => movement.date === cashDay.date).map(movement => ({ type: movement.type, amount: movement.amount, note: movement.note ?? undefined })),
    }
  }
  return { categories, days, cash }
}

const KINDS: Collection[] = [
  'categories', 'days', 'services', 'cash', 'movements', 'depositMovements', 'fundMovements', 'shifts',
  'shiftTemplates', 'paymentMethods', 'movementTypes', 'fundMovementTypes', 'expenseCategories',
]

function statements(changes: Partial<Snapshot>) {
  const out: { statement: string; values: unknown[] }[] = []
  for (const kind of KINDS) {
    for (const record of (changes[kind] ?? []) as Meta[]) {
      out.push({
        statement: 'INSERT OR REPLACE INTO record (kind, id, updated_at, deleted, data) VALUES (?,?,?,?,?)',
        values: [kind, record.id, record.updatedAt, record.deleted ? 1 : 0, JSON.stringify(record)],
      })
    }
  }
  return out
}

async function migrate(db: SQLiteDBConnection) {
  // Sin PRAGMA aquí: dentro de la transacción de execute() aborta el CREATE y la tabla no se crea.
  await db.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);')
  const row = (await db.query("SELECT value FROM meta WHERE key = 'version'")).values?.[0]
  const current = row ? Number(row.value) : 0
  for (let version = current; version < MIGRATIONS.length; version++) {
    await db.execute(MIGRATIONS[version]!)
    if (version === 2 && current > 0) {
      // Había datos en el esquema anterior: pasarlos a registros con id único.
      const legacyStatements = statements(fromLegacy(await readLegacy(db)))
      if (legacyStatements.length) await db.executeSet(legacyStatements)
    }
    await db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)", [String(version + 1)])
  }
}

export async function createSqliteStore(): Promise<Store> {
  const conn = new SQLiteConnection(CapacitorSQLite)
  const db = await conn.createConnection('taurus', false, 'no-encryption', 1, false)
  await db.open()
  await migrate(db)

  return {
    async load() {
      const snapshot = emptySnapshot()
      for (const row of await rows(db, 'SELECT kind, data FROM record')) {
        const list = snapshot[row.kind as Collection] as Meta[] | undefined
        list?.push(JSON.parse(row.data))
      }
      return snapshot
    },
    async save(changes) {
      const changeStatements = statements(changes)
      if (changeStatements.length) await db.executeSet(changeStatements)
    },
  }
}
