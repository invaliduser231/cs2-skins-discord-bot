import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Aggregator, ProviderExecution } from '../core/aggregator.js';
import { MarketResult, SearchQuery, Wear } from '../core/types.js';

const DEFAULT_COLOR = 0x5865f2;

const PROVIDER_LABELS: Record<string, string> = {
  skinport: 'Skinport',
  steam: 'Steam Community Market',
  dmarket: 'DMarket',
  buff163: 'BUFF163',
  waxpeer: 'Waxpeer'
};

const SORT_LABELS: Record<NonNullable<SearchQuery['sortBy']>, string> = {
  price: 'Preis (aufsteigend)',
  discount: 'Rabatt (absteigend)',
  market: 'Marktname',
  name: 'Name'
};

const isNonEmpty = (value: string | undefined): value is string => Boolean(value);

const formatPrice = (price: number | undefined, currency: string): string | undefined => {
  if (price === undefined) {
    return undefined;
  }
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(price);
  } catch {
    return price.toFixed(2);
  }
};

const ensurePrice = (price: number | undefined, currency: string): string => {
  if (price === undefined) {
    return '–';
  }
  return formatPrice(price, currency) ?? price.toFixed(2);
};

const parsePatternIn = (value: string | null): number[] | undefined => {
  if (!value) {
    return undefined;
  }
  const ids = value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((num) => Number.isFinite(num));
  return ids.length > 0 ? ids : undefined;
};

const computeDiscount = (result: MarketResult): number | undefined => {
  if (result.price === undefined || result.median30d === undefined || result.median30d === 0) {
    return undefined;
  }
  return ((result.median30d - result.price) / result.median30d) * 100;
};

type DiscountDescription = {
  percent: number;
  difference: number;
  text: string;
};

const describeDiscount = (result: MarketResult): DiscountDescription | undefined => {
  const discount = computeDiscount(result);
  if (discount === undefined || result.price === undefined || result.median30d === undefined) {
    return undefined;
  }
  const difference = result.median30d - result.price;
  const differenceFormatted =
    formatPrice(Math.abs(difference), result.currency) ?? Math.abs(difference).toFixed(2);
  const priceIndicator = difference >= 0 ? '−' : '+';
  const percentIndicator = discount >= 0 ? '+' : '−';
  const text = `${priceIndicator}${differenceFormatted} (${percentIndicator}${Math.abs(discount).toFixed(1)}%) vs. 30d Median`;
  return {
    percent: discount,
    difference,
    text
  };
};

const determineColor = (discount?: number): number => {
  if (discount === undefined) {
    return DEFAULT_COLOR;
  }
  if (discount >= 30) {
    return 0x00b894;
  }
  if (discount >= 20) {
    return 0x2ecc71;
  }
  if (discount >= 10) {
    return 0xf1c40f;
  }
  if (discount >= 0) {
    return 0x3498db;
  }
  if (discount <= -20) {
    return 0xe74c3c;
  }
  if (discount <= -10) {
    return 0xe67e22;
  }
  return 0x95a5a6;
};

const describeDealBadge = (discount?: number): string | undefined => {
  if (discount === undefined) {
    return undefined;
  }
  if (discount >= 30) {
    return '🔥 S-Tier Deal';
  }
  if (discount >= 20) {
    return '🟢 A-Tier Deal';
  }
  if (discount >= 10) {
    return '🟡 Solider Deal';
  }
  if (discount >= 0) {
    return '🔵 Marktpreis';
  }
  if (discount <= -20) {
    return '🔻 Stark über Median';
  }
  if (discount <= -10) {
    return '🟠 Über Median';
  }
  return '⚪ Nahe am Median';
};

const formatDuration = (durationMs: number): string => {
  if (durationMs >= 1000) {
    const seconds = durationMs / 1000;
    return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
  }
  return `${durationMs}ms`;
};

const formatProviders = (providers: string[]): string =>
  providers
    .map((provider) => PROVIDER_LABELS[provider.toLowerCase()] ?? provider)
    .join(', ');

const hasPrice = (result: MarketResult): result is MarketResult & { price: number } => result.price !== undefined;

const hasDiscount = (
  result: MarketResult
): result is MarketResult & { price: number; median30d: number } =>
  result.price !== undefined && result.median30d !== undefined && result.median30d !== 0;

const buildQueryFromInteraction = (interaction: ChatInputCommandInteraction): SearchQuery => {
  const query: SearchQuery = {
    text: interaction.options.getString('query', true)
  };

  const wear = interaction.options.getString('wear') as Wear | null;
  if (wear) {
    query.wear = wear;
  }

  const stattrak = interaction.options.getBoolean('stattrak');
  if (stattrak !== null) {
    query.stattrak = stattrak;
  }

  const souvenir = interaction.options.getBoolean('souvenir');
  if (souvenir !== null) {
    query.souvenir = souvenir;
  }

  const floatMin = interaction.options.getNumber('float_min');
  if (floatMin !== null) {
    query.floatMin = floatMin;
  }

  const floatMax = interaction.options.getNumber('float_max');
  if (floatMax !== null) {
    query.floatMax = floatMax;
  }

  const patternIn = parsePatternIn(interaction.options.getString('pattern_in'));
  if (patternIn) {
    query.patternIn = patternIn;
  }

  const limit = interaction.options.getInteger('limit');
  if (limit !== null) {
    query.limitPerMarket = limit;
  }

  const priceMin = interaction.options.getNumber('min_price');
  if (priceMin !== null) {
    query.priceMin = priceMin;
  }

  const priceMax = interaction.options.getNumber('max_price');
  if (priceMax !== null) {
    query.priceMax = priceMax;
  }

  const currency = interaction.options.getString('currency');
  if (currency) {
    query.currency = currency;
  }

  const country = interaction.options.getString('country');
  if (country) {
    query.country = country;
  }

  const providers = interaction.options.getString('market');
  if (providers && providers !== 'all') {
    query.providers = providers
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  const sortBy = interaction.options.getString('sort_by') as NonNullable<SearchQuery['sortBy']> | null;
  if (sortBy) {
    query.sortBy = sortBy;
  }

  return query;
};

const createEmbed = (result: MarketResult): EmbedBuilder => {
  const discount = describeDiscount(result);
  const embed = new EmbedBuilder()
    .setTitle(`${result.name} — ${result.market}`)
    .setFooter({ text: 'Abruf' })
    .setTimestamp(new Date())
    .setColor(determineColor(discount?.percent));

  if (result.url) {
    embed.setURL(result.url);
  }

  const priceText = result.priceFormatted ?? ensurePrice(result.price, result.currency);
  embed.addFields({ name: 'Preis', value: priceText, inline: true });
  embed.addFields({ name: 'Währung', value: result.currency, inline: true });

  if (result.availability) {
    embed.addFields({ name: 'Verfügbarkeit', value: result.availability, inline: true });
  }

  if (result.volume24h) {
    embed.addFields({ name: 'Volumen (24h)', value: result.volume24h, inline: true });
  }

  if (result.wear) {
    embed.addFields({ name: 'Wear', value: result.wear, inline: true });
  }

  if (result.median7d !== undefined) {
    const median7Text = formatPrice(result.median7d, result.currency) ?? result.median7d.toFixed(2);
    embed.addFields({ name: 'Median (7d)', value: median7Text, inline: true });
  }

  if (result.median30d !== undefined) {
    const median30Text = formatPrice(result.median30d, result.currency) ?? result.median30d.toFixed(2);
    embed.addFields({ name: 'Median (30d)', value: median30Text, inline: true });
  }

  if (discount) {
    embed.addFields({ name: 'Abweichung (30d)', value: discount.text, inline: true });
  }

  const dealBadge = describeDealBadge(discount?.percent);
  if (dealBadge) {
    embed.addFields({ name: 'Deal-Score', value: dealBadge, inline: true });
  }

  if (result.stattrak !== undefined) {
    embed.addFields({ name: 'StatTrak™', value: result.stattrak ? 'Ja' : 'Nein', inline: true });
  }

  if (result.souvenir !== undefined) {
    embed.addFields({ name: 'Souvenir', value: result.souvenir ? 'Ja' : 'Nein', inline: true });
  }

  return embed;
};

const buildFilterSummary = (query: SearchQuery): string | undefined => {
  const parts: string[] = [];
  if (query.wear) {
    parts.push(`• Wear: ${query.wear}`);
  }
  if (query.stattrak !== undefined) {
    parts.push(`• StatTrak™: ${query.stattrak ? 'an' : 'aus'}`);
  }
  if (query.souvenir !== undefined) {
    parts.push(`• Souvenir: ${query.souvenir ? 'an' : 'aus'}`);
  }
  if (query.floatMin !== undefined || query.floatMax !== undefined) {
    parts.push(
      `• Float: ${query.floatMin !== undefined ? query.floatMin.toFixed(4) : '0'} – ${
        query.floatMax !== undefined ? query.floatMax.toFixed(4) : '1'
      }`
    );
  }
  if (query.patternIn && query.patternIn.length > 0) {
    parts.push(`• Pattern: ${query.patternIn.join(', ')}`);
  }
  if (query.priceMin !== undefined || query.priceMax !== undefined) {
    const minText = query.priceMin !== undefined ? query.priceMin.toFixed(2) : '0.00';
    const maxText = query.priceMax !== undefined ? query.priceMax.toFixed(2) : '∞';
    parts.push(`• Preisbereich: ${minText} – ${maxText}`);
  }
  if (query.limitPerMarket !== undefined) {
    parts.push(`• Limit pro Markt: ${query.limitPerMarket}`);
  }
  if (query.currency) {
    parts.push(`• Währung: ${query.currency}`);
  }
  if (query.country) {
    parts.push(`• Land: ${query.country}`);
  }
  if (query.providers && query.providers.length > 0) {
    parts.push(`• Märkte: ${formatProviders(query.providers)}`);
  }
  if (query.sortBy) {
    parts.push(`• Sortierung: ${SORT_LABELS[query.sortBy]}`);
  }
  return parts.length > 0 ? `**Filter**\n${parts.join('\n')}` : undefined;
};

const buildInsights = (results: MarketResult[]): string | undefined => {
  if (results.length === 0) {
    return undefined;
  }

  const lines: string[] = [];
  const uniqueMarkets = new Set(results.map((result) => result.market)).size;
  lines.push(`• ${results.length} Treffer aus ${uniqueMarkets} Märkten.`);

  const pricedResults = results.filter(hasPrice);
  if (pricedResults.length > 0) {
    const cheapest = pricedResults.reduce((min, current) => (current.price < min.price ? current : min));
    lines.push(
      `• Günstigster Treffer: ${cheapest.name} (${cheapest.market}) für ${ensurePrice(
        cheapest.price,
        cheapest.currency
      )}.`
    );
  }

  const discountedResults = results.filter(hasDiscount);
  if (discountedResults.length > 0) {
    const bestDeal = discountedResults.reduce((best, current) =>
      computeDiscount(current)! > computeDiscount(best)! ? current : best
    );
    const discount = describeDiscount(bestDeal);
    const priceText = ensurePrice(bestDeal.price, bestDeal.currency);
    if (discount) {
      lines.push(`• Bester Deal: ${bestDeal.name} (${bestDeal.market}) bei ${priceText} — ${discount.text}.`);
    }
  }

  if (pricedResults.length > 1) {
    const currencies = new Set(pricedResults.map((result) => result.currency));
    if (currencies.size === 1) {
      const average =
        pricedResults.reduce((sum, current) => sum + current.price, 0) / pricedResults.length;
      const averageText = formatPrice(average, pricedResults[0].currency) ?? average.toFixed(2);
      lines.push(`• Durchschnittspreis aller Treffer: ${averageText}.`);
    }
  }

  return lines.length > 0 ? `**Insights**\n${lines.join('\n')}` : undefined;
};

const buildStatusSummary = (executions: ProviderExecution[]): string | undefined => {
  if (executions.length === 0) {
    return undefined;
  }

  const lines = executions.map((execution) => {
    const duration = formatDuration(execution.durationMs);
    if (execution.timedOut) {
      return `• ${execution.provider}: ⚠️ Timeout nach ${duration}`;
    }
    if (execution.error) {
      return `• ${execution.provider}: ⚠️ ${execution.error} (${duration})`;
    }
    return `• ${execution.provider}: ✅ ${execution.results.length} Treffer (${duration})`;
  });

  return `**Status**\n${lines.join('\n')}`;
};

export const handleSkinCommand = async (
  interaction: ChatInputCommandInteraction,
  aggregator: Aggregator
): Promise<void> => {
  await interaction.deferReply();

  const query = buildQueryFromInteraction(interaction);

  try {
    const { results, executions } = await aggregator.searchAll(query);
    const filterSummary = buildFilterSummary(query);
    const insights = buildInsights(results);
    const statusSummary = buildStatusSummary(executions);

    if (results.length === 0) {
      const sections = [filterSummary, statusSummary, 'Keine Treffer gefunden.'].filter(isNonEmpty);
      await interaction.editReply(sections.join('\n\n'));
      return;
    }

    const embeds = results.slice(0, 10).map((result) => createEmbed(result));
    const sections = [filterSummary, insights, statusSummary].filter(isNonEmpty);

    const reply: { content?: string; embeds: EmbedBuilder[] } = { embeds };
    if (sections.length > 0) {
      reply.content = sections.join('\n\n');
    }

    await interaction.editReply(reply);
  } catch (error) {
    await interaction.editReply(
      'Beim Abrufen der Ergebnisse ist ein Fehler aufgetreten. Bitte versuche es später erneut.'
    );
    throw error;
  }
};
