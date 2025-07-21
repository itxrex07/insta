import { logger, messageUtils } from '../utils.js';
import { config } from '../config.js';

export class MessageFilterPlugin {
  constructor() {
    this.name = 'MessageFilter';
    this.config = config.plugins.messageFilter;
    this.blockedCount = 0;
  }

  async process(message) {
    try {
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
      logger.error('Error in MessageFilter plugin:', error);
    }

    return message;
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

  getStats() {
    return {
      blockedCount: this.blockedCount,
      blockedUsers: this.config.blockedUsers.length,
      spamKeywords: this.config.spamKeywords.length
    };
  }

  async cleanup() {
    logger.info(`🧹 MessageFilter plugin cleaned up. Blocked ${this.blockedCount} messages`);
  }
}