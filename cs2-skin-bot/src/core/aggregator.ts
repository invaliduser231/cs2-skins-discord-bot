import Bottleneck from 'bottleneck';
import { logger } from '../util/logger.js';
import { createLimiter } from '../util/rate.js';
import { MarketResult, Provider, SearchQuery, SortStrategy } from './types.js';

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

const computeDiscount = (result: MarketResult): number | undefined => {
  if (result.price === undefined || result.median30d === undefined || result.median30d === 0) {
    return undefined;
  }
  return ((result.median30d - result.price) / result.median30d) * 100;
};

const sortResults = (a: MarketResult, b: MarketResult, strategy: SortStrategy = 'price'): number => {
  if (strategy === 'discount') {
    const discountA = computeDiscount(a) ?? Number.NEGATIVE_INFINITY;
    const discountB = computeDiscount(b) ?? Number.NEGATIVE_INFINITY;
    if (discountA !== discountB) {
      return discountB - discountA;
    }
  }

  if (strategy === 'market') {
    const marketDiff = a.market.localeCompare(b.market);
    if (marketDiff !== 0) {
      return marketDiff;
    }
  }

  if (strategy === 'name') {
    const nameDiff = a.name.localeCompare(b.name);
    if (nameDiff !== 0) {
      return nameDiff;
    }
  }

  const priceA = a.price ?? Number.POSITIVE_INFINITY;
  const priceB = b.price ?? Number.POSITIVE_INFINITY;
  if (priceA !== priceB) {
    return priceA - priceB;
  }

  const discountA = computeDiscount(a) ?? Number.NEGATIVE_INFINITY;
  const discountB = computeDiscount(b) ?? Number.NEGATIVE_INFINITY;
  if (discountA !== discountB) {
    return discountB - discountA;
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
  if (query.priceMin !== undefined) {
    if (result.price === undefined || result.price < query.priceMin) {
      return false;
    }
  }
  if (query.priceMax !== undefined) {
    if (result.price === undefined || result.price > query.priceMax) {
      return false;
    }
  }
  return true;
};

export type ProviderExecution = {
  provider: string;
  results: MarketResult[];
  durationMs: number;
  timedOut: boolean;
  error?: string;
};

export type AggregatedSearchResult = {
  results: MarketResult[];
  executions: ProviderExecution[];
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

  private resolveProviders(requested?: string[]): Provider[] {
    if (!requested || requested.length === 0) {
      return this.providers;
    }

    const normalized = new Set(requested.map((name) => name.toLowerCase()));
    const selected = this.providers.filter((provider) => normalized.has(provider.name.toLowerCase()));

    if (selected.length === 0) {
      logger.warn('Keine passenden Provider für Anfrage gefunden, verwende alle verfügbaren Provider.', {
        requested
      });
      return this.providers;
    }

    return selected;
  }

  async searchAll(query: SearchQuery): Promise<AggregatedSearchResult> {
    const providers = this.resolveProviders(query.providers);

    const tasks = providers.map(async (provider) => {
      const providerLimiter = this.getLimiter(provider);
      const start = Date.now();
      let timedOut = false;
      let errorMessage: string | undefined;

      try {
        const results = await withTimeout(
          this.globalLimiter.schedule(() => providerLimiter.schedule(() => provider.search(query))),
          this.timeoutMs
        );
        const filtered = results.filter((result) => matchesQuery(result, query));
        const durationMs = Date.now() - start;
        return {
          provider: provider.name,
          results: filtered,
          durationMs,
          timedOut
        } satisfies ProviderExecution;
      } catch (error) {
        const err = error as Error;
        timedOut = err.message === 'timeout';
        errorMessage = timedOut ? 'Zeitüberschreitung' : err.message;
        if (timedOut) {
          logger.warn(`Provider ${provider.name} timed out`);
        } else {
          logger.warn(`Provider ${provider.name} failed`, { error: err.message });
        }
        const durationMs = Date.now() - start;
        return {
          provider: provider.name,
          results: [],
          durationMs,
          timedOut,
          error: errorMessage
        } satisfies ProviderExecution;
      }
    });

    const executions = await Promise.all(tasks);
    const combinedResults = executions.flatMap((execution) => execution.results);
    const sortedResults = combinedResults.sort((a, b) => sortResults(a, b, query.sortBy));

    return {
      results: sortedResults,
      executions
    };
  }
}
