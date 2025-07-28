import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { connectDb } from '../utils/db.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class TelegramBridge {
  constructor() {
    this.instagramBot = null;
    this.telegramBot = null;
    this.chatMappings = new Map();
    this.userMappings = new Map();
    this.tempDir = path.join(__dirname, '..', 'temp', 'telegram-bridge');
    this.db = null;
    this.collection = null;
    this.telegramChatId = null;
    this.enabled = false;
    this.isInitialized = false;
  }

  async initialize(instagramBotInstance) {
    if (this.isInitialized) {
      logger.warn('Telegram bridge already initialized');
      return;
    }

    this.instagramBot = instagramBotInstance;
    const token = config.telegram?.botToken;
    this.telegramChatId = config.telegram?.chatId;

    if (!token) {
      logger.warn('Telegram bot token not found. Bridge disabled.');
      this.enabled = false;
      return;
    }

    if (!this.telegramChatId) {
      logger.warn('Telegram chat ID not found. Bridge functionality limited.');
    }

    try {
      // Initialize Telegram Bot
      this.telegramBot = new TelegramBot(token, { 
        polling: {
          interval: 1000,
          autoStart: true,
          params: {
            timeout: 10
          }
        }
      });

      // Ensure temp directory exists
      await fs.ensureDir(this.tempDir);

      // Initialize database
      await this.initializeDatabase();

      // Setup event handlers
      this.setupInstagramHandlers();
      await this.setupTelegramHandlers();

      this.enabled = true;
      this.isInitialized = true;
      
      logger.info('Telegram bridge initialized successfully');

      // Test connection
      await this.testConnection();

    } catch (error) {
      logger.error('Failed to initialize Telegram bridge:', error.message);
      this.enabled = false;
    }
  }

  async testConnection() {
    try {
      const me = await this.telegramBot.getMe();
      logger.info(`Connected to Telegram as @${me.username}`);
      
      if (this.telegramChatId) {
        const chat = await this.telegramBot.getChat(this.telegramChatId);
        logger.info(`Connected to chat: ${chat.title || chat.first_name}`);
      }
    } catch (error) {
      logger.error('Telegram connection test failed:', error.message);
    }
  }

  async initializeDatabase() {
    try {
      this.db = await connectDb();
      this.collection = this.db.collection('telegram_bridge');
      await this.loadMappingsFromDb();
      logger.debug('Telegram bridge database initialized');
    } catch (error) {
      logger.error('Failed to initialize bridge database:', error.message);
    }
  }

  async loadMappingsFromDb() {
    if (!this.collection) return;

    try {
      const mappings = await this.collection.find({ type: 'mapping' }).toArray();
      mappings.forEach(mapping => {
        if (mapping.instagramThreadId && mapping.telegramTopicId) {
          this.chatMappings.set(mapping.instagramThreadId, mapping.telegramTopicId);
        }
      });
      logger.debug(`Loaded ${this.chatMappings.size} chat mappings`);
    } catch (error) {
      logger.error('Error loading mappings from database:', error.message);
    }
  }

  async saveMappingToDb(instagramThreadId, telegramTopicId) {
    if (!this.collection) return;

    try {
      await this.collection.updateOne(
        { type: 'mapping', instagramThreadId },
        { 
          $set: { 
            telegramTopicId, 
            lastUpdated: new Date(),
            type: 'mapping'
          } 
        },
        { upsert: true }
      );
      logger.debug(`Saved mapping: ${instagramThreadId} -> ${telegramTopicId}`);
    } catch (error) {
      logger.error('Error saving mapping to database:', error.message);
    }
  }

  setupInstagramHandlers() {
    if (!this.instagramBot) {
      logger.error('Instagram bot not provided to bridge');
      return;
    }

    this.instagramBot.on('message', async (message) => {
      await this.sendToTelegram(message);
    });

    logger.debug('Instagram event handlers setup complete');
  }

  async setupTelegramHandlers() {
    if (!this.telegramBot) {
      logger.error('Telegram bot not initialized');
      return;
    }

    // Handle text messages
    this.telegramBot.on('text', async (msg) => {
      await this.handleTelegramText(msg);
    });

    // Handle photos
    this.telegramBot.on('photo', async (msg) => {
      await this.handleTelegramPhoto(msg);
    });

    // Handle videos
    this.telegramBot.on('video', async (msg) => {
      await this.handleTelegramVideo(msg);
    });

    // Handle documents
    this.telegramBot.on('document', async (msg) => {
      await this.handleTelegramDocument(msg);
    });

    // Handle stickers
    this.telegramBot.on('sticker', async (msg) => {
      await this.handleTelegramSticker(msg);
    });

    // Handle errors
    this.telegramBot.on('error', (error) => {
      logger.error('Telegram bot error:', error.message);
    });

    // Handle polling errors
    this.telegramBot.on('polling_error', (error) => {
      logger.error('Telegram polling error:', error.message);
    });

    logger.debug('Telegram event handlers setup complete');
  }

  async handleTelegramText(msg) {
    try {
      const instagramThreadId = await this.getInstagramThreadId(msg);
      if (!instagramThreadId) {
        logger.debug(`No Instagram mapping for Telegram chat ${msg.chat.id}`);
        return;
      }

      const senderName = this.getSenderName(msg);
      const text = `[TG ${senderName}]: ${msg.text}`;

      await this.instagramBot.sendMessage(instagramThreadId, text);
      logger.debug(`Sent text from Telegram to Instagram: ${instagramThreadId}`);

    } catch (error) {
      logger.error('Error handling Telegram text:', error.message);
      await this.sendErrorToTelegram(msg.chat.id, 'Failed to send message to Instagram');
    }
  }

  async handleTelegramPhoto(msg) {
    try {
      const instagramThreadId = await this.getInstagramThreadId(msg);
      if (!instagramThreadId) return;

      const photo = msg.photo[msg.photo.length - 1]; // Highest resolution
      const senderName = this.getSenderName(msg);
      const caption = msg.caption ? `[TG ${senderName}]: ${msg.caption}` : `[TG ${senderName}]: Photo`;

      const filePath = await this.downloadTelegramFile(photo.file_id, 'jpg');
      await this.instagramBot.sendPhoto(instagramThreadId, filePath, caption);
      await fs.remove(filePath);

      logger.debug(`Sent photo from Telegram to Instagram: ${instagramThreadId}`);

    } catch (error) {
      logger.error('Error handling Telegram photo:', error.message);
      await this.sendErrorToTelegram(msg.chat.id, 'Failed to send photo to Instagram');
    }
  }

  async handleTelegramVideo(msg) {
    try {
      const instagramThreadId = await this.getInstagramThreadId(msg);
      if (!instagramThreadId) return;

      const senderName = this.getSenderName(msg);
      const caption = msg.caption ? `[TG ${senderName}]: ${msg.caption}` : `[TG ${senderName}]: Video`;

      const filePath = await this.downloadTelegramFile(msg.video.file_id, 'mp4');
      await this.instagramBot.sendVideo(instagramThreadId, filePath, caption);
      await fs.remove(filePath);

      logger.debug(`Sent video from Telegram to Instagram: ${instagramThreadId}`);

    } catch (error) {
      logger.error('Error handling Telegram video:', error.message);
      await this.sendErrorToTelegram(msg.chat.id, 'Failed to send video to Instagram');
    }
  }

  async handleTelegramDocument(msg) {
    try {
      const instagramThreadId = await this.getInstagramThreadId(msg);
      if (!instagramThreadId) return;

      const senderName = this.getSenderName(msg);
      const fileName = msg.document.file_name || 'document';
      const fileLink = await this.telegramBot.getFileLink(msg.document.file_id);
      
      const text = `[TG ${senderName}]: Document "${fileName}"\n${fileLink}`;
      await this.instagramBot.sendMessage(instagramThreadId, text);

      logger.debug(`Sent document link from Telegram to Instagram: ${instagramThreadId}`);

    } catch (error) {
      logger.error('Error handling Telegram document:', error.message);
      await this.sendErrorToTelegram(msg.chat.id, 'Failed to send document to Instagram');
    }
  }

  async handleTelegramSticker(msg) {
    try {
      const instagramThreadId = await this.getInstagramThreadId(msg);
      if (!instagramThreadId) return;

      const senderName = this.getSenderName(msg);
      const emoji = msg.sticker.emoji || '🎭';
      const text = `[TG ${senderName}]: Sticker ${emoji}`;

      await this.instagramBot.sendMessage(instagramThreadId, text);
      logger.debug(`Sent sticker notification from Telegram to Instagram: ${instagramThreadId}`);

    } catch (error) {
      logger.error('Error handling Telegram sticker:', error.message);
      await this.sendErrorToTelegram(msg.chat.id, 'Failed to send sticker to Instagram');
    }
  }

  async sendToTelegram(message) {
    if (!this.enabled || !this.telegramBot) return;

    try {
      const telegramChatId = await this.getTelegramChatId(message.threadId);
      if (!telegramChatId) {
        logger.debug(`No Telegram mapping for Instagram thread ${message.threadId}`);
        return;
      }

      const senderInfo = `<b>@${message.senderUsername}</b>`;
      
      switch (message.type) {
        case 'text':
          await this.sendTelegramText(telegramChatId, senderInfo, message.text);
          break;
          
        case 'media':
        case 'photo':
          await this.sendTelegramMedia(telegramChatId, senderInfo, message, 'photo');
          break;
          
        case 'video':
          await this.sendTelegramMedia(telegramChatId, senderInfo, message, 'video');
          break;
          
        case 'like':
          await this.sendTelegramText(telegramChatId, senderInfo, '❤️ Liked a message');
          break;
          
        case 'media_share':
          await this.sendTelegramMediaShare(telegramChatId, senderInfo, message);
          break;
          
        default:
          await this.sendTelegramText(telegramChatId, senderInfo, `[${message.type}] Unsupported message type`);
          break;
      }

      logger.debug(`Sent message from Instagram to Telegram: ${telegramChatId}`);

    } catch (error) {
      logger.error('Error sending message to Telegram:', error.message);
    }
  }

  async sendTelegramText(chatId, senderInfo, text) {
    const message = `${senderInfo}: ${text}`;
    await this.telegramBot.sendMessage(chatId, message, { 
      parse_mode: 'HTML',
      disable_web_page_preview: false
    });
  }

  async sendTelegramMedia(chatId, senderInfo, message, type) {
    try {
      let mediaUrl = null;
      
      if (message.media?.image_versions2?.candidates?.[0]?.url) {
        mediaUrl = message.media.image_versions2.candidates[0].url;
      } else if (message.media?.video_versions?.[0]?.url) {
        mediaUrl = message.media.video_versions[0].url;
      }

      if (!mediaUrl) {
        await this.sendTelegramText(chatId, senderInfo, '[Media without URL]');
        return;
      }

      const caption = `${senderInfo}${message.text ? `: ${message.text}` : ''}`;

      if (type === 'photo') {
        await this.telegramBot.sendPhoto(chatId, mediaUrl, { 
          caption,
          parse_mode: 'HTML'
        });
      } else if (type === 'video') {
        await this.telegramBot.sendVideo(chatId, mediaUrl, { 
          caption,
          parse_mode: 'HTML'
        });
      }

    } catch (error) {
      logger.error(`Error sending ${type} to Telegram:`, error.message);
      await this.sendTelegramText(chatId, senderInfo, `[${type} - failed to load]`);
    }
  }

  async sendTelegramMediaShare(chatId, senderInfo, message) {
    try {
      const mediaShare = message.raw.media_share;
      if (!mediaShare) {
        await this.sendTelegramText(chatId, senderInfo, '[Shared post - no data]');
        return;
      }

      const postUser = mediaShare.user?.username || 'unknown';
      const postCaption = mediaShare.caption?.text || '';
      
      let text = `${senderInfo}: <b>[SHARED POST]</b> by @${postUser}`;
      if (postCaption) {
        text += `\n\n${postCaption.substring(0, 200)}${postCaption.length > 200 ? '...' : ''}`;
      }

      // Try to send media if available
      if (mediaShare.image_versions2?.candidates?.[0]?.url) {
        await this.telegramBot.sendPhoto(chatId, mediaShare.image_versions2.candidates[0].url, {
          caption: text,
          parse_mode: 'HTML'
        });
      } else if (mediaShare.video_versions?.[0]?.url) {
        await this.telegramBot.sendVideo(chatId, mediaShare.video_versions[0].url, {
          caption: text,
          parse_mode: 'HTML'
        });
      } else {
        await this.telegramBot.sendMessage(chatId, text, { parse_mode: 'HTML' });
      }

    } catch (error) {
      logger.error('Error sending media share to Telegram:', error.message);
      await this.sendTelegramText(chatId, senderInfo, '[Shared post - failed to load]');
    }
  }

  async downloadTelegramFile(fileId, extension) {
    try {
      const fileLink = await this.telegramBot.getFileLink(fileId);
      const fileName = `${fileId}.${extension}`;
      const filePath = path.join(this.tempDir, fileName);

      const response = await axios({
        url: fileLink,
        method: 'GET',
        responseType: 'stream',
        timeout: 30000
      });

      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      return filePath;

    } catch (error) {
      logger.error('Error downloading Telegram file:', error.message);
      throw error;
    }
  }

  async getInstagramThreadId(msg) {
    // Check if it's a forum topic message
    const effectiveChatId = msg.is_topic_message ? msg.message_thread_id : msg.chat.id;
    
    // Look for mapping in our cache
    for (const [instagramThreadId, telegramChatId] of this.chatMappings.entries()) {
      if (telegramChatId.toString() === effectiveChatId.toString()) {
        return instagramThreadId;
      }
    }

    // Check if it's the main chat
    if (effectiveChatId.toString() === this.telegramChatId?.toString()) {
      // For main chat, we might need to create or find a default thread
      // This is a simplified approach - you might want to implement topic creation
      return null;
    }

    return null;
  }

  async getTelegramChatId(instagramThreadId) {
    // Check existing mappings
    if (this.chatMappings.has(instagramThreadId)) {
      return this.chatMappings.get(instagramThreadId);
    }

    // Try to create a new topic if forum mode is enabled
    if (config.telegram.forumMode && this.telegramChatId) {
      return await this.createForumTopic(instagramThreadId);
    }

    // Fallback to main chat
    return this.telegramChatId;
  }

  async createForumTopic(instagramThreadId) {
    try {
      const threadInfo = await this.instagramBot.getThreadInfo(instagramThreadId);
      const topicName = threadInfo?.title || `Instagram Chat ${instagramThreadId.substring(0, 8)}`;

      const topic = await this.telegramBot.createForumTopic(this.telegramChatId, topicName, {
        icon_color: Math.floor(Math.random() * 0xFFFFFF)
      });

      const topicId = topic.message_thread_id;
      this.chatMappings.set(instagramThreadId, topicId);
      await this.saveMappingToDb(instagramThreadId, topicId);

      logger.info(`Created Telegram topic "${topicName}" for Instagram thread ${instagramThreadId}`);
      return topicId;

    } catch (error) {
      logger.error('Error creating forum topic:', error.message);
      return this.telegramChatId; // Fallback to main chat
    }
  }

  getSenderName(msg) {
    return msg.from.username || msg.from.first_name || 'Unknown';
  }

  async sendErrorToTelegram(chatId, errorMessage) {
    try {
      await this.telegramBot.sendMessage(chatId, `❌ ${errorMessage}`);
    } catch (error) {
      logger.error('Error sending error message to Telegram:', error.message);
    }
  }

  async shutdown() {
    logger.info('Shutting down Telegram bridge...');
    
    if (this.telegramBot) {
      try {
        await this.telegramBot.stopPolling();
        logger.debug('Telegram polling stopped');
      } catch (error) {
        logger.debug('Error stopping Telegram polling:', error.message);
      }
    }

    try {
      await fs.emptyDir(this.tempDir);
      logger.debug('Temp directory cleaned');
    } catch (error) {
      logger.debug('Error cleaning temp directory:', error.message);
    }

    this.enabled = false;
    this.isInitialized = false;
    logger.info('Telegram bridge shutdown complete');
  }
}