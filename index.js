// index.js
import { InstagramBot } from './core/bot.js'; // Ensure path is correct
// import { logger } from './utils/utils.js'; // Uncomment if logger exists and works
import { config } from './config.js'; // Ensure path is correct
import { connectDb } from './telegram/db.js'; // Adjust path
import { TelegramBridge } from './telegram/bridge.js'; // Change this line

// Fallback logger if utils logger isn't working as expected for debugging
const logger = {
  info: (...args) => console.log('[INFO] [Index]', ...args),
  error: (...args) => console.error('[ERROR] [Index]', ...args),
  debug: (...args) => console.log('[DEBUG] [Index]', ...args),
};

console.clear();


class HyperInsta {
  constructor() {
    this.startTime = new Date();
    this.instagramBot = null;
    this.moduleManager = null;
    this.messageHandler = null;
    this.telegramBridge = null; // Add this
  }

  async initialize() {
    try {
      this.showStartupBanner();

      // --- Initialize Database ---
      logger.info('🗄️ Initializing MongoDB...');
      await connectDb(); // This will connect and log
      logger.info('✅ MongoDB initialized.');

      // --- Initialize Instagram Bot ---
      logger.info('📱 Initializing Instagram Bot...');
      this.instagramBot = new InstagramBot();
      await this.instagramBot.login();
      logger.info('✅ Instagram Bot initialized.');

      // --- Initialize Telegram Bridge ---
      logger.info('🌉 Initializing Telegram Bridge...');
      this.telegramBridge = new TelegramBridge(this.instagramBot); // Pass IG bot instance
      // Optionally wait a moment or check this.telegramBridge.enabled
      logger.info('✅ Telegram Bridge initialized.');

    // --- Setup Module manager ---
      logger.info('📦 Initializing Module Manager...');
      // Import ModuleManager dynamically or ensure path is correct
      const { ModuleManager } = await import('./core/module-manager.js'); 
      this.moduleManager = new ModuleManager(this.instagramBot); // Pass bot instance if needed by modules
      await this.moduleManager.loadModules();
      logger.info('✅ Module Manager initialized and modules loaded.');

      // --- Setup Message Handler ---
      const { MessageHandler } = await import('./core/message-handler.js');
      // Pass the TelegramBridge instance to the MessageHandler
      this.messageHandler = new MessageHandler(this.instagramBot, this.moduleManager, this.telegramBridge);

      // Register the main Instagram message handler callback
      this.instagramBot.onMessage(async (instagramMessage) => {
        logger.debug('📩 Message received by index, forwarding to MessageHandler...');
        try {
          await this.messageHandler.handleMessage(instagramMessage);
          // --- Forward to Telegram Bridge ---
          // After modules handle it, forward it via the bridge
          if (this.telegramBridge?.enabled) {
             await this.telegramBridge.forwardInstagramMessage(instagramMessage);
          } else if (config.telegram?.token) { // Configured but failed init
              logger.warn('⚠️ Telegram is configured but bridge is not enabled. Message not forwarded.');
          }
        } catch (handlerError) {
          logger.error('❌ Error in main message handling chain:', handlerError.message);
        }
      });

      logger.info('🕒 Starting Message Requests Monitor...');
      await this.instagramBot.startMessageRequestsMonitor(); // Start periodic checks
      logger.info('✅ Message Requests Monitor started.');

      this.showLiveStatus();

      logger.info('🚀 HyperInsta initialization complete.');
    } catch (error) {
      logger.error(`❌ Startup failed: ${error.message}`);
      logger.debug('Startup error stack:', error.stack); // More detail for debugging
      // Attempt graceful shutdown if bot was partially initialized
      if (this.instagramBot) {
        try {
          await this.instagramBot.disconnect();
          logger.info('🧹 Partially initialized bot disconnected.');
        } catch (disconnectError) {
          logger.error('❌ Error during cleanup disconnect:', disconnectError.message);
        }
      }
      process.exit(1);
    }
  }

  showStartupBanner() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║    🚀 HYPER INSTA - INITIALIZING                           ║
║                                                              ║
║    ⚡ Ultra Fast • 🔌 Modular • 🛡️ Robust                  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
  }

  showLiveStatus() {
    const uptimeMs = Date.now() - this.startTime.getTime();
    console.clear();
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║    🚀 HYPER INSTA - LIVE & OPERATIONAL                     ║
║                                                              ║
║    ✅ Instagram: Connected & Active                         ║
║    ❌ Telegram: Disabled                                     ║
║    ⚡ Startup Time: ${Math.round(uptimeMs)}ms                                ║
║    🕒 Started: ${this.startTime.toLocaleTimeString()}                              ║
║                                                              ║
║    🎯 Ready for INSTANT commands...                        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

🔥 Bot is running at MAXIMUM PERFORMANCE!
💡 Type .help in Instagram to see all commands
    `);
  }

  async shutdown() {
    logger.info('🛑 Initiating graceful shutdown...');
    try {
      if (this.instagramBot && this.instagramBot.isRunning) {
        await this.instagramBot.disconnect();
        logger.info('✅ Instagram Bot disconnected.');
      }
    } catch (error) {
      logger.error('❌ Error during bot disconnect:', error.message);
    }
    logger.info('✅ Hyper Insta stopped.');
  }

  async start() {
    await this.initialize();

    // Handle shutdown signals
    const shutdownSignals = ['SIGINT', 'SIGTERM'];
    shutdownSignals.forEach(signal => {
      process.on(signal, async () => {
        logger.info(`\n🛑 Received ${signal}, shutting down gracefully...`);
        await this.shutdown();
        process.exit(0);
      });
    });

    // Handle unhandled promise rejections (robustness)
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason.message || reason);
      // Application specific logging, throwing an error, or other logic here
    });

    // Handle uncaught exceptions (robustness)
    process.on('uncaughtException', (err) => {
      logger.error('💥 Uncaught Exception:', err.message);
      logger.debug('Uncaught Exception Stack:', err.stack);
      // Close resources gracefully then exit
      this.shutdown().finally(() => {
        process.exit(1); // Exit with error code
      });
    });
  }
}

// Ensure the script runs only when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const app = new HyperInsta();
    app.start().catch((error) => {
        console.error('❌ Fatal error in main application loop:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    });
} else {
    console.log('[Index] Script imported as module, not executing main().');
}

// Export for potential external usage (though less common for main index)
// export { HyperInsta };
