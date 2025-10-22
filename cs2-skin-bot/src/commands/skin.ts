import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Aggregator } from '../core/aggregator.js';
import { MarketResult, SearchQuery, Wear } from '../core/types.js';

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

  return query;
};

const createEmbed = (result: MarketResult): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setTitle(`${result.name} — ${result.market}`)
    .setFooter({ text: 'Abruf' })
    .setTimestamp(new Date());

  if (result.url) {
    embed.setURL(result.url);
  }

  const priceText = result.priceFormatted ?? formatPrice(result.price, result.currency) ?? '–';
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

  if (result.median30d !== undefined) {
    const medianFormatted = formatPrice(result.median30d, result.currency) ?? result.median30d.toFixed(2);
    embed.addFields({ name: 'Median (30d)', value: medianFormatted, inline: true });
  }

  if (result.stattrak) {
    embed.addFields({ name: 'StatTrak™', value: 'Ja', inline: true });
  }

  if (result.souvenir) {
    embed.addFields({ name: 'Souvenir', value: 'Ja', inline: true });
  }

  return embed;
};

const buildFilterSummary = (query: SearchQuery): string | undefined => {
  const parts: string[] = [];
  if (query.wear) {
    parts.push(`Wear: ${query.wear}`);
  }
  if (query.stattrak) {
    parts.push('StatTrak™: an');
  }
  if (query.souvenir) {
    parts.push('Souvenir: an');
  }
  if (query.floatMin !== undefined || query.floatMax !== undefined) {
    parts.push(
      `Float: ${query.floatMin !== undefined ? query.floatMin.toFixed(4) : '0'} – ${
        query.floatMax !== undefined ? query.floatMax.toFixed(4) : '1'
      }`
    );
  }
  if (query.patternIn && query.patternIn.length > 0) {
    parts.push(`Pattern: ${query.patternIn.join(', ')}`);
  }
  return parts.length > 0 ? `Filter • ${parts.join(' • ')}` : undefined;
};

export const handleSkinCommand = async (
  interaction: ChatInputCommandInteraction,
  aggregator: Aggregator
): Promise<void> => {
  await interaction.deferReply();

  const query = buildQueryFromInteraction(interaction);
  const filterSummary = buildFilterSummary(query);

  try {
    const results = await aggregator.searchAll(query);
    if (results.length === 0) {
      await interaction.editReply('Keine Treffer gefunden.');
      return;
    }

    const embeds = results.slice(0, 10).map((result) => createEmbed(result));

    const reply: { content?: string; embeds: EmbedBuilder[] } = { embeds };
    if (filterSummary) {
      reply.content = filterSummary;
    }

    await interaction.editReply(reply);
  } catch (error) {
    await interaction.editReply('Beim Abrufen der Ergebnisse ist ein Fehler aufgetreten. Bitte versuche es später erneut.');
    throw error;
  }
};
