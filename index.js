import dotenv from 'dotenv';
import { InstagramBot } from './core/bot.js';
import { TelegramBridge } from './tg-bridge/bridge.js';
import { ModuleManager } from './core/module-manager.js';
import { logger } from './utils.js';

dotenv.config();

class HyperInsta {
  constructor() {
    this.instagramBot = new InstagramBot();
    this.telegramBridge = new TelegramBridge();
    this.moduleManager = new ModuleManager(this.instagramBot, this.telegramBridge);
  }

  async initialize() {
    try {
      logger.info('🚀 Starting Hyper Insta...');
      
      // Initialize Instagram connection
      await this.instagramBot.login();
      
      // Initialize Telegram bridge
      await this.telegramBridge.initialize();
      
      // Load modules
      await this.moduleManager.loadModules();
      
      // Set up message handlers
      this.setupMessageHandlers();
      
      logger.info('✅ Hyper Insta initialized successfully!');
      
    } catch (error) {
      logger.error('❌ Failed to initialize Hyper Insta:', error);
      process.exit(1);
    }
  }

  setupMessageHandlers() {
    // Handle incoming Instagram messages
    this.instagramBot.onMessage(async (message) => {
      try {
        // Process through modules
        const processedMessage = await this.moduleManager.processMessage(message);
        
        // Forward to Telegram if enabled
        if (processedMessage.shouldForward) {
          await this.telegramBridge.forwardMessage(processedMessage);
        }
      } catch (error) {
        logger.error('Error processing message:', error);
      }
    });

    // Handle Telegram replies (bidirectional)
    this.telegramBridge.onMessage(async (reply) => {
      try {
        if (reply.type === 'telegram_reply') {
          // Send reply back to Instagram
          await this.instagramBot.sendMessage(reply.threadId, reply.text);
          logger.info(`📱⬅️📱 Sent Telegram reply to @${reply.originalSender}: ${reply.text}`);
        }
      } catch (error) {
        logger.error('Error handling Telegram reply:', error);
      }
    });

    // Handle media messages
    this.instagramBot.onMedia(async (media) => {
      try {
        await this.telegramBridge.forwardMedia(media);
      } catch (error) {
        logger.error('Error forwarding media:', error);
      }
    });
  }

  async start() {
    await this.initialize();
    
    // Keep the bot running
    process.on('SIGINT', async () => {
      logger.info('🛑 Shutting down Hyper Insta...');
      await this.instagramBot.disconnect();
      await this.moduleManager.unloadModules();
      process.exit(0);
    });

    logger.info('🚀 Hyper Insta is running... Press Ctrl+C to stop');
  }
}

// Start Hyper Insta
const bot = new HyperInsta();
bot.start().catch(console.error);
