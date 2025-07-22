import { logger } from './utils.js';

export class MessageHandler {
  constructor(instagramBot, moduleManager, telegramBridge) {
    this.instagramBot = instagramBot;
    this.moduleManager = moduleManager;
    this.telegramBridge = telegramBridge;
    this.commandPrefix = '.';
    this.allCommands = new Map();
    this.setupCommands();
  }

  setupCommands() {
    // Build command registry from all modules
    for (const module of this.moduleManager.modules) {
      if (module.getCommands) {
        const commands = module.getCommands();
        for (const [name, command] of Object.entries(commands)) {
          this.allCommands.set(name.toLowerCase(), {
            ...command,
            module: module,
            moduleName: module.name || module.constructor.name
          });
        }
      }
    }
  }

  async handleMessage(message) {
    try {
      // Check if it's a command
      if (message.text && message.text.startsWith(this.commandPrefix)) {
        await this.handleCommand(message);
        return;
      }

      // Process through modules (non-command processing)
      let processedMessage = { ...message };
      for (const module of this.moduleManager.modules) {
        try {
          processedMessage = await module.process(processedMessage);
          if (!processedMessage.shouldForward) {
            break;
          }
        } catch (error) {
          logger.error(`Error in module ${module.constructor.name}:`, error);
        }
      }

      // Forward to Telegram if enabled
      if (processedMessage.shouldForward && this.telegramBridge && this.telegramBridge.enabled) {
        await this.telegramBridge.forwardMessage(processedMessage);
      }

    } catch (error) {
      logger.error('Error handling message:', error);
    }
  }

  async handleCommand(message) {
    try {
      const commandText = message.text.slice(this.commandPrefix.length).trim();
      const [commandName, ...args] = commandText.split(' ');
      const command = this.allCommands.get(commandName.toLowerCase());

      if (!command) {
        return; // Unknown command, ignore
      }

      // Check admin permissions
      if (command.adminOnly && !this.isAdmin(message.senderUsername)) {
        await this.sendReply(message, '❌ Admin access required');
        return;
      }

      // Execute command directly
      logger.info(`🎯 ${commandName} by @${message.senderUsername}`);
      await command.handler(args, message);

    } catch (error) {
      logger.error(`Error executing command:`, error);
      await this.sendReply(message, `❌ Command failed: ${error.message}`);
    }
  }

  async handleMedia(media) {
    try {
      if (this.telegramBridge && this.telegramBridge.enabled) {
        await this.telegramBridge.forwardMedia(media);
      }
    } catch (error) {
      logger.error('Error forwarding media:', error);
    }
  }

  async sendReply(message, text) {
    try {
      return await this.instagramBot.sendMessage(message.threadId, text);
    } catch (error) {
      logger.error('Error sending reply:', error);
      return false;
    }
  }

  isAdmin(username) {
    return config.admin.users.includes(username.toLowerCase());
  }

  refreshCommands() {
    this.allCommands.clear();
    this.setupCommands();
  }
}