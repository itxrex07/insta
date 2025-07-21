import dotenv from 'dotenv';
import { InstagramBot } from './bot/InstagramBot.js';
import { TelegramForwarder } from './services/TelegramForwarder.js';
import { PluginManager } from './plugins/PluginManager.js';
import { logger } from './utils/logger.js';

dotenv.config();

class InstagramUserBot {
  constructor() {
    this.instagramBot = new InstagramBot();
    this.telegramForwarder = new TelegramForwarder();
    this.pluginManager = new PluginManager();
  }

  async initialize() {
    try {
      logger.info('🚀 Starting Instagram UserBot...');
      
      // Initialize Instagram connection
      await this.instagramBot.login();
      
      // Initialize Telegram forwarder
      await this.telegramForwarder.initialize();
      
      // Load plugins
      await this.pluginManager.loadPlugins();
      
      // Set up message handlers
      this.setupMessageHandlers();
      
      logger.info('✅ Instagram UserBot initialized successfully!');
      
    } catch (error) {
      logger.error('❌ Failed to initialize bot:', error);
      process.exit(1);
    }
  }

  setupMessageHandlers() {
    // Handle incoming Instagram messages
    this.instagramBot.onMessage(async (message) => {
      try {
        // Process through plugins
        const processedMessage = await this.pluginManager.processMessage(message);
        
        // Forward to Telegram if enabled
        if (processedMessage.shouldForward) {
          await this.telegramForwarder.forwardMessage(processedMessage);
        }
      } catch (error) {
        logger.error('Error processing message:', error);
      }
    });

    // Handle media messages
    this.instagramBot.onMedia(async (media) => {
      try {
        await this.telegramForwarder.forwardMedia(media);
      } catch (error) {
        logger.error('Error forwarding media:', error);
      }
    });
  }

  async start() {
    await this.initialize();
    
    // Keep the bot running
    process.on('SIGINT', async () => {
      logger.info('🛑 Shutting down bot...');
      await this.instagramBot.disconnect();
      process.exit(0);
    });
  }
}

// Start the bot
const bot = new InstagramUserBot();
bot.start().catch(console.error);
