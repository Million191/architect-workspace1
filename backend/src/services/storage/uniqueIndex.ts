/**
 * Unique indexes and check constraints for the app's key → record stores (JsonFileMap on disk, Map
 * in tests). There is no SQL database, so this is where "UNIQUE" lives: every `set` is checked
 * before it is written, and a violating write throws instead of saving a duplicate.
 *
 * - A unique index derives a key from each record (e.g. a normalized email); two different ids with
 *   the same key are rejected. A record whose key is undefined is not indexed (like a partial index).
 * - A check inspects one record on its own (e.g. "no repeated action items inside this meeting").
 *
 * Records already on disk are not re-checked at load (the cleanup script reports and merges those);
 * `violations` lists them. Checks run per write over the whole store — fine at this app's sizes.
 */

export class UniqueConstraintError extends Error {
  readonly errorClass = 'UniqueConstraintError';
  constructor(readonly constraint: string, readonly key: string, readonly existingId?: string) {
    super(existingId ? `That would duplicate an existing record (${constraint}).` : `That record breaks a rule (${constraint}).`);
  }
}

export interface UniqueIndex<V> {
  name: string;
  keyOf: (value: V, id: string) => string | undefined;
}

export interface CheckConstraint<V> {
  name: string;
  /** A description of the problem, or undefined when the record is fine. */
  problem: (value: V, id: string) => string | undefined;
}

export interface Constraints<V> {
  unique?: UniqueIndex<V>[];
  checks?: CheckConstraint<V>[];
}

/** The first rule `value` would break if saved under `id`, or undefined. */
export function findViolation<V>(store: Map<string, V>, id: string, value: V, rules: Constraints<V>): UniqueConstraintError | undefined {
  for (const check of rules.checks ?? []) {
    const problem = check.problem(value, id);
    if (problem) return new UniqueConstraintError(check.name, problem);
  }
  for (const index of rules.unique ?? []) {
    const key = index.keyOf(value, id);
    if (key === undefined) continue;
    for (const [otherId, other] of store) {
      if (otherId !== id && index.keyOf(other, otherId) === key) return new UniqueConstraintError(index.name, key, otherId);
    }
  }
  return undefined;
}

/**
 * Wraps the store's `set` so every write is checked first. Returns the same store (it keeps working
 * as a Map / JsonFileMap everywhere it is passed). Idempotent: wrapping twice does not double-check.
 */
export function withConstraints<V>(store: Map<string, V>, rules: Constraints<V>): Map<string, V> {
  const marked = store as Map<string, V> & { __constraints?: Constraints<V>[] };
  if (marked.__constraints) {
    marked.__constraints.push(rules);
    return store;
  }
  const all: Constraints<V>[] = [rules];
  const set = store.set.bind(store);
  Object.defineProperty(marked, '__constraints', { value: all, enumerable: false });
  marked.set = (id: string, value: V) => {
    for (const r of all) {
      const violation = findViolation(store, id, value, r);
      if (violation) {
        console.error(JSON.stringify({ event: 'unique_constraint_rejected', constraint: violation.constraint, outcome: 'failure', error_class: violation.errorClass }));
        throw violation;
      }
    }
    return set(id, value);
  };
  return store;
}

/** Every existing record that breaks a rule — for the cleanup script and the startup check. */
export function violations<V>(store: Map<string, V>, rules: Constraints<V>): Array<{ constraint: string; key: string; ids: string[] }> {
  const out: Array<{ constraint: string; key: string; ids: string[] }> = [];
  for (const check of rules.checks ?? []) {
    for (const [id, value] of store) {
      const problem = check.problem(value, id);
      if (problem) out.push({ constraint: check.name, key: problem, ids: [id] });
    }
  }
  for (const index of rules.unique ?? []) {
    const groups = new Map<string, string[]>();
    for (const [id, value] of store) {
      const key = index.keyOf(value, id);
      if (key !== undefined) groups.set(key, [...(groups.get(key) ?? []), id]);
    }
    for (const [key, ids] of groups) if (ids.length > 1) out.push({ constraint: index.name, key, ids });
  }
  return out;
}
