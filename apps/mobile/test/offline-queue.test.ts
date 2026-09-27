import { describe, expect, it } from "vitest";
import { OfflineQueue, type ExecResult, type KeyValueStore, type QueuedOp } from "../src/lib/offline-queue";

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v); } };
}

describe("offline queue", () => {
  it("runs ops in order and removes the ones that succeed", async () => {
    const q = new OfflineQueue(memory());
    await q.enqueue({ id: "a", type: "inspection", payload: { n: 1 }, baseVersion: null });
    await q.enqueue({ id: "b", type: "photo", payload: { n: 2 }, baseVersion: null });
    const seen: string[] = [];
    const res = await q.sync(async (op) => { seen.push(op.id); return { ok: true }; });
    expect(seen).toEqual(["a", "b"]);
    expect(res).toMatchObject({ done: 2, remaining: 0, offline: false });
    expect(await q.list()).toEqual([]);
  });

  it("stops at the first network failure and keeps order for the retry", async () => {
    const q = new OfflineQueue(memory());
    for (const id of ["a", "b", "c"]) await q.enqueue({ id, type: "t", payload: {}, baseVersion: null });
    const seen: string[] = [];
    const res = await q.sync(async (op) => {
      seen.push(op.id);
      if (op.id === "b") throw new Error("Network request failed");
      return { ok: true };
    });
    expect(seen).toEqual(["a", "b"]);
    expect(res).toMatchObject({ done: 1, remaining: 2, offline: true });
    expect((await q.list()).map((o) => [o.id, o.state, o.attempts])).toEqual([["b", "pending", 1], ["c", "pending", 0]]);
  });

  it("parks version conflicts instead of overwriting, and can re-base on request", async () => {
    const q = new OfflineQueue(memory());
    await q.enqueue({ id: "insp", type: "inspection", payload: { odometer: 100 }, baseVersion: 1 });
    const conflict: ExecResult = { ok: false, kind: "conflict", error: "VERSION_CONFLICT", serverVersion: 3 };
    expect(await q.sync(async () => conflict)).toMatchObject({ conflicts: 1, remaining: 1 });
    const [parked] = await q.list();
    expect(parked).toMatchObject({ state: "conflict", error: "VERSION_CONFLICT" });
    expect((parked!.payload as { serverVersion: number }).serverVersion).toBe(3);

    // Conflicted ops are not retried automatically.
    let calls = 0;
    await q.sync(async () => { calls++; return { ok: true }; });
    expect(calls).toBe(0);

    await q.keepMine("insp", 3);
    let based: QueuedOp | null = null;
    await q.sync(async (op) => { based = op; return { ok: true }; });
    expect(based!.baseVersion).toBe(3);
    expect(await q.list()).toEqual([]);
  });

  it("marks server rejections as failed with the error code", async () => {
    const q = new OfflineQueue(memory());
    await q.enqueue({ id: "x", type: "inspection", payload: {}, baseVersion: null });
    const res = await q.sync(async () => ({ ok: false, kind: "rejected", error: "CUSTOMER_ACCEPTANCE_REQUIRED" }));
    expect(res.failed).toBe(1);
    expect((await q.list())[0]).toMatchObject({ state: "failed", error: "CUSTOMER_ACCEPTANCE_REQUIRED" });
  });

  it("re-enqueuing the same id replaces the payload but keeps the original base version", async () => {
    const q = new OfflineQueue(memory());
    await q.enqueue({ id: "i", type: "inspection", payload: { odometer: 1 }, baseVersion: 2 });
    await q.enqueue({ id: "i", type: "inspection", payload: { odometer: 5 }, baseVersion: 4 });
    const ops = await q.list();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ payload: { odometer: 5 }, baseVersion: 2 });
  });

  it("serializes concurrent calls without losing writes", async () => {
    const q = new OfflineQueue(memory());
    await Promise.all(Array.from({ length: 20 }, (_, i) => q.enqueue({ id: `op${i}`, type: "t", payload: {}, baseVersion: null })));
    expect(await q.list()).toHaveLength(20);
  });

  it("survives a corrupted store", async () => {
    const store = memory();
    store.data.set("offline_queue_v1", "{not json");
    expect(await new OfflineQueue(store).list()).toEqual([]);
  });
});
