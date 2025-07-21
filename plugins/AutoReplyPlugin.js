import { logger, messageUtils, randomUtils } from '../utils.js';
import { config } from '../config.js';

export class AutoReplyPlugin {
  constructor() {
    this.name = 'AutoReply';
    this.config = config.plugins.autoReply;
    this.repliedMessages = new Set();
  }

  async process(message) {
    try {
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
      logger.error('Error in AutoReply plugin:', error);
    }

    return message;
  }

  async sendAutoReply(message) {
    try {
      const response = randomUtils.choice(this.config.responses);
      
      // In a real implementation, you would send the reply through the Instagram bot
      logger.info(`🤖 Auto-reply to @${message.senderUsername}: ${response}`);
      
      // Simulate sending reply (you would implement actual sending here)
      // await instagramBot.sendMessage(message.threadId, response);
      
    } catch (error) {
      logger.error('Error sending auto-reply:', error);
    }
  }

  async cleanup() {
    this.repliedMessages.clear();
    logger.info('🧹 AutoReply plugin cleaned up');
  }
}