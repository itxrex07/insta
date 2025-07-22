import { logger } from '../core/utils.js';
import { config } from '../config.js';
import { messageUtils } from '../core/utils.js';

export class MessageFilterModule {
  constructor() {
    this.name = 'MessageFilter';
    this.commandPrefix = '.';
    this.commands = {
      'block': {
        description: 'Block a user from sending messages',
        usage: '.block <username>',
        handler: this.handleBlock.bind(this),
        adminOnly: true
      },
      'unblock': {
        description: 'Unblock a user',
        usage: '.unblock <username>',
        handler: this.handleUnblock.bind(this),
        adminOnly: true
      },
      'blocked': {
        description: 'List blocked users',
        usage: '.blocked',
        handler: this.handleBlocked.bind(this),
        adminOnly: true
      },
      'filter': {
        description: 'Toggle message filtering on/off',
        usage: '.filter [on|off]',
        handler: this.handleFilter.bind(this),
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

      // Filter logic
      if (config.modules.messageFilter.enabled) {
        const shouldBlock = this.shouldBlockMessage(message);
        if (shouldBlock) {
          logger.info(`🚫 Blocked message from @${message.senderUsername}: ${message.text}`);
          message.shouldForward = false;
        }
      }

    } catch (error) {
      logger.error('Error in MessageFilter module:', error);
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
      logger.error(`Error executing MessageFilter command ${commandName}:`, error);
    }
  }

  async handleBlock(args, message) {
    const username = args[0];
    if (!username) {
      await this.sendReply(message, '❌ Please provide a username to block');
      return;
    }

    if (!config.modules.messageFilter.blockedUsers.includes(username.toLowerCase())) {
      config.modules.messageFilter.blockedUsers.push(username.toLowerCase());
      await this.sendReply(message, `🚫 Blocked user: @${username}`);
      logger.info(`🚫 Admin blocked user: @${username}`);
    } else {
      await this.sendReply(message, `⚠️ User @${username} is already blocked`);
    }
  }

  async handleUnblock(args, message) {
    const username = args[0];
    if (!username) {
      await this.sendReply(message, '❌ Please provide a username to unblock');
      return;
    }

    const index = config.modules.messageFilter.blockedUsers.indexOf(username.toLowerCase());
    if (index > -1) {
      config.modules.messageFilter.blockedUsers.splice(index, 1);
      await this.sendReply(message, `✅ Unblocked user: @${username}`);
      logger.info(`✅ Admin unblocked user: @${username}`);
    } else {
      await this.sendReply(message, `⚠️ User @${username} is not blocked`);
    }
  }

  async handleBlocked(args, message) {
    const blockedUsers = config.modules.messageFilter.blockedUsers;
    
    if (blockedUsers.length === 0) {
      await this.sendReply(message, '📋 No users are currently blocked');
      return;
    }

    const userList = blockedUsers.map(user => `• @${user}`).join('\n');
    await this.sendReply(message, `🚫 **Blocked Users (${blockedUsers.length})**\n\n${userList}`);
  }

  async handleFilter(args, message) {
    const action = args[0]?.toLowerCase();
    
    if (action === 'on') {
      config.modules.messageFilter.enabled = true;
      await this.sendReply(message, '✅ Message filtering enabled');
      logger.info('🔍 Message filtering enabled by admin');
    } else if (action === 'off') {
      config.modules.messageFilter.enabled = false;
      await this.sendReply(message, '❌ Message filtering disabled');
      logger.info('🔍 Message filtering disabled by admin');
    } else {
      const status = config.modules.messageFilter.enabled ? 'enabled' : 'disabled';
      await this.sendReply(message, `🔍 Message filtering is currently ${status}\nUse \`.filter on\` or \`.filter off\` to toggle`);
    }
  }

  shouldBlockMessage(message) {
    const username = message.senderUsername.toLowerCase();
    const text = message.text || '';

    // Check if user is blocked
    if (config.modules.messageFilter.blockedUsers.includes(username)) {
      return true;
    }

    // Check for spam keywords
    if (messageUtils.isSpam(text, config.modules.messageFilter.spamKeywords)) {
      return true;
    }

    return false;
  }

  async sendReply(message, text) {
    try {
      logger.info(`🤖 MessageFilter reply to @${message.senderUsername}: ${text}`);
    } catch (error) {
      logger.error('Error sending MessageFilter reply:', error);
    }
  }

  isAdmin(username) {
    return config.admin.users.includes(username.toLowerCase());
  }

  getCommands() {
    return this.commands;
  }

  async cleanup() {
    logger.info('🧹 MessageFilter module cleaned up');
  }
}