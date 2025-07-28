import { IgApiClient } from 'instagram-private-api';
import { withRealtime } from 'instagram_mqtt';
import { GraphQLSubscriptions } from 'instagram_mqtt';
import { SkywalkerSubscriptions } from 'instagram_mqtt';
import { promises as fs } from 'fs';
import tough from 'tough-cookie';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { EventEmitter } from 'events';

export class InstagramBot extends EventEmitter {
  constructor() {
    super();
    this.ig = withRealtime(new IgApiClient());
    this.isRunning = false;
    this.processedMessageIds = new Set();
    this.maxProcessedMessageIds = 1000;
    this.pushContext = {};
    this.connectionRetries = 0;
    this.maxRetries = config.app.maxRetries;
  }

  async login() {
    try {
      const username = config.instagram.username;
      if (!username) {
        throw new Error('Instagram username is required');
      }

      this.ig.state.generateDevice(username);
      let loginSuccess = false;

      // Try session first
      if (await this.trySessionLogin()) {
        loginSuccess = true;
      }
      // Try cookies if session failed
      else if (await this.tryCookieLogin()) {
        loginSuccess = true;
      }
      // Try fresh login if both failed
      else if (config.instagram.password && await this.tryFreshLogin()) {
        loginSuccess = true;
      }

      if (!loginSuccess) {
        throw new Error('All login methods failed');
      }

      await this.setupRealtime();
      this.isRunning = true;
      this.emit('ready');
      
      logger.info('Instagram bot is now running and listening for messages');
      return true;

    } catch (error) {
      logger.error('Failed to initialize bot:', error.message);
      throw error;
    }
  }

  async trySessionLogin() {
    try {
      await fs.access(config.instagram.sessionPath);
      const sessionData = JSON.parse(await fs.readFile(config.instagram.sessionPath, 'utf-8'));
      await this.ig.state.deserialize(sessionData);
      await this.ig.account.currentUser();
      logger.info('Logged in from session.json');
      return true;
    } catch (error) {
      logger.debug('Session login failed:', error.message);
      return false;
    }
  }

  async tryCookieLogin() {
    try {
      await this.loadCookiesFromJson(config.instagram.cookiesPath);
      await this.ig.account.currentUser();
      await this.saveSession();
      logger.info('Logged in using cookies.json');
      return true;
    } catch (error) {
      logger.debug('Cookie login failed:', error.message);
      return false;
    }
  }

  async tryFreshLogin() {
    try {
      await this.ig.account.login(config.instagram.username, config.instagram.password);
      await this.saveSession();
      logger.info('Fresh login successful');
      return true;
    } catch (error) {
      logger.debug('Fresh login failed:', error.message);
      return false;
    }
  }

  async loadCookiesFromJson(path) {
    const raw = await fs.readFile(path, 'utf-8');
    const cookies = JSON.parse(raw);
    
    for (const cookie of cookies) {
      const toughCookie = new tough.Cookie({
        key: cookie.name,
        value: cookie.value,
        domain: cookie.domain.replace(/^\./, ''),
        path: cookie.path || '/',
        secure: cookie.secure !== false,
        httpOnly: cookie.httpOnly !== false,
      });
      
      await this.ig.state.cookieJar.setCookie(
        toughCookie.toString(),
        `https://${toughCookie.domain}${toughCookie.path}`
      );
    }
  }

  async saveSession() {
    try {
      const session = await this.ig.state.serialize();
      delete session.constants;
      await fs.writeFile(config.instagram.sessionPath, JSON.stringify(session, null, 2));
      logger.debug('Session saved successfully');
    } catch (error) {
      logger.error('Failed to save session:', error.message);
    }
  }

  async setupRealtime() {
    this.registerRealtimeHandlers();
    
    await this.ig.realtime.connect({
      graphQlSubs: [
        GraphQLSubscriptions.getAppPresenceSubscription(),
        GraphQLSubscriptions.getZeroProvisionSubscription(this.ig.state.phoneId),
        GraphQLSubscriptions.getDirectStatusSubscription(),
        GraphQLSubscriptions.getDirectTypingSubscription(this.ig.state.cookieUserId),
        GraphQLSubscriptions.getAsyncAdSubscription(this.ig.state.cookieUserId),
      ],
      skywalkerSubs: [
        SkywalkerSubscriptions.directSub(this.ig.state.cookieUserId),
        SkywalkerSubscriptions.liveSub(this.ig.state.cookieUserId),
      ],
      irisData: await this.ig.feed.directInbox().request(),
    });
  }

  registerRealtimeHandlers() {
    // Message handler
    this.ig.realtime.on('message', async (data) => {
      try {
        if (!data.message || !this.isNewMessageById(data.message.item_id, data.message.thread_id)) {
          return;
        }
        await this.handleMessage(data.message, data);
      } catch (error) {
        logger.error('Error in message handler:', error.message);
      }
    });

    // Direct message handler
    this.ig.realtime.on('direct', async (data) => {
      try {
        if (data.message && this.isNewMessageById(data.message.item_id, data.message.thread_id)) {
          await this.handleMessage(data.message, data);
        }
      } catch (error) {
        logger.error('Error in direct handler:', error.message);
      }
    });

    // Push notification handler
    this.ig.realtime.on('push', async (data) => {
      try {
        const { collapseKey, payload } = data;
        if (collapseKey === 'direct_v2_message') {
          const threadIdMatch = payload?.match?.(/thread_id=(\d+)/);
          const itemIdMatch = payload?.match?.(/item_id=([^&]+)/);
          
          if (threadIdMatch?.[1] && itemIdMatch?.[1]) {
            const threadId = threadIdMatch[1];
            const itemId = itemIdMatch[1];
            
            if (!this.pushContext[threadId]) {
              this.pushContext[threadId] = new Set();
            }
            this.pushContext[threadId].add(itemId);
          }
        }
      } catch (error) {
        logger.error('Error processing push notification:', error.message);
      }
    });

    // Connection handlers
    this.ig.realtime.on('connect', () => {
      logger.info('Realtime connection established');
      this.connectionRetries = 0;
      this.isRunning = true;
    });

    this.ig.realtime.on('error', (error) => {
      logger.error('Realtime connection error:', error.message);
      this.handleConnectionError();
    });

    this.ig.realtime.on('close', () => {
      logger.warn('Realtime connection closed');
      this.isRunning = false;
      this.handleConnectionError();
    });
  }

  async handleConnectionError() {
    if (this.connectionRetries < this.maxRetries) {
      this.connectionRetries++;
      logger.info(`Attempting to reconnect (${this.connectionRetries}/${this.maxRetries})...`);
      
      setTimeout(async () => {
        try {
          await this.setupRealtime();
        } catch (error) {
          logger.error('Reconnection failed:', error.message);
          this.handleConnectionError();
        }
      }, config.app.retryDelay);
    } else {
      logger.error('Max reconnection attempts reached');
      this.emit('error', new Error('Connection lost and max retries exceeded'));
    }
  }

  isNewMessageById(messageId, threadId = null) {
    if (!messageId) return true;
    
    if (this.processedMessageIds.has(messageId)) {
      return false;
    }

    if (threadId && this.pushContext[threadId]?.has(messageId)) {
      return false;
    }

    this.processedMessageIds.add(messageId);
    if (this.processedMessageIds.size > this.maxProcessedMessageIds) {
      const first = this.processedMessageIds.values().next().value;
      if (first !== undefined) {
        this.processedMessageIds.delete(first);
      }
    }
    
    return true;
  }

  async handleMessage(message, eventData) {
    try {
      if (!message || !message.user_id || !message.item_id) {
        return;
      }

      let senderUsername = `user_${message.user_id}`;
      if (eventData.thread?.users) {
        const sender = eventData.thread.users.find(u => u.pk?.toString() === message.user_id?.toString());
        if (sender?.username) {
          senderUsername = sender.username;
        }
      }

      const processedMessage = {
        id: message.item_id,
        text: message.text || '',
        senderId: message.user_id,
        senderUsername: senderUsername,
        timestamp: new Date(parseInt(message.timestamp, 10) / 1000),
        threadId: eventData.thread?.thread_id || message.thread_id || 'unknown_thread',
        threadTitle: eventData.thread?.thread_title || message.thread_title || 'Direct Message',
        type: message.item_type || 'text',
        media: message.media || null,
        raw: message
      };

      this.emit('message', processedMessage);
      
    } catch (error) {
      logger.error('Error handling message:', error.message);
    }
  }

  async sendMessage(threadId, text) {
    if (!threadId || !text) {
      throw new Error('Thread ID and text are required');
    }

    try {
      await this.ig.entity.directThread(threadId).broadcastText(text);
      logger.debug(`Message sent to thread ${threadId}: "${text}"`);
      return true;
    } catch (error) {
      logger.error(`Error sending message to thread ${threadId}:`, error.message);
      throw error;
    }
  }

  async sendPhoto(threadId, photoPath, caption = '') {
    try {
      await this.ig.entity.directThread(threadId).broadcastPhoto({
        file: photoPath,
        caption: caption
      });
      logger.debug(`Photo sent to thread ${threadId}`);
      return true;
    } catch (error) {
      logger.error(`Error sending photo to thread ${threadId}:`, error.message);
      throw error;
    }
  }

  async sendVideo(threadId, videoPath, caption = '') {
    try {
      await this.ig.entity.directThread(threadId).broadcastVideo({
        video: videoPath,
        caption: caption
      });
      logger.debug(`Video sent to thread ${threadId}`);
      return true;
    } catch (error) {
      logger.error(`Error sending video to thread ${threadId}:`, error.message);
      throw error;
    }
  }

  async getThreadInfo(threadId) {
    try {
      const thread = await this.ig.entity.directThread(threadId).info();
      return {
        id: thread.thread_id,
        title: thread.thread_title,
        users: thread.users,
        isGroup: thread.thread_type === 'group'
      };
    } catch (error) {
      logger.error(`Error getting thread info for ${threadId}:`, error.message);
      return null;
    }
  }

  async getFollowers() {
    try {
      const followersFeed = this.ig.feed.accountFollowers(this.ig.state.cookieUserId);
      const followers = await followersFeed.items();
      return followers;
    } catch (error) {
      logger.error('Error getting followers:', error.message);
      return [];
    }
  }

  async getFollowing() {
    try {
      const followingFeed = this.ig.feed.accountFollowing(this.ig.state.cookieUserId);
      const following = await followingFeed.items();
      return following;
    } catch (error) {
      logger.error('Error getting following:', error.message);
      return [];
    }
  }

  async followUser(userId) {
    try {
      await this.ig.friendship.create(userId);
      logger.info(`Successfully followed user ${userId}`);
      return true;
    } catch (error) {
      logger.error(`Error following user ${userId}:`, error.message);
      return false;
    }
  }

  async unfollowUser(userId) {
    try {
      await this.ig.friendship.destroy(userId);
      logger.info(`Successfully unfollowed user ${userId}`);
      return true;
    } catch (error) {
      logger.error(`Error unfollowing user ${userId}:`, error.message);
      return false;
    }
  }

  async getPendingFollowRequests() {
    try {
      const pendingRequests = await this.ig.friendship.pending();
      return pendingRequests.users || [];
    } catch (error) {
      logger.error('Error getting pending follow requests:', error.message);
      return [];
    }
  }

  async approveFollowRequest(userId) {
    try {
      await this.ig.friendship.approve(userId);
      logger.info(`Approved follow request from user ${userId}`);
      return true;
    } catch (error) {
      logger.error(`Error approving follow request from ${userId}:`, error.message);
      return false;
    }
  }

  async getMessageRequests() {
    try {
      const pendingResponse = await this.ig.feed.directPending().request();
      return pendingResponse.inbox?.threads || [];
    } catch (error) {
      logger.error('Error getting message requests:', error.message);
      return [];
    }
  }

  async approveMessageRequest(threadId) {
    try {
      await this.ig.directThread.approve(threadId);
      logger.info(`Approved message request: ${threadId}`);
      return true;
    } catch (error) {
      logger.error(`Error approving message request ${threadId}:`, error.message);
      return false;
    }
  }

  async disconnect() {
    logger.info('Disconnecting from Instagram...');
    this.isRunning = false;
    this.pushContext = {};

    try {
      if (this.ig.realtime && typeof this.ig.realtime.disconnect === 'function') {
        await this.ig.realtime.disconnect();
        logger.info('Disconnected from Instagram realtime successfully');
      }
    } catch (error) {
      logger.warn('Error during disconnect:', error.message);
    }
  }
}