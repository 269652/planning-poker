type Handler = (message: string) => void;

interface Bus {
  readonly kind: "memory" | "redis";
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: Handler): Promise<() => Promise<void>>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  setIfAbsent(key: string, value: string, ttlSec: number): Promise<boolean>;
  del(key: string): Promise<void>;
  close(): Promise<void>;
}

export class MemoryBus implements Bus {
  readonly kind: "memory";
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: Handler): Promise<() => Promise<void>>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  setIfAbsent(key: string, value: string, ttlSec: number): Promise<boolean>;
  del(key: string): Promise<void>;
  close(): Promise<void>;
}

export class RedisBus implements Bus {
  readonly kind: "redis";
  constructor(url: string);
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: Handler): Promise<() => Promise<void>>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  setIfAbsent(key: string, value: string, ttlSec: number): Promise<boolean>;
  del(key: string): Promise<void>;
  close(): Promise<void>;
}

export function busFromEnv(env: Record<string, string | undefined>): MemoryBus | RedisBus;
