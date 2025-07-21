import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { logger, fileUtils } from '../utils.js';
import { config } from '../config.js';

export class TelegramBridge {
  constructor() {
    this.bot = null;
    this.chatId = config.telegram.chatId;
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
      logger.info(`✅ Connected to Telegram as @${me.username}`);
      
    } catch (error) {
      logger.error('❌ Failed to initialize Telegram bridge:', error.message);
      throw error;
    }
  }

  async forwardMessage(message) {
    if (!this.bot || !config.telegram.forwardMessages) return;

    try {
      const formattedMessage = this.formatMessage(message);
      await this.bot.sendMessage(this.chatId, formattedMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      
      logger.info(`📨 Forwarded message from @${message.senderUsername} to Telegram`);
      
    } catch (error) {
      logger.error('Error forwarding message to Telegram:', error);
    }
  }

  async forwardMedia(message) {
    if (!this.bot || !config.telegram.forwardMedia || !message.media) return;

    try {
      const caption = this.formatMessage(message);
      
      if (message.media.type === 'photo') {
        await this.bot.sendPhoto(this.chatId, message.media.url, {
          caption,
          parse_mode: 'Markdown'
        });
      } else if (message.media.type === 'video') {
        await this.bot.sendVideo(this.chatId, message.media.url, {
          caption,
          parse_mode: 'Markdown'
        });
      }
      
      logger.info(`🖼️ Forwarded ${message.media.type} from @${message.senderUsername} to Telegram`);
      
    } catch (error) {
      logger.error('Error forwarding media to Telegram:', error);
    }
  }

  formatMessage(message) {
    const timestamp = message.timestamp.toLocaleString();
    const sender = message.senderUsername;
    const thread = message.threadTitle;
    const text = message.text || '[Media]';
    
    return `📱 *Instagram Message*\n\n` +
           `👤 *From:* @${sender}\n` +
           `💬 *Thread:* ${thread}\n` +
           `🕒 *Time:* ${timestamp}\n\n` +
           `💭 *Message:*\n${text}`;
  }

  async sendNotification(text) {
    if (!this.bot) return;

    try {
      await this.bot.sendMessage(this.chatId, `🤖 *Bot Notification*\n\n${text}`, {
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