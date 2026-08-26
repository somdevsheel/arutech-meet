import type { Env } from "@arutech/config";
import { PresenceService } from "./presence.service";

/** Minimal in-memory fake covering exactly the ioredis commands
 * PresenceService actually calls — no external ioredis-mock dependency, and
 * no attempt to simulate real TTL expiry (nothing here asserts on time
 * passing, only on the command sequence each method issues). */
function makeFakeRedis() {
  const sets = new Map<string, Set<string>>();
  const strings = new Map<string, string>();

  const client = {
    sadd: jest.fn(async (key: string, member: string) => {
      const set = sets.get(key) ?? new Set<string>();
      const had = set.has(member);
      set.add(member);
      sets.set(key, set);
      return had ? 0 : 1;
    }),
    srem: jest.fn(async (key: string, member: string) => {
      const set = sets.get(key);
      if (!set) return 0;
      const had = set.delete(member);
      return had ? 1 : 0;
    }),
    scard: jest.fn(async (key: string) => sets.get(key)?.size ?? 0),
    expire: jest.fn(async () => 1),
    exists: jest.fn(async (key: string) => (sets.has(key) || strings.has(key) ? 1 : 0)),
    del: jest.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (sets.delete(key)) count++;
        if (strings.delete(key)) count++;
      }
      return count;
    }),
    set: jest.fn(async (key: string, value: string) => {
      strings.set(key, value);
      return "OK";
    }),
    get: jest.fn(async (key: string) => strings.get(key) ?? null),
    pipeline: jest.fn(() => {
      const queued: (() => Promise<unknown>)[] = [];
      const p = {
        exists: (key: string) => {
          queued.push(() => client.exists(key));
          return p;
        },
        get: (key: string) => {
          queued.push(() => client.get(key));
          return p;
        },
        exec: async () => Promise.all(queued.map(async (fn) => [null, await fn()] as [null, unknown])),
      };
      return p;
    }),
  };
  return client;
}

function makeService() {
  const redis = makeFakeRedis();
  const env = { REDIS_PREFIX: "test" } as unknown as Env;
  const service = new PresenceService(redis as never, env);
  return { service, redis };
}

describe("PresenceService", () => {
  describe("connect / disconnect", () => {
    it("connect returns true (came online) for a user's first socket", async () => {
      const { service } = makeService();
      await expect(service.connect("u1", "socket-a")).resolves.toBe(true);
    });

    it("connect returns false for a second socket while already connected — multi-tab is a no-op transition", async () => {
      const { service } = makeService();
      await service.connect("u1", "socket-a");
      await expect(service.connect("u1", "socket-b")).resolves.toBe(false);
    });

    it("disconnect returns false while another socket is still connected", async () => {
      const { service } = makeService();
      await service.connect("u1", "socket-a");
      await service.connect("u1", "socket-b");
      await expect(service.disconnect("u1", "socket-a")).resolves.toBe(false);
      await expect(service.getStatus("u1")).resolves.toBe("ONLINE");
    });

    it("disconnect returns true (went offline) once the last socket disconnects, and getStatus reflects it", async () => {
      const { service } = makeService();
      await service.connect("u1", "socket-a");
      await expect(service.disconnect("u1", "socket-a")).resolves.toBe(true);
      await expect(service.getStatus("u1")).resolves.toBe("OFFLINE");
    });

    it("a full disconnect clears any explicit status — reconnecting later starts fresh at ONLINE", async () => {
      const { service } = makeService();
      await service.connect("u1", "socket-a");
      await service.setStatus("u1", "DND");
      await service.disconnect("u1", "socket-a");
      await service.connect("u1", "socket-b");
      await expect(service.getStatus("u1")).resolves.toBe("ONLINE");
    });
  });

  describe("setStatus", () => {
    it("is a no-op (returns false) for a user with no connected socket", async () => {
      const { service } = makeService();
      await expect(service.setStatus("u1", "AWAY")).resolves.toBe(false);
      await expect(service.getStatus("u1")).resolves.toBe("OFFLINE");
    });

    it("sets an explicit AWAY/BUSY/DND override while connected", async () => {
      const { service } = makeService();
      await service.connect("u1", "socket-a");
      await expect(service.setStatus("u1", "BUSY")).resolves.toBe(true);
      await expect(service.getStatus("u1")).resolves.toBe("BUSY");
    });

    it("setting ONLINE explicitly clears any override back to the default", async () => {
      const { service } = makeService();
      await service.connect("u1", "socket-a");
      await service.setStatus("u1", "DND");
      await service.setStatus("u1", "ONLINE");
      await expect(service.getStatus("u1")).resolves.toBe("ONLINE");
    });
  });

  describe("getStatuses (bulk)", () => {
    it("returns OFFLINE for unknown/never-connected users", async () => {
      const { service } = makeService();
      await expect(service.getStatuses(["ghost"])).resolves.toEqual({ ghost: "OFFLINE" });
    });

    it("returns the right mix of ONLINE/explicit-status/OFFLINE for several users in one batch", async () => {
      const { service } = makeService();
      await service.connect("online-user", "s1");
      await service.connect("dnd-user", "s2");
      await service.setStatus("dnd-user", "DND");
      const result = await service.getStatuses(["online-user", "dnd-user", "offline-user"]);
      expect(result).toEqual({ "online-user": "ONLINE", "dnd-user": "DND", "offline-user": "OFFLINE" });
    });

    it("returns an empty object without touching Redis for an empty id list", async () => {
      const { service, redis } = makeService();
      await expect(service.getStatuses([])).resolves.toEqual({});
      expect(redis.pipeline).not.toHaveBeenCalled();
    });
  });

  it("heartbeat is a no-op for a user with no connected socket recorded", async () => {
    const { service, redis } = makeService();
    await service.heartbeat("ghost");
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it("heartbeat refreshes TTL for a genuinely connected user", async () => {
    const { service, redis } = makeService();
    await service.connect("u1", "socket-a");
    (redis.expire as jest.Mock).mockClear();
    await service.heartbeat("u1");
    expect(redis.expire).toHaveBeenCalled();
  });
});
