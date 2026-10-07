import { existsSync, readFileSync } from 'node:fs'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from '@/server/db/schema'
import { EXPECTED_COLUMNS, EXPECTED_COLUMN_TOTAL } from '@/tests/fixtures/schema-names'

const tables = [
  schema.profiles, schema.invites, schema.folders, schema.folderMembers, schema.files,
  schema.shareLinks, schema.accessLogs, schema.auditLogs, schema.rateLimits,
].map((t) => getTableConfig(t))

const DOC = 'docs/05_スキーマDDL.md'
const MIGRATION = 'drizzle/0000_init.sql'
const hasDoc = existsSync(DOC)

function schemaNames(): { constraints: string[]; indexes: string[] } {
  const constraints: string[] = []
  const indexes: string[] = []
  for (const t of tables) {
    // Single-column primary keys are inline in Drizzle; PostgreSQL names them <table>_pkey.
    if (t.primaryKeys.length === 0 && t.columns.some((c) => c.primary)) constraints.push(`${t.name}_pkey`)
    for (const pk of t.primaryKeys) constraints.push(pk.getName())
    for (const u of t.uniqueConstraints) constraints.push(u.name ?? '')
    for (const f of t.foreignKeys) constraints.push(f.getName())
    for (const c of t.checks) constraints.push(c.name)
    for (const i of t.indexes) indexes.push(i.config.name ?? '')
  }
  return { constraints: constraints.sort(), indexes: indexes.sort() }
}

// SQL blocks of 05 sections 2.1 to 2.9, 3 and 4.1 in document order.
function docMigrationBlocks(): string[] {
  const lines = readFileSync(DOC, 'utf8').split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith('## 2. DDL'))
  const end = lines.findIndex((l) => l.startsWith('### 4.2 '))
  const blocks: string[] = []
  let cur: string[] | undefined
  for (const l of lines.slice(start, end)) {
    if (l.startsWith('```sql')) cur = []
    else if (l.startsWith('```') && cur) {
      blocks.push(cur.join('\n'))
      cur = undefined
    } else if (cur) cur.push(l)
  }
  return blocks
}

describe('schema.ts column lists match 05 section 8.1', () => {
  it('has exactly the 9 tables in schema app', () => {
    expect(tables.map((t) => t.name).sort()).toEqual(Object.keys(EXPECTED_COLUMNS).sort())
    expect(tables.every((t) => t.schema === 'app')).toBe(true)
  })

  it.each(tables.map((t) => [t.name, t] as const))('%s columns (names and order)', (name, t) => {
    expect(t.columns.map((c) => c.name)).toEqual(EXPECTED_COLUMNS[name])
  })

  it('has 103 columns in total', () => {
    expect(tables.reduce((n, t) => n + t.columns.length, 0)).toBe(EXPECTED_COLUMN_TOTAL)
  })
})

describe.skipIf(!hasDoc)('schema.ts constraint and index names match 05 section 2', () => {
  const sql = hasDoc ? docMigrationBlocks().join('\n') : ''
  const docConstraints = [...sql.matchAll(/CONSTRAINT\s+([a-z_]+)\s/g)].map((m) => m[1] ?? '').sort()
  const docIndexes = [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+([a-z_]+)\s/g)].map((m) => m[1] ?? '').sort()

  it('constraint names are identical (no missing, no extra)', () => {
    expect(schemaNames().constraints).toEqual(docConstraints)
  })

  it('explicit index names are identical (no missing, no extra)', () => {
    expect(schemaNames().indexes).toEqual(docIndexes)
  })
})

describe.skipIf(!hasDoc)('drizzle/0000_init.sql equals the concatenation of the 05 blocks', () => {
  it('has the same SQL blocks in the same order', () => {
    const expected = docMigrationBlocks().join('\n\n') + '\n'
    expect(readFileSync(MIGRATION, 'utf8').replace(/\r\n/g, '\n')).toBe(expected)
  })
})

describe('drizzle/0000_init.sql contains every schema name', () => {
  const migration = readFileSync(MIGRATION, 'utf8')
  const { constraints, indexes } = schemaNames()

  it.each(constraints)('constraint %s', (n) => {
    expect(migration).toContain(n)
  })

  it.each(indexes)('index %s', (n) => {
    expect(migration).toMatch(new RegExp(`INDEX ${n}\\s`))
  })
})
