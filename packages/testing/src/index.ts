import pg from "pg";

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Run `pnpm test:db` which provisions a disposable database.");
  return url;
}

export function createPool(max = 20): pg.Pool {
  return new pg.Pool({ connectionString: testDatabaseUrl(), max });
}

export type Actor =
  | { kind: "anon" }
  | { kind: "user"; userId: string }
  | { kind: "service" };

/** Apply Supabase-equivalent request context (role + JWT claims) for the current transaction. */
export async function impersonate(client: Client, actor: Actor): Promise<void> {
  if (actor.kind === "anon") {
    await client.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    await client.query("set local role anon");
  } else if (actor.kind === "user") {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: actor.userId, role: "authenticated" }),
    ]);
    await client.query("set local role authenticated");
  } else {
    await client.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    await client.query("set local role service_role");
  }
}

/**
 * Wrap a client so every query runs inside its own savepoint. A failing
 * statement (e.g. an expected RLS denial) then doesn't abort the surrounding
 * test transaction. Queries must be awaited sequentially.
 */
function withSavepoints(client: Client): Client {
  const raw = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
  const wrapped = async (...args: unknown[]) => {
    await raw("savepoint q");
    try {
      const result = await raw(...args);
      await raw("release savepoint q");
      return result;
    } catch (e) {
      await raw("rollback to savepoint q");
      throw e;
    }
  };
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "query") return wrapped;
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Run `fn` as `actor` inside a transaction that is ALWAYS rolled back,
 * so tests never leak state into each other.
 */
export async function asActor<T>(pool: pg.Pool, actor: Actor, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await impersonate(client, actor);
    return await fn(withSavepoints(client));
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** Same as asActor but commits (used by concurrency tests that need visibility across connections). */
export async function asActorCommitted<T>(pool: pg.Pool, actor: Actor, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await impersonate(client, actor);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Resolve to the Postgres error message (or null if the promise succeeded). */
export async function errorOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export const DEMO = {
  platformAdmin: "00000000-0000-4000-8000-000000000001",
  owner: "00000000-0000-4000-8000-000000000002",
  employee: "00000000-0000-4000-8000-000000000003",
  customerUser: "00000000-0000-4000-8000-000000000004",
  tenant: "10000000-0000-4000-8000-000000000001",
  cityBranch: "20000000-0000-4000-8000-000000000001",
  airportBranch: "20000000-0000-4000-8000-000000000002",
  porsche911: "30000000-0000-4000-8000-000000000001",
  taycan: "30000000-0000-4000-8000-000000000002",
  bmwM4: "30000000-0000-4000-8000-000000000004",
  teslaS: "30000000-0000-4000-8000-000000000007",
  evClass: "40000000-0000-4000-8000-000000000001",
  customer: "50000000-0000-4000-8000-000000000001",
} as const;
