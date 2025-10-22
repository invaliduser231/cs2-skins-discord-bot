import { SlashCommandBuilder, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { WEARS } from '../core/normalize.js';
import { logger } from '../util/logger.js';

dotenv.config();

const CURRENCY_CHOICES: { name: string; value: string }[] = [
  { name: 'Euro (EUR)', value: 'EUR' },
  { name: 'US-Dollar (USD)', value: 'USD' },
  { name: 'Britisches Pfund (GBP)', value: 'GBP' },
  { name: 'Schweizer Franken (CHF)', value: 'CHF' },
  { name: 'Russischer Rubel (RUB)', value: 'RUB' },
  { name: 'Koreanischer Won (KRW)', value: 'KRW' },
  { name: 'Brasilianischer Real (BRL)', value: 'BRL' },
  { name: 'Norwegische Krone (NOK)', value: 'NOK' },
  { name: 'Indonesische Rupiah (IDR)', value: 'IDR' },
  { name: 'Chinesischer Yuan (CNY)', value: 'CNY' }
];

const COUNTRY_CHOICES: { name: string; value: string }[] = [
  { name: 'Deutschland (DE)', value: 'DE' },
  { name: 'USA (US)', value: 'US' },
  { name: 'Vereinigtes Königreich (GB)', value: 'GB' },
  { name: 'Brasilien (BR)', value: 'BR' },
  { name: 'Russland (RU)', value: 'RU' },
  { name: 'Südkorea (KR)', value: 'KR' },
  { name: 'Indonesien (ID)', value: 'ID' },
  { name: 'Norwegen (NO)', value: 'NO' },
  { name: 'Schweiz (CH)', value: 'CH' },
  { name: 'China (CN)', value: 'CN' }
];

const MARKET_CHOICES: { name: string; value: string }[] = [
  { name: 'Alle Märkte', value: 'all' },
  { name: 'Nur Skinport', value: 'skinport' },
  { name: 'Nur Steam Community Market', value: 'steam' },
  { name: 'Nur DMarket', value: 'dmarket' },
  { name: 'Nur BUFF163', value: 'buff163' },
  { name: 'Nur Waxpeer', value: 'waxpeer' }
];

const SORT_CHOICES: { name: string; value: string }[] = [
  { name: 'Bestes Angebot (Preis aufsteigend)', value: 'price' },
  { name: 'Bester Rabatt', value: 'discount' },
  { name: 'Nach Markt', value: 'market' },
  { name: 'Alphabetisch', value: 'name' }
];

const buildSkinCommand = () => {
  const command = new SlashCommandBuilder()
    .setName('skin')
    .setDescription('Suche nach CS2-Skins über mehrere Märkte.')
    .addStringOption((option) =>
      option.setName('query').setDescription('Name des Skins oder der Waffe').setRequired(true)
    )
    .addStringOption((option) => {
      option.setName('wear').setDescription('Wear-Filter');
      WEARS.forEach((wear) => option.addChoices({ name: wear, value: wear }));
      return option;
    })
    .addBooleanOption((option) =>
      option.setName('stattrak').setDescription('Nur StatTrak™-Varianten anzeigen')
    )
    .addBooleanOption((option) => option.setName('souvenir').setDescription('Nur Souvenir-Varianten anzeigen'))
    .addNumberOption((option) =>
      option.setName('float_min').setDescription('Minimale Float (0..1)')
    )
    .addNumberOption((option) => option.setName('float_max').setDescription('Maximale Float (0..1)'))
    .addStringOption((option) =>
      option
        .setName('pattern_in')
        .setDescription('Kommagetrennte Liste an Pattern-IDs (wird aktuell nur angezeigt)')
    )
    .addIntegerOption((option) =>
      option
        .setName('limit')
        .setDescription('Maximale Treffer pro Markt (1-10)')
        .setMinValue(1)
        .setMaxValue(10)
    )
    .addNumberOption((option) =>
      option
        .setName('min_price')
        .setDescription('Minimaler Preis in der gewählten Währung')
        .setMinValue(0)
    )
    .addNumberOption((option) =>
      option
        .setName('max_price')
        .setDescription('Maximaler Preis in der gewählten Währung')
        .setMinValue(0)
    )
    .addStringOption((option) => {
      option.setName('currency').setDescription('Währung für die Preisangaben');
      CURRENCY_CHOICES.forEach((choice) => option.addChoices(choice));
      return option;
    })
    .addStringOption((option) => {
      option.setName('country').setDescription('Ländercode für Steam-Marktdaten');
      COUNTRY_CHOICES.forEach((choice) => option.addChoices(choice));
      return option;
    })
    .addStringOption((option) => {
      option.setName('market').setDescription('Zu durchsuchende Märkte');
      MARKET_CHOICES.forEach((choice) => option.addChoices(choice));
      return option;
    })
    .addStringOption((option) => {
      option.setName('sort_by').setDescription('Sortierung der Gesamtergebnisse');
      SORT_CHOICES.forEach((choice) => option.addChoices(choice));
      return option;
    });

  return command;
};

const register = async () => {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !clientId) {
    throw new Error('DISCORD_TOKEN und DISCORD_CLIENT_ID müssen gesetzt sein.');
  }

  const rest = new REST({ version: '10' }).setToken(token);

  const commands = [buildSkinCommand().toJSON()];

  try {
    if (guildId) {
      logger.info('Registriere Commands für Guild');
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    } else {
      logger.info('Registriere Commands global');
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
    }
    logger.info('Slash-Commands erfolgreich registriert');
  } catch (error) {
    const err = error as Error;
    logger.error('Fehler beim Registrieren der Slash-Commands', { error: err.message });
    throw error;
  }
};

register().catch((error) => {
  logger.error('Command-Registration fehlgeschlagen', { error: (error as Error).message });
  process.exitCode = 1;
});
