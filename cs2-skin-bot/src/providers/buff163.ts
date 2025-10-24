import axios from 'axios';
import { MemoryCache } from '../core/cache.js';
import { normalizeText, WEARS } from '../core/normalize.js';
import { MarketResult, Provider, SearchQuery, Wear } from '../core/types.js';
import { logger } from '../util/logger.js';

const BUFF_URL = 'https://buff.163.com/api/market/goods';
const parsedTtl = Number.parseInt(process.env.CACHE_TTL_SECONDS ?? '', 10);
const CACHE_TTL_SECONDS = Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 120;
const cache = new MemoryCache<MarketResult[]>(CACHE_TTL_SECONDS);

interface BuffGoodsItem {
  goods_id?: number | string;
  sell_min_price?: string | number;
  sell_reference_price?: string | number;
  quick_price?: string | number;
  sell_num?: number;
  buy_num?: number;
  name?: string;
  market_hash_name?: string;
  icon_url?: string;
}

interface BuffResponse {
  code?: number | string;
  msg?: string;
  data?: {
    items?: BuffGoodsItem[];
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
  const normalized = cleaned.replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const formatAvailability = (item: BuffGoodsItem): string | undefined => {
  if (typeof item.sell_num === 'number' && item.sell_num > 0) {
    return `${item.sell_num} Angebote`;
  }
  if (typeof item.buy_num === 'number' && item.buy_num > 0) {
    return `${item.buy_num} Käufe (24h)`;
  }
  return undefined;
};

const filterItems = (items: BuffGoodsItem[], query: SearchQuery): BuffGoodsItem[] => {
  const normalized = normalizeText(query.text);
  if (!normalized) {
    return items;
  }
  const words = normalized.split(' ').filter(Boolean);
  if (words.length === 0) {
    return items;
  }
  return items.filter((item) => {
    const name = item.market_hash_name ?? item.name ?? '';
    const normalizedName = normalizeText(name);
    return words.every((word) => normalizedName.includes(word));
  });
};

const mapItemToResult = (item: BuffGoodsItem): MarketResult | null => {
  const name = (item.market_hash_name ?? item.name)?.trim();
  if (!name) {
    return null;
  }

  const price = parsePrice(item.sell_min_price ?? item.quick_price);
  const reference = parsePrice(item.sell_reference_price ?? item.quick_price);
  const goodsId = item.goods_id ?? name;

  return {
    market: 'BUFF163',
    name,
    url: `https://buff.163.com/market/goods?goods_id=${goodsId}`,
    price,
    priceFormatted: typeof item.sell_min_price === 'string' ? item.sell_min_price : undefined,
    currency: 'CNY',
    availability: formatAvailability(item),
    wear: extractWear(name),
    stattrak: determineFlag(name, 'StatTrak'),
    souvenir: determineFlag(name, 'Souvenir'),
    median30d: reference,
    sourceMeta: {
      goodsId,
      icon: item.icon_url
    }
  } satisfies MarketResult;
};

export class Buff163Provider implements Provider {
  readonly name = 'BUFF163';

  async search(query: SearchQuery): Promise<MarketResult[]> {
    const limit = query.limitPerMarket ?? 5;
    const cacheKey = JSON.stringify({ provider: 'buff163', text: query.text, limit });

    return cache.withTtl(cacheKey, CACHE_TTL_SECONDS, async () => {
      try {
        const response = await axios.get<BuffResponse>(BUFF_URL, {
          params: {
            game: 'csgo',
            search: query.text,
            page_num: 1,
            page_size: Math.min(limit * 2, 50)
          },
          timeout: 7000,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'cs2-skin-bot/1.0'
          }
        });

        const items = response.data.data?.items ?? [];
        const filtered = filterItems(items, query);
        const mapped = filtered
          .map((item) => mapItemToResult(item))
          .filter((result): result is MarketResult => result !== null);
        const sorted = mapped.sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY));
        return sorted.slice(0, limit);
      } catch (error) {
        logger.warn('BUFF163 API request failed', { error: (error as Error).message });
        return [];
      }
    });
  }
}
