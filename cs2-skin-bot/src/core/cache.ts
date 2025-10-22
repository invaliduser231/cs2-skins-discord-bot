type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class MemoryCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly defaultTtlSeconds = 120) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlSeconds?: number): void {
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttl * 1000
    });
  }

  async withTtl(key: string, ttlSeconds: number | undefined, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const value = await fetcher();
    this.set(key, value, ttlSeconds);
    return value;
  }
}
