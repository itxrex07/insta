import { logger } from '../utils.js';

export class TelegramModule {
  constructor(telegramBridge) {
    this.name = 'Telegram';
    this.telegramBridge = telegramBridge;
    this.commandPrefix = '.';
    this.commands = {
      'telegram': {
        description: 'Toggle Telegram forwarding on/off',
        usage: '.telegram [on|off]',
        handler: this.handleTelegram.bind(this),
        adminOnly: true
      },
      'notify': {
        description: 'Send a notification to Telegram',
        usage: '.notify <message>',
        handler: this.handleNotify.bind(this),
        adminOnly: true
      }
    };
  }

  async process(message) {
    try {
      // Handle commands first
      if (message.text && message.text.startsWith(this.commandPrefix)) {
        const commandText = message.text.slice(this.commandPrefix.length).trim();
        const [commandName, ...args] = commandText.split(' ');
        
        if (this.commands[commandName.toLowerCase()]) {
          await this.executeCommand(commandName.toLowerCase(), args, message);
          message.shouldForward = false;
          return message;
        }
      }
    } catch (error) {
      logger.error('Error in Telegram module:', error);
    }

    return message;
  }

  async executeCommand(commandName, args, message) {
    try {
      const command = this.commands[commandName];
      
      if (command.adminOnly && !this.isAdmin(message.senderUsername)) {
        await this.sendReply(message, '❌ This command requires admin privileges.');
        return;
      }

      await command.handler(args, message);
    } catch (error) {
      logger.error(`Error executing Telegram command ${commandName}:`, error);
    }
  }

  async handleTelegram(args, message) {
    const action = args[0]?.toLowerCase();
    
    if (action === 'on') {
      // Enable Telegram forwarding
      await this.sendReply(message, '✅ Telegram forwarding enabled');
      logger.info('📱 Telegram forwarding enabled by admin');
    } else if (action === 'off') {
      // Disable Telegram forwarding
      await this.sendReply(message, '❌ Telegram forwarding disabled');
      logger.info('📱 Telegram forwarding disabled by admin');
    } else {
      await this.sendReply(message, `📱 Telegram module status\nUse \`.telegram on\` or \`.telegram off\` to toggle forwarding`);
    }
  }

  async handleNotify(args, message) {
    const notificationText = args.join(' ');
    if (!notificationText) {
      await this.sendReply(message, '❌ Please provide a notification message');
      return;
    }

    if (this.telegramBridge) {
      await this.telegramBridge.sendNotification(notificationText);
      await this.sendReply(message, '✅ Notification sent to Telegram');
    } else {
      await this.sendReply(message, '❌ Telegram bridge not available');
    }
  }

  async sendReply(message, text) {
    try {
      logger.info(`🤖 Telegram module reply to @${message.senderUsername}: ${text}`);
    } catch (error) {
      logger.error('Error sending Telegram module reply:', error);
    }
  }

  isAdmin(username) {
    const adminUsers = (process.env.ADMIN_USERS || '').split(',').filter(Boolean);
    return adminUsers.includes(username.toLowerCase());
  }

  getCommands() {
    return this.commands;
  }

  async cleanup() {
    logger.info('🧹 Telegram module cleaned up');
  }
}