import { logger } from '../utils/utils.js';
import { config } from '../config.js';

export class MessageHandler {
  constructor(instagramBot, moduleManager, telegramBridge = null) {
    this.instagramBot = instagramBot;
    this.moduleManager = moduleManager;
    this.telegramBridge = telegramBridge;
  }

  async handleMessage(message) {
    try {
      // Process through modules for stats/logging
      message = await this.moduleManager.processMessage(message);

      // Handle commands INSTANTLY
      if (message.content?.startsWith('.')) {
        await this.handleCommand(message);
        return;
      }

      // Forward to Telegram if enabled
      if (this.telegramBridge?.enabled && config.telegram.enabled) {
        await this.telegramBridge.forwardMessage(message);
      }

    } catch (error) {
      logger.error('Message handling error:', error.message);
    }
  }

  async handleCommand(message) {
    const commandText = message.content.slice(1).trim();
    const [commandName, ...args] = commandText.split(' ');
    const command = this.moduleManager.getCommand(commandName);

    if (!command) return;

    // Admin check
    if (command.adminOnly && !this.isAdmin(message.author?.username)) {
      await this.instagramBot.sendMessage(message.chatId, '❌ Admin only');
      return;
    }

    try {
      // Log command execution
      logger.info(`⚡ Command executed: .${commandName} by @${message.author?.username}`);
      
      // Execute command INSTANTLY
      await command.handler(args, message);
      
    } catch (error) {
      logger.error(`Command ${commandName} error:`, error.message);
      await this.instagramBot.sendMessage(message.chatId, `❌ Error: ${error.message}`);
    }
  }

  isAdmin(username) {
    if (!username) return false;
    return config.admin.users.includes(username.toLowerCase());
  }
}
