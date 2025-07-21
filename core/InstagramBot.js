import { IgApiClient } from 'instagram-private-api';
import { logger, fileUtils } from '../utils.js';
import { config } from '../config.js';
import readline from 'readline';

export class InstagramBot {
  constructor() {
    this.ig = new IgApiClient();
    this.messageHandlers = [];
    this.mediaHandlers = [];
    this.sessionPath = config.instagram.sessionPath;
    this.isRunning = false;
    this.lastMessageCheck = new Date();
  }

  async login() {
    const username = config.instagram.username;
    const password = config.instagram.password;

    if (!username || !password) {
      throw new Error('❌ Instagram credentials are missing in config');
    }

    try {
      // Generate device and set user agent
      this.ig.state.generateDevice(username);
      
      // Set additional headers to mimic real device
      this.ig.request.defaults.headers = {
        'User-Agent': this.ig.state.appUserAgent,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'X-IG-App-Locale': 'en_US',
        'X-IG-Device-Locale': 'en_US',
        'X-IG-Mapped-Locale': 'en_US',
        'X-Pigeon-Session-Id': this.ig.state.pigeonSessionId,
        'X-Pigeon-Rawclienttime': (Date.now() / 1000).toFixed(3),
        'X-IG-Bandwidth-Speed-KBPS': '-1.000',
        'X-IG-Bandwidth-TotalBytes-B': '0',
        'X-IG-Bandwidth-TotalTime-MS': '0',
        'X-IG-App-Startup-Country': 'US',
        'X-Bloks-Version-Id': this.ig.state.bloksVersionId,
        'X-IG-WWW-Claim': '0',
        'X-Bloks-Is-Layout-RTL': 'false',
        'X-Bloks-Is-Panorama-Enabled': 'true',
        'X-IG-Device-ID': this.ig.state.uuid,
        'X-IG-Family-Device-ID': this.ig.state.deviceId,
        'X-IG-Android-ID': this.ig.state.androidId,
        'X-IG-Timezone-Offset': '0',
        'X-IG-Connection-Type': 'WIFI',
        'X-IG-Capabilities': '3brTvwM=',
        'X-IG-App-ID': '567067343352427',
        'Priority': 'u=3',
        'X-FB-HTTP-Engine': 'Liger'
      };

      // Try to load existing session first
      if (await this.loadSession()) {
        try {
          const user = await this.ig.account.currentUser();
          logger.info(`✅ Logged in with existing session as @${user.username}`);
          this.startMessageListener();
          return;
        } catch (error) {
          logger.warn('⚠️ Existing session invalid, logging in with credentials...');
        }
      }

      // Simulate pre-login flow
      logger.info('🔄 Simulating pre-login flow...');
      await this.ig.simulate.preLoginFlow();
      
      // Add delay to avoid rate limiting
      await this.delay(2000);

      // Perform login
      logger.info('🔐 Attempting login...');
      const loginResult = await this.ig.account.login(username, password);
      
      // Simulate post-login flow
      await this.ig.simulate.postLoginFlow();
      
      // Save session
      await this.saveSession();
      
      logger.info(`✅ Successfully logged in as @${loginResult.username}`);
      this.startMessageListener();

    } catch (error) {
      logger.error('❌ Instagram login failed:', error.message);
      
      // Handle specific error types
      if (error.name === 'IgCheckpointError') {
        logger.error('🚫 Account requires verification. Please verify your account manually.');
        logger.info('💡 Try logging in through the Instagram app first, then restart the bot.');
      } else if (error.name === 'IgLoginTwoFactorRequiredError') {
        logger.error('🔐 Two-factor authentication required. Please disable 2FA temporarily.');
      } else if (error.name === 'IgSentryBlockError') {
        logger.error('🚫 Account temporarily blocked. Wait 24-48 hours before retrying.');
      } else if (error.message.includes('challenge_required')) {
        logger.error('🚫 Challenge required. Please verify your account manually.');
      } else if (error.message.includes('rate_limit')) {
        logger.error('⚠️ Rate limited. Please wait and try again later.');
      } else if (error.message.includes('Invalid parameters')) {
        logger.error('❌ Invalid username or password. Please check your credentials.');
      }
      
      throw error;
    }
  }

  async loadSession() {
    try {
      if (await fileUtils.pathExists(this.sessionPath)) {
        const sessionData = await fileUtils.readJson(this.sessionPath);
        if (sessionData && sessionData.cookies) {
          await this.ig.state.deserialize(sessionData);
          return true;
        }
      }
    } catch (error) {
      logger.warn('⚠️ Failed to load session:', error.message);
    }
    return false;
  }

  async saveSession() {
    try {
      const serialized = await this.ig.state.serialize();
      delete serialized.constants; // Remove unnecessary data
      await fileUtils.writeJson(this.sessionPath, serialized);
      logger.info('💾 Session saved successfully');
    } catch (error) {
      logger.warn('⚠️ Failed to save session:', error.message);
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
    } catch (error) {
      logger.error('❌ Error sending message:', error.message);
      throw error;
    }
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