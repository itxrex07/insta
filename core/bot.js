import { IgApiClient } from 'instagram-private-api';
import { logger } from '../utils/utils.js';
import { config } from '../config.js';
import { SessionManager } from './session-manager.js';
import { MessageHandler } from './message-handler.js';
import { ModuleManager } from './module-manager.js';

export class InstagramBot {
  constructor() {
    this.ig = new IgApiClient();
    this.sessionManager = new SessionManager(this.ig);
    this.moduleManager = new ModuleManager(this);
    this.messageHandler = new MessageHandler(this, this.moduleManager, null);
    this.isRunning = false;
    this.lastMessageCheck = new Date();
  }

  async login() {
    return await this.sessionManager.login();
  }

  async setupMessageHandlers(telegramBridge) {
    // Load modules first
    await this.moduleManager.loadModules();
    
    // Update message handler with telegram bridge
    this.messageHandler = new MessageHandler(this, this.moduleManager, telegramBridge);
    
    // Setup Telegram reply handler
    if (telegramBridge?.enabled) {
      telegramBridge.onMessage(async (reply) => {
        if (reply.type === 'telegram_reply') {
          await this.sendMessage(reply.threadId, reply.text);
        }
      });
    }
  }

  startMessageListener() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    
    setInterval(async () => {
      if (this.isRunning) {
        try {
          await this.checkForNewMessages();
        } catch (error) {
          if (error.message.includes('login_required')) {
            try {
              await this.login();
            } catch (loginError) {
              logger.error('Re-login failed:', loginError.message);
            }
          }
        }
      }
    }, 100); // Super fast 3 second intervals
  }

  async checkForNewMessages() {
    try {
      const inboxFeed = this.ig.feed.directInbox();
      const inbox = await inboxFeed.items();
      
      if (!inbox?.length) return;

      for (const thread of inbox.slice(0, 2)) {
        await this.checkThreadMessages(thread);
        await this.delay(100); // Reduced delay
      }

    } catch (error) {
      throw error;
    }
  }

  async checkThreadMessages(thread) {
    try {
      const threadFeed = this.ig.feed.directThread({ thread_id: thread.thread_id });
      const messages = await threadFeed.items();
      
      if (!messages?.length) return;

      const latestMessage = messages[0];
      
      if (this.isNewMessage(latestMessage)) {
        await this.handleMessage(latestMessage, thread);
      }

    } catch (error) {
      // Silent fail for thread errors
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

      await this.messageHandler.handleMessage(processedMessage);

    } catch (error) {
      logger.error('Handle message error:', error.message);
    }
  }

  async sendMessage(threadId, text) {
    try {
      await this.ig.entity.directThread(threadId).broadcastText(text);
      return true;
    } catch (error) {
      return false;
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

async disconnect() {
  this.isRunning = false;
  // This will ensure cookies from the file are saved to the DB on disconnect.
  await this.sessionManager.saveCookiesToDb();
  await this.moduleManager.cleanup();
}
}
