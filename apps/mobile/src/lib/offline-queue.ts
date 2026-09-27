/**
 * Durable outbox for work done without connectivity (staff inspections).
 * Pure logic over a tiny key-value store so it can be unit-tested; the app
 * backs it with AsyncStorage.
 *
 * Sync rules:
 * - operations run oldest-first; a network failure stops the run (order matters:
 *   photos need their inspection to exist) and the op stays queued;
 * - a VERSION CONFLICT (someone edited the record on the server) is never
 *   overwritten silently: the op is parked as `conflict` for the user to resolve
 *   (keep mine = retry against the new server version, or discard);
 * - any other server rejection parks the op as `failed` with its error code.
 */

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type OpState = "pending" | "conflict" | "failed";

export interface QueuedOp<P = unknown> {
  id: string;
  type: string;
  payload: P;
  /** Server version the edit was based on (null when creating). */
  baseVersion: number | null;
  createdAt: string;
  attempts: number;
  state: OpState;
  error?: string;
}

export type ExecResult = { ok: true; version?: number } | { ok: false; kind: "network" | "conflict" | "rejected"; error: string; serverVersion?: number };
export type Executor = (op: QueuedOp) => Promise<ExecResult>;

const KEY = "offline_queue_v1";

export class OfflineQueue {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: KeyValueStore, private readonly now: () => Date = () => new Date()) {}

  async list(): Promise<QueuedOp[]> {
    const raw = await this.store.getItem(KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as QueuedOp[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async save(ops: QueuedOp[]) {
    await this.store.setItem(KEY, JSON.stringify(ops));
  }

  /** Serialize all mutations so concurrent enqueue/sync calls never lose writes. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Add an op. An op with the same id replaces the queued one (latest local edit wins locally). */
  enqueue<P>(op: { id: string; type: string; payload: P; baseVersion: number | null }): Promise<QueuedOp<P>> {
    return this.exclusive(async () => {
      const ops = await this.list();
      const existing = ops.find((o) => o.id === op.id);
      const entry: QueuedOp<P> = {
        ...op,
        baseVersion: existing && existing.state === "pending" ? existing.baseVersion : op.baseVersion,
        createdAt: existing?.createdAt ?? this.now().toISOString(),
        attempts: 0,
        state: "pending",
      };
      await this.save(existing ? ops.map((o) => (o.id === op.id ? (entry as QueuedOp) : o)) : [...ops, entry as QueuedOp]);
      return entry;
    });
  }

  remove(id: string): Promise<void> {
    return this.exclusive(async () => this.save((await this.list()).filter((o) => o.id !== id)));
  }

  /** Resolve a conflict by re-basing the local edit on the server's current version. */
  keepMine(id: string, serverVersion: number): Promise<void> {
    return this.exclusive(async () => {
      const ops = await this.list();
      await this.save(ops.map((o) => (o.id === id ? { ...o, baseVersion: serverVersion, state: "pending" as const, error: undefined, attempts: 0 } : o)));
    });
  }

  /** Run pending ops in order. Returns counts; never throws. */
  sync(exec: Executor): Promise<{ done: number; conflicts: number; failed: number; remaining: number; offline: boolean }> {
    return this.exclusive(async () => {
      const ops = await this.list();
      let done = 0, conflicts = 0, failed = 0, offline = false;
      const keep: QueuedOp[] = [];
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i]!;
        if (offline || op.state !== "pending") { keep.push(op); continue; }
        let res: ExecResult;
        try {
          res = await exec(op);
        } catch (e) {
          res = { ok: false, kind: "network", error: e instanceof Error ? e.message : String(e) };
        }
        if (res.ok) { done++; continue; }
        const attempts = op.attempts + 1;
        if (res.kind === "network") { offline = true; keep.push({ ...op, attempts }); continue; }
        if (res.kind === "conflict") { conflicts++; keep.push({ ...op, attempts, state: "conflict", error: res.error, ...(res.serverVersion !== undefined ? { payload: { ...(op.payload as object), serverVersion: res.serverVersion } } : {}) }); continue; }
        failed++;
        keep.push({ ...op, attempts, state: "failed", error: res.error });
      }
      await this.save(keep);
      return { done, conflicts, failed, remaining: keep.length, offline };
    });
  }
}
