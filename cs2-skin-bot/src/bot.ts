import { Client, GatewayIntentBits, Interaction } from 'discord.js';
import dotenv from 'dotenv';
import { Aggregator } from './core/aggregator.js';
import { SkinportProvider } from './providers/skinport.js';
import { SteamProvider } from './providers/steam.js';
import { DMarketProvider } from './providers/dmarket.js';
import { Buff163Provider } from './providers/buff163.js';
import { WaxpeerProvider } from './providers/waxpeer.js';
import { handleSkinCommand } from './commands/skin.js';
import { createLimiter } from './util/rate.js';
import { logger } from './util/logger.js';

dotenv.config();

const providers = [
  new SkinportProvider(),
  new SteamProvider(),
  new DMarketProvider(),
  new Buff163Provider(),
  new WaxpeerProvider()
];
const globalLimiter = createLimiter({ minTime: 200, maxConcurrent: 3 });
const aggregator = new Aggregator(providers, globalLimiter);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', (readyClient) => {
  logger.info(`Bot eingeloggt als ${readyClient.user.tag}`);
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName === 'skin') {
    try {
      await handleSkinCommand(interaction, aggregator);
    } catch (error) {
      logger.error('Fehler beim Ausführen des Skin-Commands', { error: (error as Error).message });
    }
  }
});

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error('DISCORD_TOKEN muss gesetzt sein.');
}

client
  .login(token)
  .then(() => logger.info('Login erfolgreich, Bot bereit.'))
  .catch((error) => {
    logger.error('Login fehlgeschlagen', { error: (error as Error).message });
    process.exitCode = 1;
  });
