import { logger } from '../core/utils.js';
import { config } from '../config.js';
import { randomUtils } from '../core/utils.js';

export class AutoReplyModule {
  constructor() {
    this.name = 'AutoReply';
    this.repliedUsers = new Set();
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

      // Auto-reply logic
      if (config.modules.autoReply.enabled && message.text) {
        await this.handleAutoReply(message);
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
    if (args && args.length > 0) {
      const action = args[0]?.toLowerCase();
      
      if (action === 'on') {
        config.modules.autoReply.enabled = true;
        await this.sendReply(message, '✅ Auto-reply enabled');
        logger.info('🤖 Auto-reply enabled by admin');
      } else if (action === 'off') {
        config.modules.autoReply.enabled = false;
        await this.sendReply(message, '❌ Auto-reply disabled');
        logger.info('🤖 Auto-reply disabled by admin');
      } else {
        const status = config.modules.autoReply.enabled ? 'enabled' : 'disabled';
        await this.sendReply(message, `🤖 Auto-reply is currently ${status}\nUse \`.autoreply on\` or \`.autoreply off\` to toggle`);
      }
      return;
    }

    // Auto-reply logic for regular messages
    if (!config.modules.autoReply.enabled) return;

    const username = message.senderUsername;
    const text = message.text.toLowerCase();

    // Check if message contains greeting
    const containsGreeting = config.modules.autoReply.greetings.some(greeting => 
      text.includes(greeting.toLowerCase())
    );

    if (containsGreeting && !this.repliedUsers.has(username)) {
      const response = randomUtils.choice(config.modules.autoReply.responses);
      
      // Get Instagram bot instance to send reply
      const coreModule = this.getCoreModule();
      if (coreModule && coreModule.instagramBot) {
        const success = await coreModule.instagramBot.sendMessage(message.threadId, response);
        if (success) {
          this.repliedUsers.add(username);
          logger.info(`🤖 Auto-replied to @${username}: ${response}`);
          
          // Remove from replied users after 1 hour
          setTimeout(() => {
            this.repliedUsers.delete(username);
          }, 3600000);
        }
      }
    }
  }

  getCoreModule() {
    // This would need to be injected or accessed through module manager
    // For now, we'll use a placeholder
    return null;
  }

  async sendReply(message, text) {
    try {
      logger.info(`🤖 AutoReply reply to @${message.senderUsername}: ${text}`);
    } catch (error) {
      logger.error('Error sending AutoReply reply:', error);
    }
  }

  isAdmin(username) {
    return config.admin.users.includes(username.toLowerCase());
  }

  getCommands() {
    return this.commands;
  }

  async cleanup() {
    logger.info('🧹 AutoReply module cleaned up');
  }
}