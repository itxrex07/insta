import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { logger, fileUtils } from '../utils.js';
import { config } from '../config.js';

export class TelegramBridge {
  constructor() {
    this.bot = null;
    this.chatId = config.telegram.chatId;
    this.messageHandlers = [];
    this.replyToMessageMap = new Map(); // Map Telegram message IDs to Instagram thread info
  }

  async initialize() {
    try {
      if (!config.telegram.botToken) {
        logger.warn('⚠️ Telegram bot token not provided, skipping Telegram integration');
        return;
      }

      this.bot = new TelegramBot(config.telegram.botToken, { polling: false });
      
      // Test the connection
      const me = await this.bot.getMe();
      logger.info(`✅ Hyper Insta connected to Telegram as @${me.username}`);
      
      // Set up webhook or polling for bidirectional communication
      await this.setupBidirectionalBridge();
      
    } catch (error) {
      logger.error('❌ Failed to initialize Hyper Insta Telegram bridge:', error.message);
      throw error;
    }
  }

  async setupBidirectionalBridge() {
    try {
      // Enable polling to listen for replies
      this.bot.startPolling();
      
      // Listen for text messages (replies)
      this.bot.on('message', async (msg) => {
        if (msg.chat.id.toString() === this.chatId && msg.reply_to_message) {
          await this.handleTelegramReply(msg);
        }
      });
      
      logger.info('🔄 Bidirectional Telegram bridge enabled');
      
    } catch (error) {
      logger.error('❌ Error setting up bidirectional bridge:', error);
    }
  }

  async handleTelegramReply(msg) {
    try {
      const replyToMessageId = msg.reply_to_message.message_id;
      const threadInfo = this.replyToMessageMap.get(replyToMessageId);
      
      if (threadInfo) {
        const replyText = msg.text;
        logger.info(`📱➡️📱 Telegram reply: "${replyText}" -> Instagram thread ${threadInfo.threadId}`);
        
        // Notify message handlers about the reply
        for (const handler of this.messageHandlers) {
          await handler({
            type: 'telegram_reply',
            text: replyText,
            threadId: threadInfo.threadId,
            originalSender: threadInfo.originalSender,
            timestamp: new Date()
          });
        }
        
        // Clean up old mappings (keep only last 100)
        if (this.replyToMessageMap.size > 100) {
          const oldEntries = Array.from(this.replyToMessageMap.keys()).slice(0, 50);
          oldEntries.forEach(key => this.replyToMessageMap.delete(key));
        }
      }
      
    } catch (error) {
      logger.error('Error handling Telegram reply:', error);
    }
  }

  onMessage(handler) {
    this.messageHandlers.push(handler);
  }
  async forwardMessage(message) {
    if (!this.bot || !config.telegram.forwardMessages) return;

    try {
      const formattedMessage = this.formatMessage(message);
      const sentMessage = await this.bot.sendMessage(this.chatId, formattedMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      
      // Store mapping for bidirectional replies
      this.replyToMessageMap.set(sentMessage.message_id, {
        threadId: message.threadId,
        originalSender: message.senderUsername
      });
      
      logger.info(`📨 Hyper Insta forwarded message from @${message.senderUsername} to Telegram`);
      
    } catch (error) {
      logger.error('Error forwarding message to Telegram:', error);
    }
  }

  async forwardMedia(message) {
    if (!this.bot || !config.telegram.forwardMedia || !message.media) return;

    try {
      const caption = this.formatMessage(message);
      
      let sentMessage;
      if (message.media.type === 'photo') {
        sentMessage = await this.bot.sendPhoto(this.chatId, message.media.url, {
          caption,
          parse_mode: 'Markdown'
        });
      } else if (message.media.type === 'video') {
        sentMessage = await this.bot.sendVideo(this.chatId, message.media.url, {
          caption,
          parse_mode: 'Markdown'
        });
      }
      
      // Store mapping for bidirectional replies
      if (sentMessage) {
        this.replyToMessageMap.set(sentMessage.message_id, {
          threadId: message.threadId,
          originalSender: message.senderUsername
        });
      }
      
      logger.info(`🖼️ Hyper Insta forwarded ${message.media.type} from @${message.senderUsername} to Telegram`);
      
    } catch (error) {
      logger.error('Error forwarding media to Telegram:', error);
    }
  }

  formatMessage(message) {
    const timestamp = message.timestamp.toLocaleString();
    const displayName = message.senderDisplayName || message.senderUsername;
    const username = message.senderUsername;
    const text = message.text || '[Media]';
    
    return `🚀 *Hyper Insta*\n\n` +
           `👤 ${displayName}\n` +
           `@${username}\n\n` +
           `${text}`;
  }

  async sendNotification(text) {
    if (!this.bot) return;

    try {
      await this.bot.sendMessage(this.chatId, `🚀 *Hyper Insta Notification*\n\n${text}`, {
        parse_mode: 'Markdown'
      });
    } catch (error) {
      logger.error('Error sending notification to Telegram:', error);
    }
  }

  async downloadMedia(url, filename) {
    try {
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream'
      });

      await fileUtils.ensureDir('./downloads');
      const filePath = `./downloads/${filename}`;
      
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(filePath));
        writer.on('error', reject);
      });
      
    } catch (error) {
      logger.error('Error downloading media:', error);
      throw error;
    }
  }
}