export type Wear =
  | 'Factory New'
  | 'Minimal Wear'
  | 'Field-Tested'
  | 'Well-Worn'
  | 'Battle-Scarred';

export type SearchQuery = {
  text: string;
  wear?: Wear;
  stattrak?: boolean;
  souvenir?: boolean;
  floatMin?: number;
  floatMax?: number;
  patternIn?: number[];
  limitPerMarket?: number;
  currency?: string;
  country?: string;
  priceMin?: number;
  priceMax?: number;
  providers?: string[];
  sortBy?: SortStrategy;
};

export type SortStrategy = 'price' | 'discount' | 'market' | 'name';

export type MarketResult = {
  market: string;
  name: string;
  url?: string;
  price?: number;
  priceFormatted?: string;
  currency: string;
  availability?: string;
  wear?: Wear;
  stattrak?: boolean;
  souvenir?: boolean;
  volume24h?: string;
  median7d?: number;
  median30d?: number;
  sourceMeta?: Record<string, unknown>;
};

export interface Provider {
  readonly name: string;
  search(query: SearchQuery): Promise<MarketResult[]>;
}
