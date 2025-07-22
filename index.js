import { InstagramBot } from './core/bot.js';
import { TelegramBridge } from './tg-bridge/bridge.js';
import { ModuleManager } from './core/module-manager.js';
import { logger } from './core/utils.js';

// Enhanced UI for Hyper Insta
console.clear();
console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║    🚀 HYPER INSTA - Advanced Instagram Bot                  ║
║                                                              ║
║    ⚡ Features:                                              ║
║    • Instagram Message Automation                           ║
║    • Bidirectional Telegram Bridge                          ║
║    • Modular Command System                                  ║
║    • MongoDB Session Management                              ║
║    • Auto-Reply & Message Filtering                         ║
║                                                              ║
║    🔧 Status: Initializing...                               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

class HyperInsta {
  constructor() {
    this.startTime = new Date();
    this.instagramBot = new InstagramBot();
    this.telegramBridge = new TelegramBridge();
    this.moduleManager = new ModuleManager(this.instagramBot, this.telegramBridge);
    this.isInitialized = false;
  }

  async initialize() {
    try {
      this.displayStatus('🔄 Initializing Instagram Bot...');
      
      // Initialize Instagram connection
      await this.instagramBot.login();
      this.displayStatus('✅ Instagram Bot Connected');
      
      // Initialize Telegram bridge
      this.displayStatus('🔄 Initializing Telegram Bridge...');
      await this.telegramBridge.initialize();
      this.displayStatus('✅ Telegram Bridge Connected');
      
      // Load modules
      this.displayStatus('🔄 Loading Modules...');
      await this.moduleManager.loadModules();
      this.displayStatus('✅ All Modules Loaded');
      
      // Set up message handlers
      this.displayStatus('🔄 Setting up Message Handlers...');
      this.instagramBot.setupMessageHandlers(this.moduleManager, this.telegramBridge);
      this.setupTelegramHandlers();
      this.displayStatus('✅ Message Handlers Ready');
      
      this.isInitialized = true;
      this.displaySuccessScreen();
      
    } catch (error) {
      this.displayError('❌ Failed to initialize Hyper Insta', error);
      process.exit(1);
    }
  }

  setupTelegramHandlers() {
    // Handle Telegram replies (bidirectional)
    this.telegramBridge.onMessage(async (reply) => {
      try {
        if (reply.type === 'telegram_reply') {
          // Send reply back to Instagram
          const success = await this.instagramBot.sendMessage(reply.threadId, reply.text);
          if (success) {
            logger.info(`📱⬅️📱 Sent Telegram reply to @${reply.originalSender}: ${reply.text}`);
          }
        }
      } catch (error) {
        logger.error('Error handling Telegram reply:', error);
      }
    });
  }

  displayStatus(message) {
    console.log(`\n🔧 ${message}`);
  }

  displayError(message, error) {
    console.log(`\n❌ ${message}: ${error.message}`);
    logger.error(message, error);
  }

  displaySuccessScreen() {
    const uptime = new Date() - this.startTime;
    console.clear();
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║    🚀 HYPER INSTA - Successfully Initialized!               ║
║                                                              ║
║    ✅ Instagram Bot: Connected                               ║
║    ✅ Telegram Bridge: Active                                ║
║    ✅ Modules: ${this.moduleManager.modules.length.toString().padEnd(2)} Loaded                                    ║
║    ✅ Message Handlers: Ready                                ║
║                                                              ║
║    ⏱️  Startup Time: ${Math.round(uptime)}ms                              ║
║    🕒 Started: ${this.startTime.toLocaleTimeString()}                                ║
║                                                              ║
║    🎯 Bot is now listening for messages...                  ║
║    📱 Telegram bridge is active for replies                 ║
║                                                              ║
║    Press Ctrl+C to stop                                     ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
    
    logger.info('🚀 Hyper Insta is fully operational!');
  }

  async start() {
    await this.initialize();
    
    // Keep the bot running
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down Hyper Insta...');
      await this.instagramBot.disconnect();
      await this.moduleManager.unloadModules();
      console.log('✅ Hyper Insta stopped gracefully');
      process.exit(0);
    });

    // Display periodic status updates
    if (this.isInitialized) {
      setInterval(() => {
        const uptime = Math.floor((new Date() - this.startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        
        process.stdout.write(`\r⏱️  Uptime: ${hours}h ${minutes}m ${seconds}s | 📊 Modules: ${this.moduleManager.modules.length} | 🔄 Status: Running`);
      }, 1000);
    }
  }
}

// Start Hyper Insta
const bot = new HyperInsta();
bot.start().catch(console.error);