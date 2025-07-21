import { logger, messageUtils } from '../utils.js';
import { config } from '../config.js';

export class MessageFilterModule {
  constructor() {
    this.name = 'MessageFilter';
    this.config = config.plugins.messageFilter;
    this.blockedCount = 0;
    this.commandPrefix = '.';
    this.commands = {
      'block': {
        description: 'Block a user from forwarding messages',
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
        description: 'List all blocked users',
        usage: '.blocked',
        handler: this.handleBlocked.bind(this),
        adminOnly: true
      },
      'filter': {
        description: 'Toggle message filter on/off',
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

      // Skip if message filter is disabled
      if (!this.config.enabled) {
        return message;
      }

      // Check if user is blocked
      if (this.isUserBlocked(message.senderUsername)) {
        logger.info(`🚫 Blocked message from @${message.senderUsername}`);
        message.shouldForward = false;
        this.blockedCount++;
        return message;
      }

      // Check for spam content
      if (messageUtils.isSpam(message.text, this.config.spamKeywords)) {
        logger.info(`🚫 Blocked spam message from @${message.senderUsername}: "${message.text}"`);
        message.shouldForward = false;
        this.blockedCount++;
        return message;
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

    this.blockUser(username);
    await this.sendReply(message, `🚫 Blocked user @${username}`);
  }

  async handleUnblock(args, message) {
    const username = args[0];
    if (!username) {
      await this.sendReply(message, '❌ Please provide a username to unblock');
      return;
    }

    this.unblockUser(username);
    await this.sendReply(message, `✅ Unblocked user @${username}`);
  }

  async handleBlocked(args, message) {
    if (this.config.blockedUsers.length === 0) {
      await this.sendReply(message, '📝 No users are currently blocked');
      return;
    }

    const blockedList = this.config.blockedUsers.map(user => `• @${user}`).join('\n');
    await this.sendReply(message, `🚫 **Blocked Users (${this.config.blockedUsers.length})**\n\n${blockedList}`);
  }

  async handleFilter(args, message) {
    const action = args[0]?.toLowerCase();
    
    if (action === 'on') {
      this.config.enabled = true;
      await this.sendReply(message, '✅ Message filter enabled');
      logger.info('🚫 Message filter enabled by admin');
    } else if (action === 'off') {
      this.config.enabled = false;
      await this.sendReply(message, '❌ Message filter disabled');
      logger.info('🚫 Message filter disabled by admin');
    } else {
      const status = this.config.enabled ? 'enabled' : 'disabled';
      await this.sendReply(message, `🚫 Message filter is currently ${status}\nUse \`.filter on\` or \`.filter off\` to toggle`);
    }
  }

  isUserBlocked(username) {
    return this.config.blockedUsers.includes(username.toLowerCase());
  }

  blockUser(username) {
    if (!this.isUserBlocked(username)) {
      this.config.blockedUsers.push(username.toLowerCase());
      logger.info(`🚫 Added @${username} to blocked users list`);
    }
  }

  unblockUser(username) {
    const index = this.config.blockedUsers.indexOf(username.toLowerCase());
    if (index > -1) {
      this.config.blockedUsers.splice(index, 1);
      logger.info(`✅ Removed @${username} from blocked users list`);
    }
  }

  async sendReply(message, text) {
    try {
      logger.info(`🤖 MessageFilter reply to @${message.senderUsername}: ${text}`);
    } catch (error) {
      logger.error('Error sending MessageFilter reply:', error);
    }
  }

  isAdmin(username) {
    const adminUsers = (process.env.ADMIN_USERS || '').split(',').filter(Boolean);
    return adminUsers.includes(username.toLowerCase());
  }

  getStats() {
    return {
      blockedCount: this.blockedCount,
      blockedUsers: this.config.blockedUsers.length,
      spamKeywords: this.config.spamKeywords.length
    };
  }

  getCommands() {
    return this.commands;
  }

  async cleanup() {
    logger.info(`🧹 MessageFilter module cleaned up. Blocked ${this.blockedCount} messages`);
  }
}