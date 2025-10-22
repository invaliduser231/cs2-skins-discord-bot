import axios from 'axios';
import { MemoryCache } from '../core/cache.js';
import { normalizeText, WEARS } from '../core/normalize.js';
import { MarketResult, Provider, SearchQuery, Wear } from '../core/types.js';

const SKINPORT_URL = 'https://api.skinport.com/v1/items';
const DEFAULT_CURRENCY = process.env.CURRENCY ?? 'EUR';

const resolveTtl = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const DEFAULT_CACHE_TTL = resolveTtl(process.env.CACHE_TTL_SECONDS, 120);

type SkinportItem = {
  market_hash_name: string;
  min_price?: number;
  currency?: string;
  quantity?: number;
  suggested_price?: number;
  suggested_price_floor?: number;
  item_page?: string;
};

const cache = new MemoryCache<MarketResult[]>(DEFAULT_CACHE_TTL);

const extractWear = (name: string): Wear | undefined => {
  const match = name.match(/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)/i);
  if (!match) {
    return undefined;
  }
  const normalized = match[1].toLowerCase();
  return WEARS.find((wear) => wear.toLowerCase() === normalized) as Wear | undefined;
};

const determineBoolFlag = (name: string, keyword: string): boolean =>
  new RegExp(keyword, 'i').test(name);

const mapItemToResult = (item: SkinportItem, currency: string): MarketResult => {
  const price = typeof item.min_price === 'number' ? item.min_price : undefined;
  const url = item.item_page ?? `https://skinport.com/item/${encodeURIComponent(item.market_hash_name)}`;
  const availability = item.quantity ? `${item.quantity} Angebote` : undefined;
  const wear = extractWear(item.market_hash_name);
  return {
    market: 'Skinport',
    name: item.market_hash_name,
    url,
    price,
    priceFormatted: price !== undefined ? price.toFixed(2) : undefined,
    currency,
    availability,
    wear,
    stattrak: determineBoolFlag(item.market_hash_name, 'StatTrak'),
    souvenir: determineBoolFlag(item.market_hash_name, 'Souvenir'),
    median7d:
      typeof item.suggested_price_floor === 'number' ? item.suggested_price_floor : undefined,
    median30d: typeof item.suggested_price === 'number' ? item.suggested_price : undefined,
    sourceMeta: {
      quantity: item.quantity
    }
  };
};

const buildCacheKey = (query: SearchQuery, currency: string): string =>
  JSON.stringify({
    provider: 'skinport',
    text: query.text,
    currency,
    wear: query.wear,
    stattrak: query.stattrak,
    souvenir: query.souvenir
  });

const filterByQueryWords = (items: SkinportItem[], query: SearchQuery): SkinportItem[] => {
  const words = normalizeText(query.text).split(' ').filter(Boolean);
  if (words.length === 0) {
    return items;
  }
  return items.filter((item) => {
    const normalizedName = normalizeText(item.market_hash_name);
    return words.every((word) => normalizedName.includes(word));
  });
};

export class SkinportProvider implements Provider {
  readonly name = 'Skinport';

  async search(query: SearchQuery): Promise<MarketResult[]> {
    const currency = query.currency ?? DEFAULT_CURRENCY;
    const cacheKey = buildCacheKey(query, currency);

    return cache.withTtl(cacheKey, DEFAULT_CACHE_TTL, async () => {
      const response = await axios.get<SkinportItem[]>(SKINPORT_URL, {
        params: {
          appid: 730,
          currency
        },
        timeout: 7000
      });

      const filtered = filterByQueryWords(response.data, query);
      const mapped = filtered.map((item) => mapItemToResult(item, currency));
      const sorted = mapped.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
      const limit = query.limitPerMarket ?? 5;
      return sorted.slice(0, limit);
    });
  }
}
