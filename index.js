import { InstagramBot } from './core/bot.js';
import { TelegramBridge } from './tg-bridge/bridge.js';
import { ModuleManager } from './core/module-manager.js';
import { logger } from './core/utils.js';
import { config } from './config.js';

console.clear();
console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║    🚀 HYPER INSTA - Advanced Instagram Bot                  ║
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
      this.displayStatus('🔄 Connecting to Instagram...');
      await this.instagramBot.login();
      this.displayStatus('✅ Instagram Connected');
      
      if (config.telegram.enabled) {
        this.displayStatus('🔄 Initializing Telegram...');
        await this.telegramBridge.initialize();
        this.displayStatus('✅ Telegram Connected');
      }
      
      this.displayStatus('🔄 Loading Modules...');
      await this.moduleManager.loadModules();
      this.displayStatus('✅ Modules Loaded');
      
      this.displayStatus('🔄 Setting up Handlers...');
      this.instagramBot.setupMessageHandlers(this.moduleManager, this.telegramBridge);
      this.instagramBot.startMessageListener();
      this.displayStatus('✅ Bot Ready');
      
      this.isInitialized = true;
      this.displaySuccessScreen();
      
    } catch (error) {
      this.displayError('❌ Initialization Failed', error);
      process.exit(1);
    }
  }

  displayStatus(message) {
    console.log(`\n${message}`);
  }

  displayError(message, error) {
    console.log(`\n${message}: ${error.message}`);
    logger.error(message, error);
  }

  displaySuccessScreen() {
    const uptime = new Date() - this.startTime;
    console.clear();
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║    🚀 HYPER INSTA - READY!                                  ║
║                                                              ║
║    ✅ Instagram: Connected                                   ║
║    ${config.telegram.enabled ? '✅' : '❌'} Telegram: ${config.telegram.enabled ? 'Active' : 'Disabled'}                                    ║
║    ✅ Modules: ${this.moduleManager.modules.length.toString().padEnd(2)} Loaded                                    ║
║                                                              ║
║    ⚡ Startup: ${Math.round(uptime)}ms                                    ║
║    🕒 Started: ${this.startTime.toLocaleTimeString()}                                ║
║                                                              ║
║    🎯 Listening for messages...                             ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
    
    logger.info('🚀 Hyper Insta is operational!');
  }

  async start() {
    await this.initialize();
    
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down...');
      await this.instagramBot.disconnect();
      await this.moduleManager.unloadModules();
      console.log('✅ Stopped gracefully');
      process.exit(0);
    });

    if (this.isInitialized) {
      setInterval(() => {
        const uptime = Math.floor((new Date() - this.startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        
        process.stdout.write(`\r⏱️  ${hours}h ${minutes}m ${seconds}s | 📊 ${this.moduleManager.modules.length} modules | 🟢 Running`);
      }, 1000);
    }
  }
}

const bot = new HyperInsta();
bot.start().catch(console.error);