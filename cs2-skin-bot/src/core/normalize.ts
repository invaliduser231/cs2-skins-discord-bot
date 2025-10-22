import { Wear } from './types.js';

export const WEARS: readonly Wear[] = [
  'Factory New',
  'Minimal Wear',
  'Field-Tested',
  'Well-Worn',
  'Battle-Scarred'
] as const;

export const normalizeText = (text: string): string =>
  text.trim().toLowerCase().replace(/\s+/g, ' ');

const removeWearFromQuery = (query: string): string => {
  const wearPattern = new RegExp(`\\b(?:${WEARS.join('|')})\\b`, 'gi');
  return query.replace(/\(([^)]+)\)/g, '').replace(wearPattern, '').replace(/\s+/g, ' ').trim();
};

const titleizeWord = (word: string): string => {
  if (!word) {
    return word;
  }
  const lower = word.toLowerCase();
  if (/^[a-z]{1,3}$/i.test(word) || /[0-9-]/.test(word)) {
    return word.toUpperCase();
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

const buildBaseCandidates = (query: string): string[] => {
  const cleaned = removeWearFromQuery(query).replace(/\s*\|\s*/g, ' | ');
  if (!cleaned) {
    return [];
  }
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const titleizedWords = words.map(titleizeWord);
  const baseSet = new Set<string>();
  const joined = titleizedWords.join(' ');
  if (joined.includes('|')) {
    baseSet.add(joined.replace(/\s*\|\s*/g, ' | '));
  } else {
    baseSet.add(joined);
    if (words.length > 1) {
      const [first, ...rest] = titleizedWords;
      baseSet.add(`${first} | ${rest.join(' ')}`.replace(/\s*\|\s*/g, ' | '));
    }
  }
  return Array.from(baseSet);
};

export const inferCandidates = (
  query: string,
  wear?: Wear,
  stattrak?: boolean,
  souvenir?: boolean
): string[] => {
  const baseCandidates = buildBaseCandidates(query);
  if (baseCandidates.length === 0) {
    return [];
  }

  const wearOptions: (Wear | undefined)[] = wear ? [wear] : [undefined, ...WEARS];

  const souvenirOptions: string[] =
    souvenir === true ? ['Souvenir '] : souvenir === false ? [''] : ['', 'Souvenir '];
  const stattrakOptions: string[] =
    stattrak === true ? ['StatTrak™ '] : stattrak === false ? [''] : ['', 'StatTrak™ '];

  const result = new Set<string>();

  for (const base of baseCandidates) {
    for (const souvenirPrefix of souvenirOptions) {
      for (const stattrakPrefix of stattrakOptions) {
        const prefix = `${souvenirPrefix}${stattrakPrefix}`;
        for (const wearOption of wearOptions) {
          const candidate = `${prefix}${base}${wearOption ? ` (${wearOption})` : ''}`.trim();
          result.add(candidate.replace(/\s*\|\s*/g, ' | '));
        }
      }
    }
  }

  return Array.from(result);
};
