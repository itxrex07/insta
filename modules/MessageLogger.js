import { logger, fileUtils } from '../core/utils.js';
import { config } from '../config.js';

export class MessageLoggerModule {
  constructor() {
    this.name = 'MessageLogger';
    this.messages = [];
    this.commandPrefix = '.';
    this.commands = {
      'search': {
        description: 'Search message logs',
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
        description: 'Toggle message logging on/off',
        usage: '.logger [on|off]',
        handler: this.handleLogger.bind(this),
        adminOnly: true
      }
    };
    
    this.loadMessages();
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

      // Log message
      if (config.modules.messageLogger.enabled) {
        await this.logMessage(message);
      }

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
    const query = args.join(' ').toLowerCase();
    if (!query) {
      await this.sendReply(message, '❌ Please provide a search query');
      return;
    }

    const results = this.messages.filter(msg => 
      msg.text.toLowerCase().includes(query) ||
      msg.sender.toLowerCase().includes(query)
    ).slice(-10); // Last 10 results

    if (results.length === 0) {
      await this.sendReply(message, `🔍 No messages found for: "${query}"`);
      return;
    }

    const resultText = results.map(msg => 
      `@${msg.sender}: ${msg.text.substring(0, 50)}${msg.text.length > 50 ? '...' : ''}`
    ).join('\n');

    await this.sendReply(message, `🔍 **Search Results (${results.length})**\n\n${resultText}`);
  }

  async handleRecent(args, message) {
    const count = parseInt(args[0]) || 10;
    const recentMessages = this.messages.slice(-count);

    if (recentMessages.length === 0) {
      await this.sendReply(message, '📝 No recent messages found');
      return;
    }

    const messageText = recentMessages.map(msg => 
      `@${msg.sender}: ${msg.text.substring(0, 50)}${msg.text.length > 50 ? '...' : ''}`
    ).join('\n');

    await this.sendReply(message, `📝 **Recent Messages (${recentMessages.length})**\n\n${messageText}`);
  }

  async handleLogger(args, message) {
    const action = args[0]?.toLowerCase();
    
    if (action === 'on') {
      config.modules.messageLogger.enabled = true;
      await this.sendReply(message, '✅ Message logging enabled');
      logger.info('📝 Message logging enabled by admin');
    } else if (action === 'off') {
      config.modules.messageLogger.enabled = false;
      await this.sendReply(message, '❌ Message logging disabled');
      logger.info('📝 Message logging disabled by admin');
    } else {
      const status = config.modules.messageLogger.enabled ? 'enabled' : 'disabled';
      const count = this.messages.length;
      await this.sendReply(message, `📝 Message logging is currently ${status}\nLogged messages: ${count}\nUse \`.logger on\` or \`.logger off\` to toggle`);
    }
  }

  async logMessage(message) {
    const logEntry = {
      id: message.id,
      text: message.text || '[Media]',
      sender: message.senderUsername,
      timestamp: message.timestamp,
      threadId: message.threadId
    };

    this.messages.push(logEntry);

    // Keep only the last N messages
    if (this.messages.length > config.modules.messageLogger.maxLogSize) {
      this.messages = this.messages.slice(-config.modules.messageLogger.maxLogSize);
    }

    // Save to file periodically
    if (this.messages.length % 10 === 0) {
      await this.saveMessages();
    }
  }

  async loadMessages() {
    try {
      const messages = await fileUtils.readJson(config.modules.messageLogger.logPath);
      if (messages && Array.isArray(messages)) {
        this.messages = messages;
        logger.info(`📝 Loaded ${this.messages.length} logged messages`);
      }
    } catch (error) {
      logger.warn('⚠️ Could not load message logs:', error.message);
    }
  }

  async saveMessages() {
    try {
      await fileUtils.writeJson(config.modules.messageLogger.logPath, this.messages);
    } catch (error) {
      logger.error('❌ Failed to save message logs:', error);
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
    return config.admin.users.includes(username.toLowerCase());
  }

  getCommands() {
    return this.commands;
  }

  async cleanup() {
    await this.saveMessages();
    logger.info('🧹 MessageLogger module cleaned up');
  }
}