// Import necessary modules
import { InstagramBot } from './core/bot.js'; // Adjust path if needed
import { ModuleManager } from './core/module-manager.js'; // Adjust path if needed
import { MessageHandler } from './core/message-handler.js'; // Adjust path if needed
import { config } from './config.js'; // Assuming config.js is in the project root
import { logger } from './utils/utils.js'; // Assuming you have a logger utility

// Graceful Shutdown Handler
const shutdownHandler = async (botInstance) => {
  logger.info('👋 [SIGINT/SIGTERM] Shutting down gracefully...');
  if (botInstance) {
    try {
      await botInstance.disconnect();
      logger.info('🛑 Bot disconnected.');
    } catch (disconnectError) {
      logger.error('❌ Error during bot disconnect:', disconnectError.message);
    }
  }
  logger.info('🛑 Shutdown complete.');
  process.exit(0);
};

// Main Execution Function
async function run() {
  let bot = null;

  try {
    logger.info('🚀 Starting Instagram Bot...');

    // 1. Instantiate the core bot
    bot = new InstagramBot();

    // 2. Login to Instagram
    await bot.login();
    logger.info('🔓 Successfully logged into Instagram.');

    // 3. Initialize the Module Manager
    // Pass the bot instance so modules can interact with it
    const moduleManager = new ModuleManager(bot);
    await moduleManager.init(); // Use init which calls loadModules and sets up commandRegistry
    logger.info('🔌 Module Manager initialized.');

    // 4. Initialize the Message Handler
    // Pass the bot, moduleManager, and potentially a telegramBridge if you have one
    const telegramBridge = null; // Replace with actual bridge instance if needed
    const messageHandler = new MessageHandler(bot, moduleManager, telegramBridge);
    logger.info('📨 Message Handler initialized.');

    // 5. Connect the Bot's message event to the Message Handler
    // This links the bot's internal message processing to your modular system
    bot.onMessage((message) => messageHandler.handleMessage(message));
    logger.info('🔗 Connected Bot message events to Message Handler.');

    // 6. Start auxiliary features (like message request monitoring)
    if (config.monitorMessageRequests !== false) { // Optional config flag
        await bot.startMessageRequestsMonitor(config.messageRequestInterval || 300000);
    }

    // 7. Log that the bot is fully operational
    logger.info(`🚀 Instagram bot (@${bot.ig.state.cookieUsername}) is now running and listening for messages!`);
    // You could print available commands or other startup info here
    // const allCommands = moduleManager.getAllCommands();
    // logger.info(`Available commands: ${Array.from(allCommands.keys()).join(', ')}`);

    // 8. Setup Heartbeat (Optional, copied logic from bot.js main)
    const heartbeatInterval = setInterval(() => {
      logger.info(`💓 Bot heartbeat - Running: ${bot.isRunning}`);
    }, config.heartbeatInterval || 300000); // Default every 5 minutes

    // 9. Attach Graceful Shutdown Listeners
    process.on('SIGINT', () => shutdownHandler(bot));
    process.on('SIGTERM', () => shutdownHandler(bot));

    // 10. Keep the process alive (the realtime connection does this)
    // The bot's realtime connection keeps the event loop active.
    // If needed for other async operations, you might use a long-running loop or wait on a promise.

  } catch (error) {
    logger.error('❌ Fatal error during bot startup or execution:', error.message);
    logger.debug(error.stack); // Log stack trace in debug mode

    // Attempt cleanup if bot was partially initialized
    if (bot) {
      try {
        await bot.disconnect();
        logger.info('🧹 Cleanup disconnect attempted after error.');
      } catch (disconnectError) {
        logger.error('❌ Error during cleanup disconnect:', disconnectError.message);
      }
    }

    process.exit(1); // Exit with error code
  }
}

// Run the bot only if this file is executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    logger.error('❌ Unhandled error in main execution flow:', error.message);
    logger.debug(error.stack);
    process.exit(1);
  });
}

// Export run function for potential programmatic usage
export { run };
