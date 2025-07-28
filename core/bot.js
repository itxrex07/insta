import { IgApiClient } from 'instagram-private-api';
import { withFbnsAndRealtime, GraphQLSubscriptions, SkywalkerSubscriptions } from 'instagram_mqtt';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import { writeFile, readFile, exists } from 'fs';
import tough from 'tough-cookie';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { EventEmitter } from 'events';
import camelcaseKeys from 'camelcase-keys';

const writeFileAsync = promisify(writeFile);
const readFileAsync = promisify(readFile);
const existsAsync = promisify(exists);

export class InstagramBot extends EventEmitter {
  constructor() {
    super();
    this.ig = withFbnsAndRealtime(new IgApiClient());
    this.isRunning = false;
    this.processedMessageIds = new Set();
    this.maxProcessedMessageIds = 1000;
    this.pushContext = {};
    this.connectionRetries = 0;
    this.maxRetries = config.app.maxRetries;
  }

  async login() {
    try {
      const username = config.instagram.username || process.env.IG_USERNAME || '';
      if (!username) {
        throw new Error('Instagram username is required');
      }

      this.ig.state.generateDevice(username);
      let loginSuccess = false;

      // Try reading FBNS/Realtime state first
      await this.readState();

      // Try session login
      if (await this.trySessionLogin()) {
        loginSuccess = true;
      }
      // Try cookies if session failed
      else if (await this.tryCookieLogin()) {
        loginSuccess = true;
      }
      // Try fresh login if both failed
      else if ((config.instagram.password || process.env.IG_PASSWORD) && await this.tryFreshLogin()) {
        loginSuccess = true;
      }

      if (!loginSuccess) {
        throw new Error('All login methods failed');
      }

      // Subscribe to request end for saving state
      this.ig.request.end$.subscribe(() => this.saveState());

      // Setup FBNS and Realtime connections
      await this.setupConnections();
      this.isRunning = true;
      logger.info('Instagram bot is now running with FBNS and Realtime support');
      this.emit('ready');
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
      const password = config.instagram.password || process.env.IG_PASSWORD || '';
      await this.ig.account.login(config.instagram.username || process.env.IG_USERNAME, password);
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

  async saveState() {
    try {
      await writeFileAsync('state.json', await this.ig.exportState(), { encoding: 'utf8' });
      logger.debug('FBNS/Realtime state saved successfully');
    } catch (error) {
      logger.error('Failed to save FBNS/Realtime state:', error.message);
    }
  }

  async readState() {
    try {
      if (!(await existsAsync('state.json'))) return;
      await this.ig.importState(await readFileAsync('state.json', { encoding: 'utf8' }));
      logger.debug('FBNS/Realtime state loaded successfully');
    } catch (error) {
      logger.error('Failed to load FBNS/Realtime state:', error.message);
    }
  }

  async setupConnections() {
    this.registerHandlers();
    
    try {
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
        connectOverrides: {},
        socksOptions: config.proxy ? {
          type: config.proxy.type || 5,
          host: config.proxy.host,
          port: config.proxy.port,
          userId: config.proxy.username,
          password: config.proxy.password,
        } : undefined,
      });

      await this.ig.fbns.connect();
      logger.info('FBNS and Realtime connections established');
    } catch (error) {
      logger.error('Failed to establish connections:', error.message);
      throw error;
    }
  }

  registerHandlers() {
    // Realtime (MQTT) Handlers
    this.ig.realtime.on('message', async (data) => {
      try {
        if (!data.message || !this.isNewMessageById(data.message.item_id, data.message.thread_id)) {
          logger.debug(`Message ${data.message.item_id} filtered as duplicate`);
          return;
        }
        await this.handleMessage(data.message, data);
      } catch (error) {
        logger.error('Error in message handler:', error.message);
      }
    });

    this.ig.realtime.on('direct', async (data) => {
      try {
        if (data.message && this.isNewMessageById(data.message.item_id, data.message.thread_id)) {
          await this.handleMessage(data.message, data);
        }
      } catch (error) {
        logger.error('Error in direct handler:', error.message);
      }
    });

    this.ig.realtime.on('push', async (data) => {
      try {
        const { collapseKey, payload } = camelcaseKeys(data, { deep: true });
        logger.info(`Push notification received, collapseKey: ${collapseKey}`);
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
            
            logger.info(`Push notification - Thread ID: ${threadId}, Item ID: ${itemId}`);
            this.emit('push', { threadId, itemId, payload });
            
            // Cleanup push context if too large
            if (Object.keys(this.pushContext).length > 100) {
              this.pushContext = {};
              logger.debug('Cleared push context cache (size limit)');
            }
          }
        } else if (collapseKey === 'consolidated_notification_ig' || collapseKey?.startsWith('notification')) {
          this.ig.realtime.emit('activity', data);
          logger.info('Forwarded activity notification');
        }
      } catch (error) {
        logger.error('Error processing push notification:', error.message);
      }
    });

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

    this.ig.realtime.on('receive', (topic, messages) => {
      const topicStr = String(topic || '');
      if (topicStr.includes('direct') || topicStr.includes('message') || topicStr.includes('iris')) {
        logger.debug(`Received on topic: ${topicStr}`);
      } else {
        logger.trace(`Received on other topic: ${topicStr}`);
      }
    });

    this.ig.realtime.on('threadUpdate', (data) => {
      logger.info('Thread update event received');
      logger.debug('Thread update details:', JSON.stringify(data, null, 2));
    });

    this.ig.realtime.on('realtimeSub', (data) => {
      logger.info('Generic realtime subscription event received');
      logger.debug('RealtimeSub details:', JSON.stringify(data, null, 2));
    });

    this.ig.realtime.on('presence', (data) => {
      logger.info('Presence update event received');
      logger.debug('Presence details:', JSON.stringify(data, null, 2));
    });

    this.ig.realtime.on('typing', (data) => {
      logger.info('Typing indicator event received');
      logger.debug('Typing details:', JSON.stringify(data, null, 2));
    });

    this.ig.realtime.on('messageStatus', (data) => {
      logger.info('Message status update event received');
      logger.debug('MessageStatus details:', JSON.stringify(data, null, 2));
    });

    this.ig.realtime.on('liveNotification', (data) => {
      logger.info('Live stream notification event received');
      logger.debug('LiveNotification details:', JSON.stringify(data, null, 2));
    });

    this.ig.realtime.on('activity', (data) => {
      logger.info('Activity notification event received');
      logger.debug('Activity details:', JSON.stringify(data, null, 2));
    });

    this.ig.realtime.on('reconnect', () => {
      logger.info('Realtime client is attempting to reconnect');
    });

    this.ig.realtime.on('debug', (data) => {
      logger.trace('Realtime debug info:', data);
    });

    // FBNS Handlers
    this.ig.fbns.on('push', (data) => {
      logger.info('FBNS push notification received');
      logger.debug('FBNS push details:', JSON.stringify(data, null, 2));
      this.emit('fbnsPush', data);
    });

    this.ig.fbns.on('auth', async (auth) => {
      logger.info('FBNS auth received');
      logger.debug('FBNS auth details:', JSON.stringify(auth, null, 2));
      await this.saveState();
      this.emit('fbnsAuth', auth);
    });

    this.ig.fbns.on('error', (error) => {
      logger.error('FBNS error:', error.message);
      this.emit('fbnsError', error);
    });

    this.ig.fbns.on('warning', (warning) => {
      logger.warn('FBNS warning:', warning.message);
      this.emit('fbnsWarning', warning);
    });
  }

  async handleConnectionError() {
    if (this.connectionRetries < this.maxRetries) {
      this.connectionRetries++;
      logger.info(`Attempting to reconnect (${this.connectionRetries}/${this.maxRetries})...`);
      
      setTimeout(async () => {
        try {
          await this.setupConnections();
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
    if (!messageId) {
      logger.warn('Attempted to check message ID, but ID was missing');
      return true;
    }
    
    if (this.processedMessageIds.has(messageId)) {
      logger.debug(`Message ${messageId} filtered as duplicate (by ID)`);
      return false;
    }

    if (threadId && this.pushContext[threadId]?.has(messageId)) {
      logger.debug(`Message ${messageId} filtered as duplicate (by Push Context for thread ${threadId})`);
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
        logger.warn('Received message with missing essential fields');
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

      logger.info(`New message from @${senderUsername} in ${processedMessage.threadTitle}: "${processedMessage.text}"`);
      this.emit('message', processedMessage);
      
    } catch (error) {
      logger.error('Error handling message:', error.message);
    }
  }

  async sendMessage(threadId, text) {
    if (!threadId || !text) {
      logger.warn('sendMessage called with missing threadId or text');
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
      const threads = pendingResponse.inbox?.threads || [];
      logger.info(`Fetched ${threads.length} message requests`);
      return threads;
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

  async declineMessageRequest(threadId) {
    try {
      await this.ig.directThread.decline(threadId);
      logger.info(`Declined message request: ${threadId}`);
      return true;
    } catch (error) {
      logger.error(`Error declining message request ${threadId}:`, error.message);
      return false;
    }
  }

  async subscribeToLiveComments(broadcastId) {
    try {
      await this.ig.realtime.graphQlSubscribe(
        GraphQLSubscriptions.getLiveRealtimeCommentsSubscription(broadcastId)
      );
      logger.info(`Subscribed to live comments for broadcast: ${broadcastId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to subscribe to live comments for ${broadcastId}:`, error.message);
      return false;
    }
  }

  async setForegroundState(inApp = true, inDevice = true, timeoutSeconds = 60) {
    try {
      const timeout = inApp ? Math.max(10, timeoutSeconds) : 900;
      await this.ig.realtime.direct.sendForegroundState({
        inForegroundApp: Boolean(inApp),
        inForegroundDevice: Boolean(inDevice),
        keepAliveTimeout: timeout,
      });
      logger.info(`Foreground state set: App=${inApp}, Device=${inDevice}, Timeout=${timeout}s`);
      return true;
    } catch (error) {
      logger.error('Failed to set foreground state:', error.message);
      return false;
    }
  }

  async disconnect() {
    logger.info('Disconnecting from Instagram...');
    this.isRunning = false;
    this.pushContext = {};

    try {
      await this.setForegroundState(false, false, 900);
      if (this.ig.realtime && typeof this.ig.realtime.disconnect === 'function') {
        await this.ig.realtime.disconnect();
        logger.info('Disconnected from Instagram Realtime successfully');
      }
      if (this.ig.fbns && typeof this.ig.fbns.disconnect === 'function') {
        await this.ig.fbns.disconnect();
        logger.info('Disconnected from Instagram FBNS successfully');
      }
    } catch (error) {
      logger.warn('Error during disconnect:', error.message);
    }
  }
}
// Main execution logic
async function main() {
  let bot;
  try {
    bot = new InstagramBot();
    await bot.login(); // ✅ Login with cookies or credentials
    // ✅ Load all modules
    const moduleManager = new ModuleManager(bot);
    await moduleManager.loadModules();
    // ✅ Setup message handler
    const messageHandler = new MessageHandler(bot, moduleManager, null); // Assuming null is okay for the third arg
    // ✅ Route incoming messages to the handler
    bot.onMessage((message) => messageHandler.handleMessage(message));
    // ✅ Start monitoring message requests
    await bot.startMessageRequestsMonitor(); // Use default interval
    console.log('🚀 Bot is running with full module support. Type .help or use your commands.');
    // ✅ Periodic heartbeat/status log (more frequent for debugging, can be longer)

    // ✅ Graceful shutdown handling
    const shutdownHandler = async () => {
      console.log('\n👋 [SIGINT/SIGTERM] Shutting down gracefully...');
      if (bot) {
        await bot.disconnect();
      }
      console.log('🛑 Shutdown complete.');
      process.exit(0);
    };
    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler); // Handle termination signals
  } catch (error) {
    console.error('❌ Bot failed to start:', error.message);
    // Attempt cleanup if bot was partially initialized
    if (bot) {
      try {
        await bot.disconnect();
      } catch (disconnectError) {
        console.error('❌ Error during cleanup disconnect:', disconnectError.message);
      }
    }
    process.exit(1);
  }
}

// Run main only if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Unhandled error in main execution:', error.message);
    process.exit(1);
  }); 
}

// Export for external usage
export { InstagramBot };
