import { IgApiClient } from 'instagram-private-api';
import { logger, fileUtils } from './utils.js';
import { config } from '../config.js';
import fs from 'fs';
import tough from 'tough-cookie';
import { connectDb } from '../db/index.js';


export class InstagramBot {
  constructor() {
    this.ig = new IgApiClient();
    this.messageHandlers = [];
    this.mediaHandlers = [];
    this.sessionPath = './session/session.json';
    this.isRunning = false;
    this.lastMessageCheck = new Date();
    this.db = null;
  }

  async login() {
    try {
      const username = config.instagram.username;

      if (!username) {
        throw new Error('❌ Instagram username is missing from config.');
      }

      this.ig.state.generateDevice(username);

      // Try to load session first
      const sessionLoaded = await this.loadSession();
      
      if (sessionLoaded) {
        try {
          await this.ig.account.currentUser();
          logger.info('✅ Logged in using saved session');
          this.startMessageListener();
          return;
        } catch (err) {
          logger.warn('⚠️ Saved session is invalid, clearing...');
          await this.clearSession();
        }
      }

      // If no valid session, try cookie login
      await this.loadCookiesFromJson('./session/cookies.json');

      try {
        await this.ig.account.currentUser();
        logger.info('✅ Logged in using cookies');
        await this.saveSession();
        this.startMessageListener();
      } catch (err) {
        logger.error('❌ Cookie login failed:', err.message);
        throw new Error('Please provide valid Instagram credentials or session');
      }

    } catch (error) {
      logger.error('❌ Failed to login:', error.message);
      throw error;
    }
  }

  async loadSession() {
    try {
      if (config.instagram.useMongoSession) {
        return await this.loadSessionFromMongo();
      } else {
        return await this.loadSessionFromFile();
      }
    } catch (error) {
      logger.warn('⚠️ Failed to load session:', error.message);
      return false;
    }
  }

  async loadSessionFromFile() {
    try {
      if (await fileUtils.pathExists(this.sessionPath)) {
        const sessionData = await fileUtils.readJson(this.sessionPath);
        if (sessionData && sessionData.cookies) {
          await this.ig.state.deserialize(sessionData);
          logger.info('📁 Session loaded from file');
          return true;
        }
      }
    } catch (error) {
      logger.warn('⚠️ Failed to load session from file:', error.message);
    }
    return false;
  }

  async loadSessionFromMongo() {
    try {
      if (!this.db) {
        this.db = await connectDb();
      }
      
      const sessions = this.db.collection('sessions');
      const sessionDoc = await sessions.findOne({ username: config.instagram.username });
      
      if (sessionDoc && sessionDoc.sessionData) {
        await this.ig.state.deserialize(sessionDoc.sessionData);
        logger.info('🗄️ Session loaded from MongoDB');
        return true;
      }
    } catch (error) {
      logger.warn('⚠️ Failed to load session from MongoDB:', error.message);
    }
    return false;
  }

  async saveSession() {
    try {
      const serialized = await this.ig.state.serialize();
      delete serialized.constants;
      
      if (config.instagram.useMongoSession) {
        await this.saveSessionToMongo(serialized);
      } else {
        await this.saveSessionToFile(serialized);
      }
      
      logger.info('💾 Session saved successfully');
    } catch (error) {
      logger.warn('⚠️ Failed to save session:', error.message);
    }
  }

  async saveSessionToFile(sessionData) {
    await fileUtils.ensureDir('./session');
    await fileUtils.writeJson(this.sessionPath, sessionData);
  }

  async saveSessionToMongo(sessionData) {
    try {
      if (!this.db) {
        this.db = await connectDb();
      }
      
      const sessions = this.db.collection('sessions');
      await sessions.replaceOne(
        { username: config.instagram.username },
        {
          username: config.instagram.username,
          sessionData: sessionData,
          updatedAt: new Date()
        },
        { upsert: true }
      );
    } catch (error) {
      logger.error('❌ Failed to save session to MongoDB:', error.message);
    }
  }

  async clearSession() {
    try {
      if (config.instagram.useMongoSession) {
        if (!this.db) {
          this.db = await connectDb();
        }
        const sessions = this.db.collection('sessions');
        await sessions.deleteOne({ username: config.instagram.username });
        logger.info('🗑️ Session cleared from MongoDB');
      } else {
        if (await fileUtils.pathExists(this.sessionPath)) {
          await fs.promises.unlink(this.sessionPath);
          logger.info('🗑️ Session file deleted');
        }
      }
    } catch (error) {
      logger.warn('⚠️ Failed to clear session:', error.message);
    }
  }

async loadCookiesFromJson(path = './session/cookies.json') {
  try {
    const raw = fs.readFileSync(path, 'utf-8');
    const cookies = JSON.parse(raw);

    for (const cookie of cookies) {
      const toughCookie = new tough.Cookie({
        key: cookie.name,
        value: cookie.value,
        domain: cookie.domain.replace(/^\./, ''),
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
      });

      await this.ig.state.cookieJar.setCookie(
        toughCookie.toString(),
        `https://${cookie.domain}${cookie.path}`
      );
    }

    logger.info('🍪 Loaded Instagram cookies from file');
  } catch (error) {
    logger.error('❌ Failed to load cookies:', error.message);
    throw error;
  }
}

  startMessageListener() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    logger.info('👂 Started message listener');
    
    // Check for messages every 10 seconds to avoid rate limiting
    setInterval(async () => {
      if (this.isRunning) {
        try {
          await this.checkForNewMessages();
        } catch (error) {
          logger.error('❌ Error checking messages:', error.message);
          
          // If session expired, try to re-login
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
      // Get direct inbox
      const inboxFeed = this.ig.feed.directInbox();
      const inbox = await inboxFeed.items();
      
      if (!inbox || inbox.length === 0) {
        logger.debug('📭 No messages in inbox');
        return;
      }

      // Check each thread for new messages
      for (const thread of inbox.slice(0, 5)) { // Limit to first 5 threads to avoid rate limiting
        try {
          await this.checkThreadMessages(thread);
          await this.delay(1000); // Delay between thread checks
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

      // Check only the latest message to avoid processing old messages
      const latestMessage = messages[0];
      
      if (this.isNewMessage(latestMessage)) {
        await this.handleMessage(latestMessage, thread);
      }

    } catch (error) {
      logger.error(`❌ Error fetching thread messages:`, error.message);
    }
  }

  isNewMessage(message) {
    // Check if message is newer than our last check
    const messageTime = new Date(message.timestamp / 1000);
    const isNew = messageTime > this.lastMessageCheck;
    
    if (isNew) {
      this.lastMessageCheck = messageTime;
    }
    
    return isNew;
  }

  async handleMessage(message, thread) {
    try {
      // Get sender info
      const sender = thread.users.find(u => u.pk.toString() === message.user_id.toString());
      
      const processedMessage = {
        id: message.item_id,
        text: message.text || '',
        sender: message.user_id,
        senderUsername: sender?.username || 'Unknown',
        timestamp: new Date(message.timestamp / 1000),
        threadId: thread.thread_id,
        threadTitle: thread.thread_title || 'Direct Message',
        type: message.item_type,
        shouldForward: true
      };

      // Handle media messages
      if (message.media) {
        processedMessage.media = {
          type: message.media.media_type === 1 ? 'photo' : 'video',
          url: message.media.image_versions2?.candidates?.[0]?.url || 
               message.media.video_versions?.[0]?.url
        };
        
        logger.info(`📸 Received ${processedMessage.media.type} from @${processedMessage.senderUsername}`);
        
        // Notify media handlers
        for (const handler of this.mediaHandlers) {
          await handler(processedMessage);
        }
      }

      logger.info(`💬 New message from @${processedMessage.senderUsername}: ${processedMessage.text}`);

      // Notify message handlers
      for (const handler of this.messageHandlers) {
        await handler(processedMessage);
      }

    } catch (error) {
      logger.error('❌ Error handling message:', error.message);
    }
  }

  onMessage(handler) {
    this.messageHandlers.push(handler);
  }

  onMedia(handler) {
    this.mediaHandlers.push(handler);
  }

  async sendMessage(threadId, text) {
    try {
      await this.ig.entity.directThread(threadId).broadcastText(text);
      logger.info(`📤 Sent message to thread ${threadId}: ${text}`);
      return true;
    } catch (error) {
      logger.error('❌ Error sending message:', error.message);
      return false;
    }
  }

  // Setup message handlers - moved from index.js
  setupMessageHandlers(moduleManager, telegramBridge) {
    // Handle incoming Instagram messages
    this.onMessage(async (message) => {
      try {
        // Process through modules
        const processedMessage = await moduleManager.processMessage(message);
        
        // Forward to Telegram if enabled
        if (processedMessage.shouldForward && telegramBridge) {
          await telegramBridge.forwardMessage(processedMessage);
        }
      } catch (error) {
        logger.error('Error processing message:', error);
      }
    });

    // Handle media messages
    this.onMedia(async (media) => {
      try {
        if (telegramBridge) {
          await telegramBridge.forwardMedia(media);
        }
      } catch (error) {
        logger.error('Error forwarding media:', error);
      }
    });
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async disconnect() {
    logger.info('🔌 Disconnecting from Instagram...');
    this.isRunning = false;
    await this.saveSession();
  }
}