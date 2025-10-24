import axios from 'axios';
import { MemoryCache } from '../core/cache.js';
import { normalizeText, WEARS } from '../core/normalize.js';
import { MarketResult, Provider, SearchQuery, Wear } from '../core/types.js';
import { logger } from '../util/logger.js';

const DMARKET_URL = 'https://api.dmarket.com/exchange/v1/market/items';
const parsedTtl = Number.parseInt(process.env.CACHE_TTL_SECONDS ?? '', 10);
const CACHE_TTL_SECONDS = Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 120;
const DEFAULT_LIMIT = 20;

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

const cache = new MemoryCache<MarketResult[]>(CACHE_TTL_SECONDS);

type DMarketItem = {
  id?: string;
  title?: string;
  image?: string;
  icon?: string;
  extra?: Record<string, unknown>;
  price?: unknown;
};

type DMarketResponse = {
  objects?: DMarketItem[];
};

const extractWear = (name: string): Wear | undefined => {
  const match = name.match(/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)/i);
  if (!match) {
    return undefined;
  }
  const normalized = match[1].toLowerCase();
  return WEARS.find((wear) => wear.toLowerCase() === normalized);
};

const determineFlag = (name: string, keyword: string): boolean => new RegExp(keyword, 'i').test(name);

const parsePriceAmount = (amount: string | number | undefined): number | undefined => {
  if (amount === undefined) {
    return undefined;
  }
  const raw = typeof amount === 'number' ? amount.toString() : amount;
  const cleaned = raw.replace(/[^0-9.,-]/g, '').trim();
  if (!cleaned) {
    return undefined;
  }
  const normalized = cleaned.replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  if (/^-?\d+$/.test(cleaned)) {
    return parsed / 100;
  }
  return parsed;
};

type PriceCandidate = {
  amount: string | number;
  currency?: string;
  formatted?: string;
};

const toPriceCandidates = (value: unknown, currencyHint?: string): PriceCandidate[] => {
  if (!value) {
    return [];
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return [{ amount: value, currency: currencyHint }];
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const candidates: PriceCandidate[] = [];

  const possibleKeys: [string, string[]][] = [
    ['price', ['price', 'amount', 'value']],
    ['min', ['min', 'minPrice']],
    ['max', ['max', 'maxPrice']]
  ];

  for (const [defaultCurrency, keys] of possibleKeys) {
    const nested = asRecord(record[defaultCurrency]);
    if (nested) {
      for (const key of keys) {
        if (nested[key] !== undefined) {
          candidates.push({
            amount: nested[key] as string | number,
            currency: typeof nested.currency === 'string' ? nested.currency : currencyHint
          });
          break;
        }
      }
    }
  }

  if (typeof record.currency === 'string' && record.value !== undefined) {
    candidates.push({ amount: record.value as string | number, currency: record.currency });
  }

  for (const [key, val] of Object.entries(record)) {
    if (typeof val === 'string' || typeof val === 'number') {
      const currency = key.length === 3 ? key : currencyHint;
      candidates.push({ amount: val, currency });
    } else {
      const nested = asRecord(val);
      if (!nested) {
        continue;
      }
      const nestedAmount =
        (typeof nested.amount === 'string' || typeof nested.amount === 'number')
          ? nested.amount
          : (typeof nested.value === 'string' || typeof nested.value === 'number')
            ? nested.value
            : (typeof nested.price === 'string' || typeof nested.price === 'number')
              ? nested.price
              : undefined;
      if (nestedAmount !== undefined) {
        candidates.push({
          amount: nestedAmount,
          currency:
            typeof nested.currency === 'string'
              ? nested.currency
              : key.length === 3
                ? key
                : currencyHint,
          formatted: typeof nested.display === 'string' ? nested.display : undefined
        });
      }
    }
  }

  return candidates;
};

const resolvePrice = (item: DMarketItem, desiredCurrency: string) => {
  const extra = asRecord(item.extra);
  const candidates = [
    ...toPriceCandidates(item.price, desiredCurrency),
    ...toPriceCandidates(extra?.['price'], desiredCurrency),
    ...toPriceCandidates(extra?.['instantPrice'], desiredCurrency),
    ...toPriceCandidates(extra?.['minOfferPrice'], desiredCurrency),
    ...toPriceCandidates(extra?.['bestOffer'], desiredCurrency),
    ...toPriceCandidates(extra?.['suggestedPrice'], desiredCurrency)
  ];

  const preferredCurrency = desiredCurrency.toUpperCase();
  let selected: PriceCandidate | undefined;

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const candidateCurrency = candidate.currency?.toUpperCase();
    if (candidateCurrency === preferredCurrency) {
      selected = candidate;
      break;
    }
    if (!selected) {
      selected = candidate;
    }
  }

  if (!selected) {
    return { price: undefined, currency: preferredCurrency, formatted: undefined };
  }

  const price = parsePriceAmount(selected.amount);
  const currency = (selected.currency ?? preferredCurrency).toUpperCase();
  return {
    price,
    currency,
    formatted: selected.formatted
  };
};

const resolveMedian = (item: DMarketItem, currency: string): number | undefined => {
  const extra = asRecord(item.extra);
  const candidates = [
    ...toPriceCandidates(extra?.['steamPrice'], currency),
    ...toPriceCandidates(extra?.['avgPrice'], currency),
    ...toPriceCandidates(extra?.['referencePrice'], currency)
  ];

  for (const candidate of candidates) {
    const parsed = parsePriceAmount(candidate.amount as string | number | undefined);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
};

const formatAvailability = (extra: Record<string, unknown> | undefined): string | undefined => {
  if (!extra) {
    return undefined;
  }
  const quantity = typeof extra['quantity'] === 'number' ? (extra['quantity'] as number) : undefined;
  const offers = typeof extra['offers'] === 'number' ? (extra['offers'] as number) : undefined;
  const bestQuantity =
    typeof extra['bestPriceCount'] === 'number' ? (extra['bestPriceCount'] as number) : undefined;

  const value = quantity ?? offers ?? bestQuantity;
  if (value === undefined) {
    return undefined;
  }
  return `${value} Angebote`;
};

const buildUrl = (item: DMarketItem, fallbackName: string): string => {
  const extra = asRecord(item.extra);
  const direct = typeof extra?.['url'] === 'string' ? (extra?.['url'] as string) : undefined;
  if (direct) {
    return direct;
  }
  const slug = typeof extra?.['slug'] === 'string' ? (extra?.['slug'] as string) : undefined;
  if (slug) {
    return `https://dmarket.com/ingame-items/item/${slug}`;
  }
  const marketHash =
    typeof extra?.['marketHashName'] === 'string'
      ? (extra?.['marketHashName'] as string)
      : fallbackName;
  return `https://dmarket.com/ingame-items/item/730/${encodeURIComponent(marketHash)}`;
};

const mapItemToResult = (item: DMarketItem, desiredCurrency: string): MarketResult | null => {
  const name = item.title?.trim();
  if (!name) {
    return null;
  }

  const { price, currency, formatted } = resolvePrice(item, desiredCurrency);
  const median30d = resolveMedian(item, currency);
  const extra = asRecord(item.extra);

  return {
    market: 'DMarket',
    name,
    url: buildUrl(item, name),
    price,
    priceFormatted: formatted ?? (price !== undefined ? price.toFixed(2) : undefined),
    currency,
    availability: formatAvailability(extra),
    wear: extractWear(name),
    stattrak: determineFlag(name, 'StatTrak'),
    souvenir: determineFlag(name, 'Souvenir'),
    median30d,
    sourceMeta: {
      id: item.id,
      image: item.image ?? item.icon
    }
  } satisfies MarketResult;
};

const filterItems = (items: DMarketItem[], query: SearchQuery): DMarketItem[] => {
  const normalizedQuery = normalizeText(query.text);
  if (!normalizedQuery) {
    return items;
  }

  const words = normalizedQuery.split(' ').filter(Boolean);
  if (words.length === 0) {
    return items;
  }

  return items.filter((item) => {
    const name = item.title ?? '';
    const normalizedName = normalizeText(name);
    return words.every((word) => normalizedName.includes(word));
  });
};

export class DMarketProvider implements Provider {
  readonly name = 'DMarket';

  async search(query: SearchQuery): Promise<MarketResult[]> {
    const limit = query.limitPerMarket ?? 5;
    const cacheKey = JSON.stringify({ provider: 'dmarket', text: query.text, limit });

    return cache.withTtl(cacheKey, CACHE_TTL_SECONDS, async () => {
      try {
        const response = await axios.get<DMarketResponse>(DMARKET_URL, {
          params: {
            gameId: 'a8db',
            title: query.text,
            limit: Math.min(limit, DEFAULT_LIMIT)
          },
          timeout: 7000,
          headers: {
            Accept: 'application/json'
          }
        });

        const items = response.data.objects ?? [];
        const filtered = filterItems(items, query);
        const mapped = filtered
          .map((item) => mapItemToResult(item, query.currency ?? 'USD'))
          .filter((item): item is MarketResult => item !== null);

        const sorted = mapped.sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY));

        return sorted.slice(0, limit);
      } catch (error) {
        logger.warn('DMarket API request failed', { error: (error as Error).message });
        return [];
      }
    });
  }
}
