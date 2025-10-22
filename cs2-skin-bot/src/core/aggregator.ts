import Bottleneck from 'bottleneck';
import { logger } from '../util/logger.js';
import { createLimiter } from '../util/rate.js';
import { MarketResult, Provider, SearchQuery } from './types.js';

const DEFAULT_TIMEOUT_MS = 9000;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error('timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const sortResults = (a: MarketResult, b: MarketResult): number => {
  const priceA = a.price ?? Number.POSITIVE_INFINITY;
  const priceB = b.price ?? Number.POSITIVE_INFINITY;
  if (priceA !== priceB) {
    return priceA - priceB;
  }
  const spreadA =
    a.price !== undefined && a.median30d !== undefined ? a.median30d - a.price : Number.NEGATIVE_INFINITY;
  const spreadB =
    b.price !== undefined && b.median30d !== undefined ? b.median30d - b.price : Number.NEGATIVE_INFINITY;
  if (spreadA !== spreadB) {
    return spreadB - spreadA;
  }
  return a.name.localeCompare(b.name);
};

const matchesQuery = (result: MarketResult, query: SearchQuery): boolean => {
  if (query.stattrak === true && result.stattrak === false) {
    return false;
  }
  if (query.stattrak === false && result.stattrak === true) {
    return false;
  }
  if (query.souvenir === true && result.souvenir === false) {
    return false;
  }
  if (query.souvenir === false && result.souvenir === true) {
    return false;
  }
  if (query.wear && result.wear && result.wear !== query.wear) {
    return false;
  }
  return true;
};

export class Aggregator {
  private readonly providerLimiters = new Map<string, Bottleneck>();

  constructor(
    private readonly providers: Provider[],
    private readonly globalLimiter: Bottleneck,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {}

  private getLimiter(provider: Provider): Bottleneck {
    const existing = this.providerLimiters.get(provider.name);
    if (existing) {
      return existing;
    }
    const limiter = createLimiter({ minTime: 300, maxConcurrent: 1 });
    this.providerLimiters.set(provider.name, limiter);
    return limiter;
  }

  async searchAll(query: SearchQuery): Promise<MarketResult[]> {
    const tasks = this.providers.map(async (provider) => {
      const providerLimiter = this.getLimiter(provider);
      try {
        const results = await withTimeout(
          this.globalLimiter.schedule(() => providerLimiter.schedule(() => provider.search(query))),
          this.timeoutMs
        );
        return results.filter((result) => matchesQuery(result, query));
      } catch (error) {
        const err = error as Error;
        if (err.message === 'timeout') {
          logger.warn(`Provider ${provider.name} timed out`);
        } else {
          logger.warn(`Provider ${provider.name} failed`, { error: err.message });
        }
        return [] as MarketResult[];
      }
    });

    const results = (await Promise.all(tasks)).flat();
    return results.sort(sortResults);
  }
}
