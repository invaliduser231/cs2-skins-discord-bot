import axios from 'axios';
import { MemoryCache } from '../core/cache.js';
import { normalizeText, WEARS } from '../core/normalize.js';
import { MarketResult, Provider, SearchQuery, Wear } from '../core/types.js';
import { logger } from '../util/logger.js';

const WAXPEER_URL = 'https://api.waxpeer.com/v1/list-items-steam';
const parsedTtl = Number.parseInt(process.env.CACHE_TTL_SECONDS ?? '', 10);
const CACHE_TTL_SECONDS = Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 120;
const cache = new MemoryCache<MarketResult[]>(CACHE_TTL_SECONDS);

interface WaxpeerItem {
  item_id?: number | string;
  name?: string;
  price?: number | string;
  price_usd?: number | string;
  quick_price?: number | string;
  suggested_price?: number | string;
  count?: number;
  img?: string;
  image?: string;
  inspect?: string;
  float?: number | string;
}

interface WaxpeerResponse {
  success?: boolean;
  items?: WaxpeerItem[];
  data?: {
    items?: WaxpeerItem[];
  };
}

const extractWear = (name: string): Wear | undefined => {
  const match = name.match(/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)/i);
  if (!match) {
    return undefined;
  }
  const normalized = match[1].toLowerCase();
  return WEARS.find((wear) => wear.toLowerCase() === normalized);
};

const determineFlag = (name: string, keyword: string): boolean => new RegExp(keyword, 'i').test(name);

const parsePrice = (value: string | number | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const raw = typeof value === 'number' ? value.toString() : value;
  const cleaned = raw.replace(/[^0-9.,-]/g, '').trim();
  if (!cleaned) {
    return undefined;
  }
  if (cleaned.includes('.') || cleaned.includes(',')) {
    const normalized = cleaned.replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed / 100;
};

const filterItems = (items: WaxpeerItem[], query: SearchQuery): WaxpeerItem[] => {
  const normalized = normalizeText(query.text);
  if (!normalized) {
    return items;
  }
  const words = normalized.split(' ').filter(Boolean);
  if (words.length === 0) {
    return items;
  }
  return items.filter((item) => {
    const name = item.name ?? '';
    const normalizedName = normalizeText(name);
    return words.every((word) => normalizedName.includes(word));
  });
};

const mapItemToResult = (item: WaxpeerItem): MarketResult | null => {
  const name = item.name?.trim();
  if (!name) {
    return null;
  }

  const price = parsePrice(item.price ?? item.price_usd ?? item.quick_price);
  const reference = parsePrice(item.suggested_price ?? item.quick_price);
  const count = typeof item.count === 'number' && item.count > 0 ? item.count : undefined;

  return {
    market: 'Waxpeer',
    name,
    url: `https://waxpeer.com/app/730/${encodeURIComponent(name)}`,
    price,
    priceFormatted:
      typeof item.price === 'string'
        ? item.price
        : typeof item.price_usd === 'string'
          ? item.price_usd
          : undefined,
    currency: 'USD',
    availability: count ? `${count} Angebote` : undefined,
    wear: extractWear(name),
    stattrak: determineFlag(name, 'StatTrak'),
    souvenir: determineFlag(name, 'Souvenir'),
    median30d: reference,
    sourceMeta: {
      itemId: item.item_id,
      image: item.img ?? item.image,
      float: item.float,
      inspect: item.inspect
    }
  } satisfies MarketResult;
};

export class WaxpeerProvider implements Provider {
  readonly name = 'Waxpeer';

  async search(query: SearchQuery): Promise<MarketResult[]> {
    const limit = query.limitPerMarket ?? 5;
    const cacheKey = JSON.stringify({ provider: 'waxpeer', text: query.text, limit });

    return cache.withTtl(cacheKey, CACHE_TTL_SECONDS, async () => {
      try {
        const response = await axios.get<WaxpeerResponse>(WAXPEER_URL, {
          params: {
            game: 'csgo',
            search: query.text,
            skip: 0,
            take: Math.min(limit * 2, 60)
          },
          timeout: 7000,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'cs2-skin-bot/1.0'
          }
        });

        const items = response.data.items ?? response.data.data?.items ?? [];
        const filtered = filterItems(items, query);
        const mapped = filtered
          .map((item) => mapItemToResult(item))
          .filter((result): result is MarketResult => result !== null);
        const sorted = mapped.sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY));
        return sorted.slice(0, limit);
      } catch (error) {
        logger.warn('Waxpeer API request failed', { error: (error as Error).message });
        return [];
      }
    });
  }
}
