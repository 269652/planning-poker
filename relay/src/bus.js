// @ts-check
/**
 * The relay's message bus: pub/sub channels plus a few short-lived keys. Vercel may put the host and
 * a guest on different function instances, so in production this must be shared (Redis); the
 * in-memory bus is for local development and tests.
 */
import Redis from "ioredis";

/** @typedef {(message: string) => void} Handler */

export class MemoryBus {
  kind = "memory";
  /** @type {Map<string, Set<Handler>>} */
  #subs = new Map();
  /** @type {Map<string, { v: string, exp: number }>} */
  #kv = new Map();

  /** @param {string} channel @param {string} message */
  async publish(channel, message) {
    for (const h of this.#subs.get(channel) ?? []) queueMicrotask(() => h(message));
  }

  /** @param {string} channel @param {Handler} handler @returns {Promise<() => Promise<void>>} */
  async subscribe(channel, handler) {
    let set = this.#subs.get(channel);
    if (!set) this.#subs.set(channel, (set = new Set()));
    set.add(handler);
    return async () => {
      set.delete(handler);
      if (set.size === 0) this.#subs.delete(channel);
    };
  }

  /** @param {string} key */
  async get(key) {
    const e = this.#kv.get(key);
    if (!e) return null;
    if (e.exp < Date.now()) { this.#kv.delete(key); return null; }
    return e.v;
  }

  /** @param {string} key @param {string} value @param {number} ttlSec */
  async set(key, value, ttlSec) { this.#kv.set(key, { v: value, exp: Date.now() + ttlSec * 1000 }); }

  /** @param {string} key @param {string} value @param {number} ttlSec */
  async setIfAbsent(key, value, ttlSec) {
    if ((await this.get(key)) !== null) return false;
    await this.set(key, value, ttlSec);
    return true;
  }

  /** @param {string} key */
  async del(key) { this.#kv.delete(key); }

  async close() {}
}

/** Redis (e.g. Upstash from the Vercel Marketplace): one connection publishes and stores keys, one subscribes. */
export class RedisBus {
  kind = "redis";
  /** @type {Map<string, Set<Handler>>} */
  #handlers = new Map();

  /** @param {string} url */
  constructor(url) {
    this.pub = new Redis(url, { maxRetriesPerRequest: 3 });
    this.sub = new Redis(url, { maxRetriesPerRequest: 3 });
    this.sub.on("message", (/** @type {string} */ channel, /** @type {string} */ message) => {
      for (const h of this.#handlers.get(channel) ?? []) h(message);
    });
  }

  /** @param {string} channel @param {string} message */
  async publish(channel, message) { await this.pub.publish(channel, message); }

  /** @param {string} channel @param {Handler} handler */
  async subscribe(channel, handler) {
    let set = this.#handlers.get(channel);
    if (!set) {
      this.#handlers.set(channel, (set = new Set()));
      await this.sub.subscribe(channel);
    }
    set.add(handler);
    return async () => {
      set.delete(handler);
      if (set.size === 0 && this.#handlers.get(channel) === set) {
        this.#handlers.delete(channel);
        await this.sub.unsubscribe(channel);
      }
    };
  }

  /** @param {string} key */
  async get(key) { return this.pub.get(key); }

  /** @param {string} key @param {string} value @param {number} ttlSec */
  async set(key, value, ttlSec) { await this.pub.set(key, value, "EX", ttlSec); }

  /** @param {string} key @param {string} value @param {number} ttlSec */
  async setIfAbsent(key, value, ttlSec) { return (await this.pub.set(key, value, "EX", ttlSec, "NX")) === "OK"; }

  /** @param {string} key */
  async del(key) { await this.pub.del(key); }

  async close() { this.pub.disconnect(); this.sub.disconnect(); }
}

/** Redis when configured (REDIS_URL, or KV_URL from the Upstash integration), otherwise in-memory. */
export function busFromEnv(/** @type {Record<string, string | undefined>} */ env) {
  const url = env.REDIS_URL || env.KV_URL;
  if (url) return new RedisBus(url);
  console.warn("[relay] No REDIS_URL/KV_URL — using an in-memory bus (only correct on a single instance).");
  return new MemoryBus();
}
