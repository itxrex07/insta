import { logger, fileUtils, messageUtils } from '../utils.js';
import { config } from '../config.js';

export class MessageLoggerModule {
  constructor() {
    this.name = 'MessageLogger';
    this.config = config.plugins.messageLogger;
    this.messages = [];
    this.loggedCount = 0;
    this.commandPrefix = '.';
    this.commands = {
      'search': {
        description: 'Search through message logs',
        usage: '.search <query>',
        handler: this.handleSearch.bind(this),
        adminOnly: true
      },
      'recent': {
        description: 'Show recent messages',
        usage: '.recent [count]',
        handler: this.handleRecent.bind(this),
        adminOnly: true
      },
      'logger': {
        description: 'Toggle message logger on/off',
        usage: '.logger [on|off]',
        handler: this.handleLogger.bind(this),
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

      // Skip if message logger is disabled
      if (!this.config.enabled) {
        return message;
      }

      // Format and store the message
      const formattedMessage = messageUtils.formatMessage(message);
      formattedMessage.logged_at = new Date().toISOString();
      
      this.messages.push(formattedMessage);
      this.loggedCount++;

      // Save to file periodically or when reaching max size
      if (this.messages.length >= this.config.maxLogSize || this.loggedCount % 10 === 0) {
        await this.saveMessages();
      }

      logger.debug(`📝 Logged message from @${message.senderUsername}`);

    } catch (error) {
      logger.error('Error in MessageLogger module:', error);
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
      logger.error(`Error executing MessageLogger command ${commandName}:`, error);
    }
  }

  async handleSearch(args, message) {
    const query = args.join(' ');
    if (!query) {
      await this.sendReply(message, '❌ Please provide a search query');
      return;
    }

    const results = await this.searchMessages(query, 10);
    if (results.length === 0) {
      await this.sendReply(message, `🔍 No messages found for "${query}"`);
      return;
    }

    const resultList = results.map(msg => 
      `• @${msg.sender}: ${msg.text.substring(0, 50)}${msg.text.length > 50 ? '...' : ''}`
    ).join('\n');

    await this.sendReply(message, `🔍 **Search Results for "${query}" (${results.length})**\n\n${resultList}`);
  }

  async handleRecent(args, message) {
    const count = parseInt(args[0]) || 10;
    const recentMessages = await this.getMessages(count);
    
    if (recentMessages.length === 0) {
      await this.sendReply(message, '📝 No recent messages available');
      return;
    }

    const messageList = recentMessages.map(msg => 
      `• @${msg.sender}: ${msg.text.substring(0, 50)}${msg.text.length > 50 ? '...' : ''}`
    ).join('\n');

    await this.sendReply(message, `📝 **Recent Messages (${recentMessages.length})**\n\n${messageList}`);
  }

  async handleLogger(args, message) {
    const action = args[0]?.toLowerCase();
    
    if (action === 'on') {
      this.config.enabled = true;
      await this.sendReply(message, '✅ Message logger enabled');
      logger.info('📝 Message logger enabled by admin');
    } else if (action === 'off') {
      this.config.enabled = false;
      await this.sendReply(message, '❌ Message logger disabled');
      logger.info('📝 Message logger disabled by admin');
    } else {
      const status = this.config.enabled ? 'enabled' : 'disabled';
      await this.sendReply(message, `📝 Message logger is currently ${status}\nUse \`.logger on\` or \`.logger off\` to toggle`);
    }
  }

  async saveMessages() {
    try {
      // Load existing messages
      let existingMessages = [];
      if (await fileUtils.pathExists(this.config.logPath)) {
        existingMessages = await fileUtils.readJson(this.config.logPath) || [];
      }

      // Combine with new messages
      const allMessages = [...existingMessages, ...this.messages];

      // Keep only the latest messages (within max log size)
      const messagesToKeep = allMessages.slice(-this.config.maxLogSize);

      // Save to file
      await fileUtils.writeJson(this.config.logPath, messagesToKeep);

      logger.info(`💾 Saved ${this.messages.length} messages to log file`);
      
      // Clear the buffer
      this.messages = [];

    } catch (error) {
      logger.error('Error saving messages to log:', error);
    }
  }

  async getMessages(limit = 50) {
    try {
      if (await fileUtils.pathExists(this.config.logPath)) {
        const messages = await fileUtils.readJson(this.config.logPath) || [];
        return messages.slice(-limit);
      }
      return [];
    } catch (error) {
      logger.error('Error reading messages from log:', error);
      return [];
    }
  }

  async searchMessages(query, limit = 20) {
    try {
      const messages = await this.getMessages(1000);
      const filtered = messages.filter(msg => 
        msg.text.toLowerCase().includes(query.toLowerCase()) ||
        msg.sender.toLowerCase().includes(query.toLowerCase())
      );
      return filtered.slice(-limit);
    } catch (error) {
      logger.error('Error searching messages:', error);
      return [];
    }
  }

  async sendReply(message, text) {
    try {
      logger.info(`🤖 MessageLogger reply to @${message.senderUsername}: ${text}`);
    } catch (error) {
      logger.error('Error sending MessageLogger reply:', error);
    }
  }

  isAdmin(username) {
    const adminUsers = (process.env.ADMIN_USERS || '').split(',').filter(Boolean);
    return adminUsers.includes(username.toLowerCase());
  }

  getStats() {
    return {
      loggedCount: this.loggedCount,
      bufferedMessages: this.messages.length,
      logPath: this.config.logPath
    };
  }

  getCommands() {
    return this.commands;
  }

  async cleanup() {
    // Save any remaining messages
    if (this.messages.length > 0) {
      await this.saveMessages();
    }
    logger.info(`🧹 MessageLogger module cleaned up. Logged ${this.loggedCount} messages total`);
  }
}