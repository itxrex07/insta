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
  }

async login() {
  try {
    // Load existing session if available
    await this.loadSession();

    const username = config.instagram.username;
    const password = config.instagram.password;

    if (!username || !password) {
      throw new Error('❌ Instagram credentials are missing. Set INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD.');
    }

    this.ig.state.generateDevice(username);

    // Try to login with existing session first
    try {
      await this.ig.account.currentUser();
      logger.info('✅ Logged in with existing session');
      this.startMessageListener();
      return;
    } catch {
      logger.info('🔄 Existing session invalid, logging in with credentials...');
    }

    try {
      await this.ig.simulate.preLoginFlow();
      await this.ig.account.login(username, password);
      await this.ig.simulate.postLoginFlow();

      await this.saveSession();
      logger.info('✅ Successfully logged into Instagram');
      this.startMessageListener();
    } catch (error) {
      if (error.name === 'IgCheckpointError') {
        logger.warn('⚠️ Challenge required. Attempting manual resolution...');

        try {
          // First, get the challenge info
          const challenge = await this.ig.challenge.auto(false);
          logger.info(`📧 Challenge step name: ${challenge.step_name}`);
          logger.info(`📱 Available methods: ${challenge.step_data?.choice || 'email/phone'}`);
          
          // Select verification method (0 = email, 1 = phone)
          await this.ig.challenge.selectVerifyMethod('0'); // Email verification
          logger.info('📩 Verification code sent to your email');
          
          const { code } = await this.promptForCode();
          const result = await this.ig.challenge.sendSecurityCode(code);
          
          if (result.logged_in_user) {
            await this.saveSession();
            logger.info('✅ Successfully verified challenge and logged in.');
            this.startMessageListener();
          } else {
            throw new Error('Challenge verification failed');
          }
          
        } catch (challengeError) {
          logger.error('❌ Challenge resolution failed:', challengeError.message);
          
          // If challenge fails, try alternative approach
          if (challengeError.message.includes('No checkpoint data')) {
            logger.info('🔄 Trying alternative challenge approach...');
            try {
              // Reset and try again
              await this.ig.challenge.reset();
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
              
              const challenge = await this.ig.challenge.auto(true); // Auto-select method
              const { code } = await this.promptForCode();
              await this.ig.challenge.sendSecurityCode(code);
              
              await this.saveSession();
              logger.info('✅ Successfully verified challenge with alternative method.');
              this.startMessageListener();
            } catch (altError) {
              logger.error('❌ Alternative challenge method also failed:', altError.message);
              throw altError;
            }
          } else {
            throw challengeError;
          }
        }

      } else if (error.name === 'IgLoginTwoFactorRequiredError') {
        logger.warn('⚠️ Two-factor authentication required');
        try {
          const { code } = await this.promptForTwoFactorCode();
          const result = await this.ig.account.twoFactorLogin({
            username,
            verificationCode: code,
            twoFactorIdentifier: error.response.body.two_factor_info.two_factor_identifier,
            verificationMethod: '1', // '1' = SMS, '0' = authenticator app
            trustThisDevice: '1'
          });
          
          if (result) {
            await this.saveSession();
            logger.info('✅ Successfully logged in with 2FA');
            this.startMessageListener();
          }
        } catch (twoFactorError) {
          logger.error('❌ 2FA verification failed:', twoFactorError.message);
          throw twoFactorError;
        }
      } else {
        logger.error('❌ Instagram login failed:', error.message);
        throw error;
      }
    }

  } catch (error) {
    logger.error('❌ Failed to initialize bot:', error.message);
    throw error;
  }
}

promptForCode() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('📩 Enter the 6-digit Instagram verification code: ', (code) => {
      rl.close();
      resolve({ code });
    });
  });
}

promptForTwoFactorCode() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('🔐 Enter your 6-digit 2FA code: ', (code) => {
      rl.close();
      resolve({ code });
    });
  });
}
  async loadSession() {
    try {
      if (await fileUtils.pathExists(this.sessionPath)) {
        const sessionData = await fileUtils.readJson(this.sessionPath);
        if (sessionData) {
          await this.ig.state.deserialize(sessionData);
          logger.info('📱 Loaded Instagram session');
        }
      }
    } catch (error) {
      logger.warn('⚠️ Could not load session:', error.message);
    }
  }

  async saveSession() {
    try {
      const serialized = await this.ig.state.serialize();
      delete serialized.constants;
      await fileUtils.writeJson(this.sessionPath, serialized);
      logger.info('💾 Instagram session saved');
    } catch (error) {
      logger.warn('⚠️ Could not save session:', error.message);
    }
  }

  startMessageListener() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    logger.info('👂 Started message listener');
    
    // Check for messages periodically
    setInterval(async () => {
      if (this.isRunning) {
        try {
          await this.checkForNewMessages();
        } catch (error) {
          logger.error('Error checking messages:', error);
        }
      }
    }, config.instagram.messageCheckInterval);
  }

  async checkForNewMessages() {
    try {
      const inbox = await this.ig.feed.directInbox().items();
      
      for (const thread of inbox) {
        const messages = await this.ig.feed.directThread({
          thread_id: thread.thread_id
        }).items();
        
        // Only check the latest message
        for (const message of messages.slice(0, 1)) {
          if (this.isNewMessage(message)) {
            await this.handleMessage(message, thread);
          }
        }
      }
    } catch (error) {
      logger.error('Error fetching messages:', error);
    }
  }

  isNewMessage(message) {
    // Simple check - in production, you'd track processed message IDs
    const messageAge = Date.now() - (message.timestamp / 1000);
    return messageAge < 10000; // Messages newer than 10 seconds
  }

  async handleMessage(message, thread) {
    const processedMessage = {
      id: message.item_id,
      text: message.text || '',
      sender: message.user_id,
      senderUsername: thread.users.find(u => u.pk === message.user_id)?.username || 'Unknown',
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
      
      // Notify media handlers
      for (const handler of this.mediaHandlers) {
        await handler(processedMessage);
      }
    }

    // Notify message handlers
    for (const handler of this.messageHandlers) {
      await handler(processedMessage);
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
      logger.info(`📤 Sent message to thread ${threadId}`);
    } catch (error) {
      logger.error('Error sending message:', error);
    }
  }

  async disconnect() {
    logger.info('🔌 Disconnecting from Instagram...');
    this.isRunning = false;
    await this.saveSession();
  }
}
