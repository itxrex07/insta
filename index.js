import { InstagramBot } from './core/bot.js';
import { TelegramBridge } from './tg-bridge/bridge.js';
import { ModuleManager } from './core/module-manager.js';
import { logger } from './utils/utils.js';
import { config } from './config.js';

console.clear();

class HyperInsta {
  constructor() {
    this.startTime = new Date();
    this.instagramBot = new InstagramBot();
    this.telegramBridge = config.telegram.enabled ? new TelegramBridge() : null;
    this.moduleManager = new ModuleManager(this.instagramBot, this.telegramBridge);
  }

  async initialize() {
    try {
      console.log('🚀 Hyper Insta - Starting...\n');
      
      console.log('📱 Connecting to Instagram...');
      await this.instagramBot.login();
      console.log('✅ Instagram connected\n');
      
      if (this.telegramBridge) {
        console.log('📨 Initializing Telegram...');
        await this.telegramBridge.initialize();
        console.log('✅ Telegram connected\n');
      }
      
      console.log('🔌 Loading modules...');
      await this.moduleManager.loadModules();
      console.log(`✅ ${this.moduleManager.modules.length} modules loaded\n`);
      
      console.log('⚡ Setting up handlers...');
      this.instagramBot.setupMessageHandlers(this.moduleManager, this.telegramBridge);
      this.instagramBot.startMessageListener();
      console.log('✅ Bot ready\n');
      
      this.showStatus();
      
    } catch (error) {
      console.log(`❌ Failed: ${error.message}`);
      process.exit(1);
    }
  }

  showStatus() {
    const uptime = Date.now() - this.startTime;
    console.clear();
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║    🚀 HYPER INSTA - OPERATIONAL                             ║
║                                                              ║
║    ✅ Instagram: Connected                                   ║
║    ${this.telegramBridge ? '✅' : '❌'} Telegram: ${this.telegramBridge ? 'Active' : 'Disabled'}                                    ║
║    ✅ Modules: ${this.moduleManager.modules.length.toString().padEnd(2)} Loaded                                    ║
║                                                              ║
║    ⚡ Startup: ${Math.round(uptime)}ms                                    ║
║    🕒 Started: ${this.startTime.toLocaleTimeString()}                                ║
║                                                              ║
║    🎯 Ready for commands...                                 ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
  }

  async start() {
    await this.initialize();
    
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down...');
      await this.instagramBot.disconnect();
      await this.moduleManager.unloadModules();
      console.log('✅ Stopped');
      process.exit(0);
    });

    // Live status updates
    setInterval(() => {
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;
      
      process.stdout.write(`\r⏱️  ${hours}h ${minutes}m ${seconds}s | 🔌 ${this.moduleManager.modules.length} modules | 🟢 Online`);
    }, 1000);
  }
}

const bot = new HyperInsta();
bot.start().catch(console.error);
