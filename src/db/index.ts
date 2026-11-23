import crypto from 'crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableName, SQL } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      connectionTimeoutMillis: 15000,
    });

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

type Row = Record<string, any>;
type RowContext = Map<string, Row>;

function isPgColumn(val: unknown): val is { name: string; table: any; dataType?: string; hasDefault?: boolean; default?: unknown } {
  return Boolean(
    val &&
      typeof val === 'object' &&
      'name' in val &&
      'table' in val &&
      typeof (val as any).name === 'string'
  );
}

function isSQL(val: unknown): val is SQL {
  return Boolean(val instanceof SQL || (val && typeof val === 'object' && 'queryChunks' in val));
}

function getColumnKeyMap(table: any): Map<string, string> {
  const map = new Map<string, string>();
  for (const [jsKey, col] of Object.entries(table)) {
    if (isPgColumn(col)) {
      map.set(col.name, jsKey);
    }
  }
  return map;
}

function resolveColValue(col: any, ctx: RowContext): any {
  const tName = getTableName(col.table);
  const row = ctx.get(tName);
  if (!row) return undefined;
  const keyMap = getColumnKeyMap(col.table);
  const jsKey = keyMap.get(col.name) ?? col.name;
  return row[jsKey];
}

function getChunkText(chunk: any): string {
  if (chunk && Array.isArray(chunk.value)) {
    return chunk.value.join('');
  }
  return '';
}

function resolveOperand(operand: any, ctx: RowContext): any {
  if (isPgColumn(operand)) {
    return resolveColValue(operand, ctx);
  }
  if (operand && typeof operand === 'object' && 'value' in operand && !Array.isArray(operand.value)) {
    return operand.value;
  }
  return operand;
}

function valuesEqual(a: any, b: any): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date && typeof b === 'string') return a.getTime() === new Date(b).getTime();
  if (typeof a === 'string' && b instanceof Date) return new Date(a).getTime() === b.getTime();
  return a === b;
}

function evaluateChunks(chunks: any[], ctx: RowContext): boolean {
  // Trim outer parentheses chunks from and()/or()
  let inner = chunks;
  if (
    inner.length >= 2 &&
    getChunkText(inner[0]).trim() === '(' &&
    getChunkText(inner[inner.length - 1]).trim() === ')'
  ) {
    inner = inner.slice(1, -1);
  }

  // Filter out empty string chunks
  const meaningful = inner.filter((c) => {
    if (c && Array.isArray(c.value)) {
      return c.value.join('').trim() !== '';
    }
    return true;
  });

  if (meaningful.length === 0) return true;
  if (meaningful.length === 1) {
    const only = meaningful[0];
    if (isSQL(only)) return evaluateChunks(only.queryChunks, ctx);
    const txt = getChunkText(only).trim().toLowerCase();
    if (txt === 'false') return false;
    if (txt === 'true') return true;
    return true;
  }

  // Check top-level ' and ' / ' or '
  const hasOr = meaningful.some((c) => getChunkText(c).trim().toLowerCase() === 'or');
  if (hasOr) {
    const groups: any[][] = [[]];
    for (const c of meaningful) {
      if (getChunkText(c).trim().toLowerCase() === 'or') {
        groups.push([]);
      } else {
        groups[groups.length - 1].push(c);
      }
    }
    return groups.some((g) => evaluateChunks(g, ctx));
  }

  const hasAnd = meaningful.some((c) => getChunkText(c).trim().toLowerCase() === 'and');
  if (hasAnd) {
    const groups: any[][] = [[]];
    for (const c of meaningful) {
      if (getChunkText(c).trim().toLowerCase() === 'and') {
        groups.push([]);
      } else {
        groups[groups.length - 1].push(c);
      }
    }
    return groups.every((g) => evaluateChunks(g, ctx));
  }

  // Binary comparison: [left, opChunk, right]
  if (meaningful.length === 3) {
    const [left, opChunk, right] = meaningful;
    const op = getChunkText(opChunk).trim().toLowerCase();
    const leftVal = resolveOperand(left, ctx);

    if (op === '=') {
      return valuesEqual(leftVal, resolveOperand(right, ctx));
    }
    if (op === '<>') {
      return !valuesEqual(leftVal, resolveOperand(right, ctx));
    }
    if (op === 'in') {
      const arr = Array.isArray(right)
        ? right.map((item) =>
            item && typeof item === 'object' && 'value' in item ? item.value : item
          )
        : Array.isArray(right?.value)
          ? right.value
          : [];
      return arr.some((v: any) => valuesEqual(leftVal, v));
    }
  }

  return true;
}

function evaluateWhere(cond: any, ctx: RowContext): boolean {
  if (!cond) return true;
  if (isSQL(cond)) {
    return evaluateChunks(cond.queryChunks, ctx);
  }
  return true;
}

function extractSqlMetadata(sqlObj: SQL): { text: string; columns: any[] } {
  let text = '';
  const columns: any[] = [];
  const walk = (chunks: any[]) => {
    for (const c of chunks) {
      if (isPgColumn(c)) {
        columns.push(c);
      } else if (isSQL(c)) {
        walk(c.queryChunks);
      } else if (c && Array.isArray(c.value)) {
        text += c.value.join('');
      }
    }
  };
  walk(sqlObj.queryChunks);
  return { text, columns };
}

function createInMemoryDrizzleMock(): ReturnType<typeof drizzle<typeof schema>> {
  const tables = new Map<string, Row[]>();

  const getRows = (table: any): Row[] => {
    const name = getTableName(table);
    let list = tables.get(name);
    if (!list) {
      list = [];
      tables.set(name, list);
    }
    return list;
  };

  const applyDefaults = (table: any, input: Row): Row => {
    const out: Row = { ...input };
    for (const [jsKey, col] of Object.entries(table)) {
      if (!isPgColumn(col)) continue;
      if (out[jsKey] === undefined) {
        if (col.default !== undefined && !isSQL(col.default)) {
          out[jsKey] = Array.isArray(col.default)
            ? [...col.default]
            : typeof col.default === 'object' && col.default !== null
              ? { ...(col.default as object) }
              : col.default;
        } else if (col.hasDefault && col.dataType === 'date') {
          out[jsKey] = new Date();
        } else if (col.hasDefault && jsKey === 'id') {
          out[jsKey] = crypto.randomUUID();
        } else {
          out[jsKey] = null;
        }
      }
    }
    return out;
  };

  const applyPatch = (table: any, row: Row, patch: Row) => {
    const keyMap = getColumnKeyMap(table);
    for (const [k, v] of Object.entries(patch)) {
      if (isSQL(v)) {
        const meta = extractSqlMetadata(v);
        if (meta.text.includes('+') && meta.columns[0]) {
          const jsKey = keyMap.get(meta.columns[0].name) ?? k;
          row[jsKey] = Number(row[jsKey] || 0) + 1;
        }
      } else if (v !== undefined) {
        row[k] = v;
      }
    }
  };

  const mockDb: any = {
    execute: async () => ({ rows: [{ '?column?': 1 }] }),

    select: (fields?: Record<string, any>) => {
      let primaryTable: any = null;
      const joins: Array<{ table: any; on: any }> = [];
      let whereCond: any = null;
      let groupCols: any[] = [];
      let orderExprs: any[] = [];
      let limitVal: number | null = null;

      const executeSelect = async () => {
        if (!primaryTable) return [];
        const baseName = getTableName(primaryTable);
        let contexts: RowContext[] = getRows(primaryTable).map((r) => new Map([[baseName, r]]));

        for (const j of joins) {
          const jName = getTableName(j.table);
          const jRows = getRows(j.table);
          const nextContexts: RowContext[] = [];
          for (const ctx of contexts) {
            for (const jr of jRows) {
              const combined = new Map(ctx);
              combined.set(jName, jr);
              if (evaluateWhere(j.on, combined)) {
                nextContexts.push(combined);
              }
            }
          }
          contexts = nextContexts;
        }

        if (whereCond) {
          contexts = contexts.filter((ctx) => evaluateWhere(whereCond, ctx));
        }

        if (orderExprs.length > 0) {
          contexts = [...contexts].sort((a, b) => {
            for (const expr of orderExprs) {
              let col = expr;
              let isDesc = false;
              if (isSQL(expr)) {
                const meta = extractSqlMetadata(expr);
                col = meta.columns[0];
                isDesc = meta.text.toLowerCase().includes('desc');
              }
              if (!isPgColumn(col)) continue;
              const va = resolveColValue(col, a);
              const vb = resolveColValue(col, b);
              let cmp = 0;
              if (va instanceof Date && vb instanceof Date) {
                cmp = va.getTime() - vb.getTime();
              } else if (typeof va === 'number' && typeof vb === 'number') {
                cmp = va - vb;
              } else {
                cmp = String(va ?? '').localeCompare(String(vb ?? ''));
              }
              if (cmp !== 0) return isDesc ? -cmp : cmp;
            }
            return 0;
          });
        }

        const hasAggregate =
          fields &&
          Object.values(fields).some((v) => {
            if (!isSQL(v)) return false;
            const upper = extractSqlMetadata(v).text.toUpperCase();
            return upper.includes('COUNT(') || upper.includes('SUM(');
          });

        const projectGroup = (group: RowContext[]): Row => {
          if (!fields) {
            return { ...(group[0]?.get(baseName) || {}) };
          }
          const out: Row = {};
          for (const [alias, spec] of Object.entries(fields)) {
            if (isPgColumn(spec)) {
              out[alias] = group[0] ? resolveColValue(spec, group[0]) : null;
            } else if (isSQL(spec)) {
              const meta = extractSqlMetadata(spec);
              const upper = meta.text.toUpperCase();
              if (upper.includes('COUNT(')) {
                out[alias] = String(group.length);
              } else if (upper.includes('SUM(') && meta.columns[0]) {
                const col = meta.columns[0];
                const total = group.reduce(
                  (sum, ctx) => sum + Number(resolveColValue(col, ctx) || 0),
                  0
                );
                out[alias] = String(total);
              } else {
                out[alias] = null;
              }
            } else if (spec && typeof spec === 'object') {
              try {
                const tName = getTableName(spec as any);
                out[alias] = group[0]?.get(tName) ? { ...group[0].get(tName) } : null;
              } catch {
                out[alias] = null;
              }
            }
          }
          return out;
        };

        let results: Row[] = [];
        if (groupCols.length > 0) {
          const grouped = new Map<string, RowContext[]>();
          for (const ctx of contexts) {
            const key = JSON.stringify(groupCols.map((c) => resolveColValue(c, ctx)));
            const arr = grouped.get(key) || [];
            arr.push(ctx);
            grouped.set(key, arr);
          }
          results = Array.from(grouped.values()).map(projectGroup);
        } else if (hasAggregate) {
          results = [projectGroup(contexts)];
        } else {
          results = contexts.map((ctx) => projectGroup([ctx]));
        }

        if (limitVal !== null) {
          results = results.slice(0, limitVal);
        }
        return results;
      };

      const builder: any = {
        from(table: any) {
          primaryTable = table;
          return builder;
        },
        innerJoin(table: any, on: any) {
          joins.push({ table, on });
          return builder;
        },
        where(cond: any) {
          whereCond = cond;
          return builder;
        },
        groupBy(...cols: any[]) {
          groupCols = cols;
          return builder;
        },
        orderBy(...exprs: any[]) {
          orderExprs = exprs;
          return builder;
        },
        limit(n: number) {
          limitVal = n;
          return builder;
        },
        then(onFulfilled: any, onRejected: any) {
          return executeSelect().then(onFulfilled, onRejected);
        },
      };
      return builder;
    },

    insert: (table: any) => {
      let valuesInput: Row[] = [];
      let conflictMode: 'none' | 'nothing' | 'update' = 'none';
      let conflictTarget: any[] = [];
      let conflictSet: Row | null = null;

      const executeInsert = async () => {
        const list = getRows(table);
        const keyMap = getColumnKeyMap(table);
        const targetKeys = conflictTarget.map((c) =>
          isPgColumn(c) ? keyMap.get(c.name) ?? c.name : String(c)
        );
        const affected: Row[] = [];

        for (const raw of valuesInput) {
          const candidate = applyDefaults(table, raw);
          const match =
            conflictMode !== 'none' && targetKeys.length > 0
              ? list.find((existing) =>
                  targetKeys.every((tk) => valuesEqual(existing[tk], candidate[tk]))
                )
              : undefined;

          if (match) {
            if (conflictMode === 'update' && conflictSet) {
              applyPatch(table, match, conflictSet);
              affected.push({ ...match });
            }
          } else {
            list.push(candidate);
            affected.push({ ...candidate });
          }
        }
        return affected;
      };

      const builder: any = {
        values(v: Row | Row[]) {
          valuesInput = Array.isArray(v) ? v : [v];
          return builder;
        },
        onConflictDoNothing(opts?: { target?: any }) {
          conflictMode = 'nothing';
          conflictTarget = opts?.target
            ? Array.isArray(opts.target)
              ? opts.target
              : [opts.target]
            : [];
          return builder;
        },
        onConflictDoUpdate(opts: { target: any; set: Row }) {
          conflictMode = 'update';
          conflictTarget = Array.isArray(opts.target) ? opts.target : [opts.target];
          conflictSet = opts.set;
          return builder;
        },
        returning() {
          return builder;
        },
        then(onFulfilled: any, onRejected: any) {
          return executeInsert().then(onFulfilled, onRejected);
        },
      };
      return builder;
    },

    update: (table: any) => {
      let patch: Row = {};
      let whereCond: any = null;
      const tName = getTableName(table);

      const executeUpdate = async () => {
        const list = getRows(table);
        const updated: Row[] = [];
        for (const row of list) {
          const ctx: RowContext = new Map([[tName, row]]);
          if (evaluateWhere(whereCond, ctx)) {
            applyPatch(table, row, patch);
            updated.push({ ...row });
          }
        }
        return updated;
      };

      const builder: any = {
        set(p: Row) {
          patch = p;
          return builder;
        },
        where(cond: any) {
          whereCond = cond;
          return builder;
        },
        returning() {
          return builder;
        },
        then(onFulfilled: any, onRejected: any) {
          return executeUpdate().then(onFulfilled, onRejected);
        },
      };
      return builder;
    },

    delete: (table: any) => {
      let whereCond: any = null;
      const tName = getTableName(table);

      const executeDelete = async () => {
        const list = getRows(table);
        const kept: Row[] = [];
        const removed: Row[] = [];
        for (const row of list) {
          const ctx: RowContext = new Map([[tName, row]]);
          if (evaluateWhere(whereCond, ctx)) {
            removed.push({ ...row });
          } else {
            kept.push(row);
          }
        }
        tables.set(tName, kept);
        return removed;
      };

      const builder: any = {
        where(cond: any) {
          whereCond = cond;
          return builder;
        },
        returning() {
          return builder;
        },
        then(onFulfilled: any, onRejected: any) {
          return executeDelete().then(onFulfilled, onRejected);
        },
      };
      return builder;
    },

    transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      return fn(mockDb);
    },

    query: new Proxy(
      {},
      {
        get: () => ({
          findMany: async () => [],
          findFirst: async () => null,
        }),
      }
    ),
  };

  return mockDb;
}

const hasSqlConfig = Boolean(process.env.SQL_HOST && process.env.SQL_DB_NAME);

let pool: Pool | undefined;
let db: ReturnType<typeof drizzle<typeof schema>>;

if (hasSqlConfig) {
  try {
    pool = createPool();
    db = drizzle(pool, { schema });
  } catch (err) {
    console.warn('[AI Studio] Database not connected — using in-memory mock:', err);
    db = createInMemoryDrizzleMock();
  }
} else {
  console.warn('[AI Studio] SQL_HOST not configured — using in-memory Drizzle mock');
  db = createInMemoryDrizzleMock();
}

export { db, pool };
