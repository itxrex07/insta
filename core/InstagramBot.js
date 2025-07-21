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
  const MAX_LOGIN_ATTEMPTS = 3;
  let attemptCount = 0;
  const username = config.instagram.username;
  const password = config.instagram.password;

  if (!username || !password) {
    throw new Error('❌ Instagram credentials are missing in config');
  }

  // Generate device state
  this.ig.state.generateDevice(username);
  this.ig.request.end$.subscribe(this.saveSession.bind(this));

  while (attemptCount < MAX_LOGIN_ATTEMPTS) {
    attemptCount++;
    logger.info(`🔐 Login attempt ${attemptCount}/${MAX_LOGIN_ATTEMPTS}`);

    try {
      // Try existing session first
      if (await this.loadSession()) {
        try {
          await this.ig.account.currentUser();
          logger.info('✅ Logged in with existing session');
          this.startMessageListener();
          return true;
        } catch (sessionError) {
          logger.warn('⚠️ Session expired:', sessionError.message);
          await fileUtils.deleteFile(this.sessionPath);
        }
      }

      // New login flow
      logger.info('🔄 Attempting new login...');
      await this.ig.simulate.preLoginFlow();
      
      // Main login attempt
      const loggedInUser = await this.ig.account.login(username, password);
      await this.ig.simulate.postLoginFlow();

      // Check if login was successful but needs challenge
      if (loggedInUser.status === 'ok' && loggedInUser.requires_challenge) {
        logger.warn('⚠️ Challenge required after login');
        const challengeHandled = await this.handleChallenge();
        if (!challengeHandled) throw new Error('Challenge resolution failed');
      }

      await this.saveSession();
      logger.info(`✅ Successfully logged in as @${loggedInUser.username}`);
      this.startMessageListener();
      return true;

    } catch (error) {
      logger.error(`❌ Login attempt ${attemptCount} failed:`, error.message);

      // Handle specific error cases
      switch (error.name) {
        case 'IgCheckpointError':
          logger.warn('⚠️ Checkpoint challenge required');
          try {
            if (await this.handleChallenge()) {
              await this.saveSession();
              this.startMessageListener();
              return true;
            }
          } catch (challengeError) {
            logger.error('❌ Challenge handling failed:', challengeError.message);
          }
          break;

        case 'IgLoginTwoFactorRequiredError':
          logger.warn('⚠️ Two-factor authentication required');
          try {
            if (await this.handleTwoFactor(error.response.body.two_factor_info)) {
              await this.saveSession();
              this.startMessageListener();
              return true;
            }
          } catch (twoFactorError) {
            logger.error('❌ 2FA failed:', twoFactorError.message);
          }
          break;

        case 'IgSentryBlockError':
          logger.error('🚫 Account temporarily blocked by Instagram');
          logger.info('ℹ️ Wait 24-48 hours before retrying');
          throw error;

        case 'IgActionSpamError':
          logger.error('⚠️ Login attempt flagged as spam');
          logger.info('ℹ️ Change network/IP and try again later');
          throw error;
      }

      // Exponential backoff between attempts
      if (attemptCount < MAX_LOGIN_ATTEMPTS) {
        const waitTime = Math.pow(2, attemptCount) * 1000;
        logger.info(`⏳ Waiting ${waitTime/1000}s before next attempt...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  throw new Error(`Failed to login after ${MAX_LOGIN_ATTEMPTS} attempts`);
}

async handleChallenge() {
  try {
    const challengeState = await this.ig.challenge.state();
    logger.debug('Challenge state:', JSON.stringify(challengeState, null, 2));

    // Handle verification method selection
    if (challengeState.step_name === 'SELECT_VERIFICATION_METHOD') {
      logger.info('📧 Selecting verification method...');
      
      // Try email first, then SMS
      const methods = await this.ig.challenge.selectVerifyMethod('0').catch(() => 
        this.ig.challenge.selectVerifyMethod('1')
      );
      
      logger.info(`📩 Selected method: ${methods.step_name}`);
    }

    // Handle web challenge
    if (challengeState.step_name === 'CHALLENGE_STEP_WEBVIEW') {
      const webUrl = challengeState.web_url || challengeState.url;
      logger.info('🌐 Web challenge detected');
      logger.info(`🔗 Complete verification at: https://instagram.com${webUrl}`);
      logger.info('ℹ️ After completing, restart the bot');
      throw new Error('Manual web verification required');
    }

    // Handle code entry
    if (challengeState.step_name === 'CHALLENGE_STEP_CODE') {
      const { code } = await this.promptForCode();
      logger.info('🔐 Submitting verification code...');
      
      const result = await this.ig.challenge.sendSecurityCode(code);
      if (result.status === 'ok' || result.logged_in_user) {
        logger.info('✅ Challenge verification successful');
        return true;
      }
      throw new Error('Invalid verification code');
    }

    throw new Error(`Unsupported challenge step: ${challengeState.step_name}`);
  } catch (error) {
    logger.error('❌ Challenge handling failed:', error.message);
    throw error;
  }
}

async handleTwoFactor(twoFactorInfo) {
  try {
    logger.info('🔐 Two-factor authentication required');
    const { code } = await this.promptForTwoFactorCode();
    
    const result = await this.ig.account.twoFactorLogin({
      username: config.instagram.username,
      verificationCode: code,
      twoFactorIdentifier: twoFactorInfo.two_factor_identifier,
      verificationMethod: twoFactorInfo.totp_two_factor_on ? '0' : '1', // 0=TOTP, 1=SMS
      trustThisDevice: '1',
      deviceId: this.ig.state.deviceId
    });

    if (result.status === 'ok') {
      logger.info('✅ 2FA verification successful');
      return true;
    }
    throw new Error('2FA verification failed');
  } catch (error) {
    logger.error('❌ 2FA handling failed:', error.message);
    throw error;
  }
}

async loadSession() {
  try {
    if (await fileUtils.pathExists(this.sessionPath)) {
      const sessionData = await fileUtils.readJson(this.sessionPath);
      if (sessionData) {
        await this.ig.state.deserialize(sessionData);
        
        // Validate device state
        if (!this.ig.state.deviceId || !this.ig.state.uuid) {
          this.ig.state.generateDevice(config.instagram.username);
        }
        
        logger.info('📱 Loaded existing session');
        return true;
      }
    }
    return false;
  } catch (error) {
    logger.warn('⚠️ Session load failed:', error.message);
    return false;
  }
}

async saveSession() {
  try {
    const serialized = await this.ig.state.serialize();
    delete serialized.constants; // Remove unnecessary data
    await fileUtils.writeJson(this.sessionPath, serialized);
    logger.debug('💾 Session saved');
  } catch (error) {
    logger.warn('⚠️ Session save failed:', error.message);
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
