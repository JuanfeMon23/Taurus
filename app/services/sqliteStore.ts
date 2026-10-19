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
  const categories = (await rows(db, 'SELECT * FROM category ORDER BY id')).map(r => ({
    id: r.id, name: r.name, rateMode: r.rate_mode, ratePerKm: r.rate_per_km ?? undefined,
    totalCost: r.total_cost ?? undefined, intervalKm: r.interval_km ?? undefined, active: !!r.active,
  }))
  const services = await rows(db, 'SELECT * FROM service ORDER BY id')
  const costs = await rows(db, 'SELECT * FROM day_cost')
  const days: Record<string, any> = {}
  for (const d of await rows(db, 'SELECT * FROM day')) {
    days[d.date] = {
      date: d.date, km: d.km, note: d.note ?? undefined,
      services: services.filter(s => s.day_date === d.date).map(s => ({ amount: s.amount, method: s.method, note: s.note ?? undefined })),
      costs: costs.filter(c => c.day_date === d.date).map(c => ({ categoryId: c.category_id, name: c.category_name, rate: c.rate_applied, amount: c.amount })),
    }
  }
  const movements = await rows(db, 'SELECT * FROM cash_movement ORDER BY id')
  const cash: Record<string, any> = {}
  for (const c of await rows(db, 'SELECT * FROM cash_day')) {
    cash[c.date] = {
      date: c.date, opening: c.opening, openedAt: c.opened_at, closedAt: c.closed_at ?? undefined, counted: c.counted ?? undefined,
      movements: movements.filter(m => m.date === c.date).map(m => ({ type: m.type, amount: m.amount, note: m.note ?? undefined })),
    }
  }
  return { categories, days, cash }
}

const KINDS: Collection[] = ['categories', 'days', 'services', 'cash', 'movements']

function statements(changes: Partial<Snapshot>) {
  const out: { statement: string; values: unknown[] }[] = []
  for (const kind of KINDS) {
    for (const r of (changes[kind] ?? []) as Meta[]) {
      out.push({
        statement: 'INSERT OR REPLACE INTO record (kind, id, updated_at, deleted, data) VALUES (?,?,?,?,?)',
        values: [kind, r.id, r.updatedAt, r.deleted ? 1 : 0, JSON.stringify(r)],
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
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.execute(MIGRATIONS[v]!)
    if (v === 2 && current > 0) {
      // Había datos en el esquema anterior: pasarlos a registros con id único.
      const set = statements(fromLegacy(await readLegacy(db)))
      if (set.length) await db.executeSet(set)
    }
    await db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)", [String(v + 1)])
  }
}

export async function createSqliteStore(): Promise<Store> {
  const conn = new SQLiteConnection(CapacitorSQLite)
  const db = await conn.createConnection('taurus', false, 'no-encryption', 1, false)
  await db.open()
  await migrate(db)

  return {
    async load() {
      const s = emptySnapshot()
      for (const r of await rows(db, 'SELECT kind, data FROM record')) {
        const list = s[r.kind as Collection] as Meta[] | undefined
        list?.push(JSON.parse(r.data))
      }
      return s
    },
    async save(changes) {
      const set = statements(changes)
      if (set.length) await db.executeSet(set)
    },
  }
}
