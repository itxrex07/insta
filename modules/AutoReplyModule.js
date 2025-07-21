import { logger, messageUtils, randomUtils } from '../utils.js';
import { config } from '../config.js';

export class AutoReplyModule {
  constructor() {
    this.name = 'AutoReply';
    this.config = config.plugins.autoReply;
    this.repliedMessages = new Set();
    this.commandPrefix = '.';
    this.commands = {
      'autoreply': {
        description: 'Toggle auto-reply on/off',
        usage: '.autoreply [on|off]',
        handler: this.handleAutoReply.bind(this),
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

      // Skip if auto-reply is disabled
      if (!this.config.enabled) {
        return message;
      }

      // Skip if we already replied to this message
      if (this.repliedMessages.has(message.id)) {
        return message;
      }

      // Check if message contains a greeting
      if (messageUtils.containsGreeting(message.text, this.config.greetings)) {
        await this.sendAutoReply(message);
        this.repliedMessages.add(message.id);
        
        // Clean up old replied messages (keep only last 100)
        if (this.repliedMessages.size > 100) {
          const oldMessages = Array.from(this.repliedMessages).slice(0, 50);
          oldMessages.forEach(id => this.repliedMessages.delete(id));
        }
      }

    } catch (error) {
      logger.error('Error in AutoReply module:', error);
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
      logger.error(`Error executing AutoReply command ${commandName}:`, error);
    }
  }

  async handleAutoReply(args, message) {
    const action = args[0]?.toLowerCase();
    
    if (action === 'on') {
      this.config.enabled = true;
      await this.sendReply(message, '✅ Auto-reply enabled');
      logger.info('🤖 Auto-reply enabled by admin');
    } else if (action === 'off') {
      this.config.enabled = false;
      await this.sendReply(message, '❌ Auto-reply disabled');
      logger.info('🤖 Auto-reply disabled by admin');
    } else {
      const status = this.config.enabled ? 'enabled' : 'disabled';
      await this.sendReply(message, `🤖 Auto-reply is currently ${status}\nUse \`.autoreply on\` or \`.autoreply off\` to toggle`);
    }
  }

  async sendAutoReply(message) {
    try {
      const response = randomUtils.choice(this.config.responses);
      
      logger.info(`🤖 Auto-reply to @${message.senderUsername}: ${response}`);
      
      // In a real implementation, you would send the reply through the Instagram bot
      // await instagramBot.sendMessage(message.threadId, response);
      
    } catch (error) {
      logger.error('Error sending auto-reply:', error);
    }
  }

  async sendReply(message, text) {
    try {
      logger.info(`🤖 AutoReply reply to @${message.senderUsername}: ${text}`);
    } catch (error) {
      logger.error('Error sending AutoReply reply:', error);
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
    this.repliedMessages.clear();
    logger.info('🧹 AutoReply module cleaned up');
  }
}