import { InstagramBot } from './core/bot.js';
import { TelegramBridge } from './telegram/bridge.js';
import { logger } from './utils/utils.js';
import { config } from './config.js';
import { ModuleManager } from './core/module-manager.js'; 
import { MessageHandler } from './core/message-handler.js'; 
console.clear();

class HyperInsta {
  constructor() {
    this.startTime = new Date();
    this.instagramBot = new InstagramBot();
    this.telegramBridge = config.telegram.enabled ? new TelegramBridge() : null;
  }


  async initialize() {
    try {
      this.showStartupBanner();

      console.log('📱 Connecting to Instagram...');
      await this.instagramBot.login();
      console.log('✅ Instagram connected');

      if (this.telegramBridge) {
        console.log('📨 Initializing Telegram...');
        await this.telegramBridge.initialize();
        console.log('✅ Telegram connected');
      }

      console.log('🔌 Loading modules...');
      const moduleManager = new ModuleManager(this.instagramBot); // Pass the bot instance
      await moduleManager.loadModules();
      console.log('✅ Modules loaded');

      // 2. Initialize Message Handler (like in bot.js main)
      // Pass the bot instance, the moduleManager instance, and the telegramBridge (or null)
      const messageHandler = new MessageHandler(this.instagramBot, moduleManager, this.telegramBridge);

      // 3. Connect the Bot's message events to the Message Handler (CRUCIAL PART)
      // This links the bot's internal message processing to your modular system
      this.instagramBot.onMessage((message) => messageHandler.handleMessage(message));
      console.log('📨 Message handler connected');

      console.log('✅ Bot is now LIVE and ready!');

      this.showLiveStatus();

    } catch (error) {
      console.error(`❌ Startup failed: ${error.message}`); // Use console.error for errors
      console.debug(error.stack); // Log stack trace for debugging
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
    const uptime = Date.now() - this.startTime;
    console.clear();
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║    🚀 HYPER INSTA - LIVE & OPERATIONAL                     ║
║                                                              ║
║    ✅ Instagram: Connected & Active                         ║
║    ${this.telegramBridge ? '✅' : '❌'} Telegram: ${this.telegramBridge ? 'Connected & Bridged' : 'Disabled'}                        ║
║    ⚡ Startup Time: ${Math.round(uptime)}ms                                  ║
║    🕒 Started: ${this.startTime.toLocaleTimeString()}                                ║
║                                                              ║
║    🎯 Ready for INSTANT commands...                        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

🔥 Bot is running at MAXIMUM PERFORMANCE!
💡 Type .help in Instagram to see all commands
    `);
  }

  async start() {
    await this.initialize();

    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down gracefully...');
      await this.instagramBot.disconnect();
      console.log('✅ Hyper Insta stopped');
      process.exit(0);
    });
  }
}

const bot = new HyperInsta();
bot.start().catch(console.error);
