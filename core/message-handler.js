import { logger } from '../utils/utils.js';
import { config } from '../config.js';

export class MessageHandler {
  constructor(instagramBot, moduleManager, telegramBridge) {
    this.instagramBot = instagramBot;
    this.moduleManager = moduleManager;
    this.telegramBridge = telegramBridge;
    this.commandRegistry = new Map();
    this.buildCommandRegistry();
  }

  buildCommandRegistry() {
    this.commandRegistry.clear();
    
    for (const module of this.moduleManager.modules) {
      const commands = module.getCommands();
      for (const [name, command] of Object.entries(commands)) {
        this.commandRegistry.set(name.toLowerCase(), {
          ...command,
          module: module,
          moduleName: module.name
        });
      }
    }
  }

  async handleMessage(message) {
    try {
      // Process through modules first (for logging, stats, etc.)
      let processedMessage = { ...message };
      for (const module of this.moduleManager.modules) {
        processedMessage = await module.process(processedMessage);
      }

      // Check for commands
      if (message.text?.startsWith('.')) {
        await this.handleCommand(message);
        return;
      }

      // Forward to Telegram if enabled
      if (this.telegramBridge?.enabled && config.telegram.enabled) {
        await this.telegramBridge.forwardMessage(processedMessage);
      }

    } catch (error) {
      logger.error('Message handling error:', error.message);
    }
  }

  async handleCommand(message) {
    const commandText = message.text.slice(1).trim();
    const [commandName, ...args] = commandText.split(' ');
    const command = this.commandRegistry.get(commandName.toLowerCase());

    if (!command) return;

    // Admin check
    if (command.adminOnly && !this.isAdmin(message.senderUsername)) {
      await this.instagramBot.sendMessage(message.threadId, '❌ Admin only');
      return;
    }

    try {
      await command.handler(args, message);
    } catch (error) {
      logger.error(`Command ${commandName} error:`, error.message);
      await this.instagramBot.sendMessage(message.threadId, `❌ Error: ${error.message}`);
    }
  }

  isAdmin(username) {
    return config.admin.users.includes(username.toLowerCase());
  }

  refreshCommands() {
    this.buildCommandRegistry();
  }
}
