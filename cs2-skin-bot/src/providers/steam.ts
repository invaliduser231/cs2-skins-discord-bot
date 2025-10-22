import axios from 'axios';
import { MemoryCache } from '../core/cache.js';
import { inferCandidates, WEARS } from '../core/normalize.js';
import { MarketResult, Provider, SearchQuery, Wear } from '../core/types.js';

const STEAM_URL = 'https://steamcommunity.com/market/priceoverview/';
const DEFAULT_CURRENCY = process.env.CURRENCY ?? 'EUR';
const DEFAULT_COUNTRY = process.env.COUNTRY ?? 'DE';

const resolveTtl = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const DEFAULT_CACHE_TTL = resolveTtl(process.env.CACHE_TTL_SECONDS, 120);

const CURRENCY_MAP: Record<string, number> = {
  USD: 1,
  GBP: 2,
  EUR: 3,
  CHF: 4,
  RUB: 5,
  KRW: 16,
  BRL: 7,
  NOK: 9,
  IDR: 11
};

type SteamPriceOverview = {
  success: boolean;
  lowest_price?: string;
  volume?: string;
  median_price?: string;
};

const cache = new MemoryCache<MarketResult | null>(DEFAULT_CACHE_TTL);

const parsePriceString = (price?: string): number | undefined => {
  if (!price) {
    return undefined;
  }
  const cleaned = price.replace(/[^0-9,.-]/g, '');
  if (!cleaned) {
    return undefined;
  }
  const normalizedThousands = cleaned.replace(/\.(?=\d{3}(?:\D|$))/g, '');
  const normalizedDecimal = normalizedThousands.replace(',', '.');
  const value = Number.parseFloat(normalizedDecimal);
  return Number.isFinite(value) ? value : undefined;
};

const extractWear = (name: string): Wear | undefined => {
  const match = name.match(/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)/i);
  if (!match) {
    return undefined;
  }
  const normalized = match[1].toLowerCase();
  return WEARS.find((wear) => wear.toLowerCase() === normalized) as Wear | undefined;
};

const determineFlag = (name: string, keyword: string): boolean => new RegExp(keyword, 'i').test(name);

const buildCacheKey = (candidate: string, currency: string): string =>
  JSON.stringify({ provider: 'steam', candidate, currency });

const fetchCandidate = async (
  candidate: string,
  currency: string,
  country: string
): Promise<MarketResult | null> => {
  const cacheKey = buildCacheKey(candidate, currency);
  return cache.withTtl(cacheKey, DEFAULT_CACHE_TTL, async () => {
    const currencyCode = CURRENCY_MAP[currency.toUpperCase()] ?? CURRENCY_MAP.EUR;
    const response = await axios.get<SteamPriceOverview>(STEAM_URL, {
      params: {
        appid: 730,
        currency: currencyCode,
        country,
        market_hash_name: candidate
      },
      timeout: 7000
    });

    const data = response.data;
    if (!data.success) {
      return null;
    }

    const parsedPrice = parsePriceString(data.lowest_price ?? data.median_price);
    const priceFormatted = data.lowest_price ?? data.median_price;

    if (parsedPrice === undefined && !priceFormatted) {
      return null;
    }

    const wear = extractWear(candidate);

    return {
      market: 'Steam Community Market',
      name: candidate,
      url: `https://steamcommunity.com/market/listings/730/${encodeURIComponent(candidate)}`,
      price: parsedPrice,
      priceFormatted: priceFormatted ?? (parsedPrice !== undefined ? parsedPrice.toFixed(2) : undefined),
      currency,
      availability: data.volume ? `${data.volume} verkauft (24h)` : undefined,
      volume24h: data.volume,
      wear,
      stattrak: determineFlag(candidate, 'StatTrak'),
      souvenir: determineFlag(candidate, 'Souvenir'),
      median30d: parsePriceString(data.median_price),
      sourceMeta: {
        raw: data
      }
    };
  });
};

export class SteamProvider implements Provider {
  readonly name = 'Steam';

  async search(query: SearchQuery): Promise<MarketResult[]> {
    const currency = query.currency ?? DEFAULT_CURRENCY;
    const country = query.country ?? DEFAULT_COUNTRY;
    const candidates = inferCandidates(query.text, query.wear, query.stattrak, query.souvenir);
    const limit = query.limitPerMarket ?? 5;
    const results: MarketResult[] = [];

    for (const candidate of candidates) {
      if (results.length >= limit) {
        break;
      }
      try {
        const result = await fetchCandidate(candidate, currency, country);
        if (result) {
          results.push(result);
        }
      } catch (error) {
        continue;
      }
    }

    return results.slice(0, limit);
  }
}
