import { SlashCommandBuilder, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { WEARS } from '../core/normalize.js';
import { logger } from '../util/logger.js';

dotenv.config();

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
    );

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
