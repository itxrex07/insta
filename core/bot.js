import { IgApiClient } from 'instagram-private-api';
import { logger } from './utils.js';
import { config } from '../config.js';
import { SessionManager } from './session-manager.js';
import { MessageHandler } from './message-handler.js';

export class InstagramBot {
  constructor() {
    this.ig = new IgApiClient();
    this.sessionManager = new SessionManager(this.ig);
    this.messageHandler = null;
    this.isRunning = false;
    this.lastMessageCheck = new Date();
  }

  async login() {
    return await this.sessionManager.login();
  }

  setupMessageHandlers(moduleManager, telegramBridge) {
    this.messageHandler = new MessageHandler(this, moduleManager, telegramBridge);
    
    // Setup Instagram message listeners
    this.onMessage(async (message) => {
      await this.messageHandler.handleMessage(message);
    });

    this.onMedia(async (media) => {
      await this.messageHandler.handleMedia(media);
    });

    // Setup Telegram reply handler
    if (telegramBridge) {
      telegramBridge.onMessage(async (reply) => {
        if (reply.type === 'telegram_reply') {
          const success = await this.sendMessage(reply.threadId, reply.text);
          if (success) {
            logger.info(`📱⬅️📱 Telegram reply sent to @${reply.originalSender}`);
          }
        }
      });
    }
  }

  startMessageListener() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    logger.info('👂 Message listener started');
    
    setInterval(async () => {
      if (this.isRunning) {
        try {
          await this.checkForNewMessages();
        } catch (error) {
          logger.error('❌ Error checking messages:', error.message);
          
          if (error.message.includes('login_required') || error.message.includes('401')) {
            logger.warn('🔄 Session expired, attempting re-login...');
            try {
              await this.login();
            } catch (loginError) {
              logger.error('❌ Re-login failed:', loginError.message);
            }
          }
        }
      }
    }, config.instagram.messageCheckInterval);
  }

  async checkForNewMessages() {
    try {
      const inboxFeed = this.ig.feed.directInbox();
      const inbox = await inboxFeed.items();
      
      if (!inbox || inbox.length === 0) return;

      for (const thread of inbox.slice(0, 5)) {
        try {
          await this.checkThreadMessages(thread);
          await this.delay(500); // Reduced delay for better performance
        } catch (error) {
          logger.error(`❌ Error checking thread ${thread.thread_id}:`, error.message);
        }
      }

    } catch (error) {
      logger.error('❌ Error fetching inbox:', error.message);
      throw error;
    }
  }

  async checkThreadMessages(thread) {
    try {
      const threadFeed = this.ig.feed.directThread({
        thread_id: thread.thread_id
      });
      
      const messages = await threadFeed.items();
      if (!messages || messages.length === 0) return;

      const latestMessage = messages[0];
      
      if (this.isNewMessage(latestMessage)) {
        await this.handleMessage(latestMessage, thread);
      }

    } catch (error) {
      logger.error(`❌ Error fetching thread messages:`, error.message);
    }
  }

  isNewMessage(message) {
    const messageTime = new Date(message.timestamp / 1000);
    const isNew = messageTime > this.lastMessageCheck;
    
    if (isNew) {
      this.lastMessageCheck = messageTime;
    }
    
    return isNew;
  }

  async handleMessage(message, thread) {
    try {
      const sender = thread.users.find(u => u.pk.toString() === message.user_id.toString());
      
      const processedMessage = {
        id: message.item_id,
        text: message.text || '',
        sender: message.user_id,
        senderUsername: sender?.username || 'Unknown',
        senderDisplayName: sender?.full_name || sender?.username || 'Unknown',
        timestamp: new Date(message.timestamp / 1000),
        threadId: thread.thread_id,
        threadTitle: thread.thread_title || 'Direct Message',
        type: message.item_type,
        shouldForward: true
      };

      if (message.media) {
        processedMessage.media = {
          type: message.media.media_type === 1 ? 'photo' : 'video',
          url: message.media.image_versions2?.candidates?.[0]?.url || 
               message.media.video_versions?.[0]?.url
        };
        
        logger.info(`📸 ${processedMessage.media.type} from @${processedMessage.senderUsername}`);
        
        for (const handler of this.mediaHandlers) {
          await handler(processedMessage);
        }
      }

      logger.info(`💬 @${processedMessage.senderUsername}: ${processedMessage.text}`);

      for (const handler of this.messageHandlers) {
        await handler(processedMessage);
      }

    } catch (error) {
      logger.error('❌ Error handling message:', error.message);
    }
  }

  onMessage(handler) {
    if (!this.messageHandlers) this.messageHandlers = [];
    this.messageHandlers.push(handler);
  }

  onMedia(handler) {
    if (!this.mediaHandlers) this.mediaHandlers = [];
    this.mediaHandlers.push(handler);
  }

  async sendMessage(threadId, text) {
    try {
      await this.ig.entity.directThread(threadId).broadcastText(text);
      return true;
    } catch (error) {
      logger.error('❌ Error sending message:', error.message);
      return false;
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async disconnect() {
    this.isRunning = false;
    await this.sessionManager.saveSession();
  }
}