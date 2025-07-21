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
        logger.warn('⚠️ Challenge required. Attempting resolution...');
        
        // Get challenge state
        const challengeState = await this.ig.challenge.state();
        logger.debug('Challenge state:', JSON.stringify(challengeState, null, 2));
        
        // Handle different challenge types
        if (challengeState.step_name === 'SELECT_VERIFICATION_METHOD') {
          logger.info('📧 Verification method selection required');
          
          // Try selecting email verification
          try {
            await this.ig.challenge.selectVerifyMethod('0'); // 0 = email
            logger.info('📩 Email verification selected');
          } catch {
            try {
              await this.ig.challenge.selectVerifyMethod('1'); // 1 = SMS
              logger.info('📱 SMS verification selected');
            } catch (selectError) {
              logger.error('❌ Could not select verification method:', selectError);
              throw new Error('Verification method selection failed');
            }
          }

          // Prompt for code
          const { code } = await this.promptForCode();
          logger.info('🔐 Verifying code...');
          
          // Send verification code
          const result = await this.ig.challenge.sendSecurityCode(code);
          if (result.status === 'ok') {
            await this.saveSession();
            logger.info('✅ Challenge resolved successfully');
            this.startMessageListener();
            return;
          }
        }
        
        // Handle web-based challenges
        if (challengeState.webUrl) {
          logger.info('🌐 Web-based challenge detected');
          logger.info(`🔗 Challenge URL: https://instagram.com${challengeState.webUrl}`);
          logger.info('ℹ️ Complete verification in browser then restart bot');
          throw new Error('Manual web verification required');
        }
        
        throw new Error('Unsupported challenge type');
      }
      // ... handle other errors ...
    }
  } catch (error) {
    logger.error('❌ Login failed:', error.message);
    throw error;
  }

          // Prompt for verification code
          const { code } = await this.promptForCode();
          logger.info('🔐 Attempting to verify code...');
          
          const result = await this.ig.challenge.sendSecurityCode(code);
          
          if (result && result.logged_in_user) {
            await this.saveSession();
            logger.info('✅ Successfully verified challenge and logged in.');
            this.startMessageListener();
          } else if (result && result.status === 'ok') {
            // Some challenges return different success indicators
            await this.saveSession();
            logger.info('✅ Challenge completed successfully.');
            this.startMessageListener();
          } else {
            throw new Error('Challenge verification failed - invalid code or other issue');
          }
          
        } catch (challengeError) {
          logger.error('❌ Challenge resolution failed:', challengeError.message);
          
          // Final fallback: Manual resolution instructions
          logger.info('💡 Alternative solutions:');
          logger.info('1. Delete session file and wait 24 hours before retrying');
          logger.info('2. Try logging in from Instagram mobile app first');
          logger.info('3. Use a different network/IP address');
          logger.info('4. Complete verification via Instagram web interface');
          
          throw challengeError;
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
