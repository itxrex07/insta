import { logger, fileUtils } from '../utils.js';

export class UserStatsModule {
  constructor() {
    this.name = 'UserStats';
    this.userStats = new Map();
    this.commandPrefix = '.';
    this.commands = {
      'userstats': {
        description: 'Show statistics for a specific user',
        usage: '.userstats [username]',
        handler: this.handleUserStats.bind(this),
        adminOnly: true
      },
      'topusers': {
        description: 'Show most active users',
        usage: '.topusers [count]',
        handler: this.handleTopUsers.bind(this),
        adminOnly: true
      },
      'mystats': {
        description: 'Show your own statistics',
        usage: '.mystats',
        handler: this.handleMyStats.bind(this)
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

      // Track user statistics
      this.updateUserStats(message);

    } catch (error) {
      logger.error('Error in UserStats module:', error);
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
      logger.error(`Error executing UserStats command ${commandName}:`, error);
    }
  }

  async handleUserStats(args, message) {
    const username = args[0] || message.senderUsername;
    const stats = this.userStats.get(username.toLowerCase());
    
    if (!stats) {
      await this.sendReply(message, `📊 No statistics found for @${username}`);
      return;
    }

    const statsMessage = `📊 **Statistics for @${username}**\n\n` +
      `💬 Total Messages: ${stats.messageCount}\n` +
      `📸 Media Sent: ${stats.mediaCount}\n` +
      `🎯 Commands Used: ${stats.commandCount}\n` +
      `📅 First Seen: ${stats.firstSeen.toLocaleDateString()}\n` +
      `🕒 Last Active: ${stats.lastActive.toLocaleDateString()}\n` +
      `📈 Average Messages/Day: ${this.getAverageMessagesPerDay(stats)}`;

    await this.sendReply(message, statsMessage);
  }

  async handleTopUsers(args, message) {
    const count = parseInt(args[0]) || 10;
    const sortedUsers = Array.from(this.userStats.entries())
      .sort(([,a], [,b]) => b.messageCount - a.messageCount)
      .slice(0, count);

    if (sortedUsers.length === 0) {
      await this.sendReply(message, '📊 No user statistics available');
      return;
    }

    const userList = sortedUsers.map(([username, stats], index) => 
      `${index + 1}. @${username} - ${stats.messageCount} messages`
    ).join('\n');

    await this.sendReply(message, `🏆 **Top ${count} Most Active Users**\n\n${userList}`);
  }

  async handleMyStats(args, message) {
    const stats = this.userStats.get(message.senderUsername.toLowerCase());
    
    if (!stats) {
      await this.sendReply(message, '📊 No statistics found for you yet');
      return;
    }

    const statsMessage = `📊 **Your Statistics**\n\n` +
      `💬 Total Messages: ${stats.messageCount}\n` +
      `📸 Media Sent: ${stats.mediaCount}\n` +
      `🎯 Commands Used: ${stats.commandCount}\n` +
      `📅 Member Since: ${stats.firstSeen.toLocaleDateString()}\n` +
      `📈 Average Messages/Day: ${this.getAverageMessagesPerDay(stats)}`;

    await this.sendReply(message, statsMessage);
  }

  updateUserStats(message) {
    const username = message.senderUsername.toLowerCase();
    const now = new Date();
    
    if (!this.userStats.has(username)) {
      this.userStats.set(username, {
        messageCount: 0,
        mediaCount: 0,
        commandCount: 0,
        firstSeen: now,
        lastActive: now
      });
    }

    const stats = this.userStats.get(username);
    stats.messageCount++;
    stats.lastActive = now;

    if (message.media) {
      stats.mediaCount++;
    }

    if (message.text && message.text.startsWith(this.commandPrefix)) {
      stats.commandCount++;
    }
  }

  getAverageMessagesPerDay(stats) {
    const daysSinceFirstSeen = Math.max(1, Math.floor((Date.now() - stats.firstSeen.getTime()) / (1000 * 60 * 60 * 24)));
    return Math.round(stats.messageCount / daysSinceFirstSeen * 10) / 10;
  }

  async sendReply(message, text) {
    try {
      logger.info(`🤖 UserStats reply to @${message.senderUsername}: ${text}`);
    } catch (error) {
      logger.error('Error sending UserStats reply:', error);
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
    logger.info('🧹 UserStats module cleaned up');
  }
}