import { IgApiClient } from 'instagram-private-api';
import { withRealtime } from 'instagram_mqtt';
import { GraphQLSubscriptions, SkywalkerSubscriptions } from 'instagram_mqtt';
import { promises as fs } from 'fs'; // Use fs.promises for async/await compatibility
import tough from 'tough-cookie';
import { ModuleManager } from './module-manager.js';
import { MessageHandler } from './message-handler.js';
import { config } from '../config.js'; // Assuming config.js provides necessary credentials and settings

/**
 * @typedef {object} ProcessedMessage
 * @property {string} id - Unique ID of the message.
 * @property {string} text - The content of the message.
 * @property {string} senderId - The Instagram user ID of the sender.
 * @property {string} senderUsername - The Instagram username of the sender.
 * @property {Date} timestamp - The timestamp when the message was sent.
 * @property {string} threadId - The ID of the conversation thread.
 * @property {string} threadTitle - The title of the conversation thread.
 * @property {string} type - The type of message (e.g., 'text', 'like').
 * @property {object} raw - The raw message object from the Instagram API.
 */

/**
 * Manages the Instagram bot's lifecycle, including login, real-time message handling,
 * and integration with external modules.
 */
class InstagramBot {
  /**
   * Initializes the InstagramBot instance.
   */
  constructor() {
    this.ig = withRealtime(new IgApiClient());
    /** @type {Array<function(ProcessedMessage): Promise<void>>} */
    this.messageHandlers = [];
    this.isRunning = false;
    // Improved message deduplication using IDs
    this.processedMessageIds = new Set();
    this.maxProcessedMessageIds = 1000; // Max number of message IDs to store for deduplication
    this.messageRequestsMonitorInterval = null;
  }

  /**
   * Logs messages to the console with a timestamp and specified level.
   * @param {'INFO'|'WARN'|'ERROR'|'DEBUG'|'TRACE'} level - The log level.
   * @param {string} message - The message to log.
   * @param {...any} args - Additional arguments to pass to console.log.
   */
  log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`, ...args);
  }

  /**
   * Attempts to log in to Instagram using session, cookies, or direct credentials.
   * Prioritizes existing sessions/cookies for faster login.
   * @returns {Promise<void>}
   * @throws {Error} If login fails after all attempts.
   */
  async login() {
    const { username } = config.instagram || {};

    if (!username) {
      throw new Error('❌ Instagram username is missing in configuration.');
    }

    this.ig.state.generateDevice(username);
    let loginSuccess = false;

    // Attempt 1: Load session from session.json
    try {
      await fs.access('./session.json');
      this.log('INFO', '📂 Found session.json, attempting to log in from session...');
      const sessionData = JSON.parse(await fs.readFile('./session.json', 'utf-8'));
      await this.ig.state.deserialize(sessionData);

      try {
        await this.ig.account.currentUser(); // Validate session
        this.log('INFO', '✅ Logged in successfully from session.json');
        loginSuccess = true;
      } catch (validationError) {
        this.log('WARN', `⚠️ Session validation failed: ${validationError.message}. Attempting cookie login.`);
      }
    } catch (sessionAccessError) {
      this.log('INFO', '📂 session.json not found or invalid. Attempting cookies.json...');
    }

    // Attempt 2: Load cookies from cookies.json if session login failed
    if (!loginSuccess) {
      try {
        await this.loadCookiesFromJson('./cookies.json');

        try {
          const currentUserResponse = await this.ig.account.currentUser(); // Validate cookies
          this.log('INFO', `✅ Logged in successfully using cookies.json as @${currentUserResponse.username}`);
          loginSuccess = true;

          // Save session after successful cookie login for future fast logins
          const session = await this.ig.state.serialize();
          delete session.constants; // Remove constants before saving
          await fs.writeFile('./session.json', JSON.stringify(session, null, 2));
          this.log('INFO', '💾 Session saved to session.json from cookie-based login.');
        } catch (cookieValidationError) {
          this.log('ERROR', `❌ Failed to validate login using cookies.json: ${cookieValidationError.message}`);
          throw new Error(`Cookie login validation failed: ${cookieValidationError.message}`);
        }
      } catch (cookieLoadError) {
        this.log('ERROR', `❌ Failed to load or process cookies.json: ${cookieLoadError.message}`);
        throw new Error(`Cookie loading failed: ${cookieLoadError.message}`);
      }
    }

    if (!loginSuccess) {
      throw new Error('No valid login method succeeded (session or cookies). Please ensure credentials are correct or session/cookie files are valid.');
    }

    // Register real-time handlers and connect after successful login
    this.registerRealtimeHandlers();
    await this.connectRealtime();

    this.isRunning = true;
    this.log('INFO', '🚀 Instagram bot is now running and listening for messages.');
  }

  /**
   * Connects to Instagram's real-time messaging service.
   * @private
   * @returns {Promise<void>}
   */
  async connectRealtime() {
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
        socksOptions: config.proxy ? {
          type: config.proxy.type || 5,
          host: config.proxy.host,
          port: config.proxy.port,
          userId: config.proxy.username,
          password: config.proxy.password,
        } : undefined,
      });
    } catch (error) {
      this.log('ERROR', `❌ Failed to connect to Instagram Realtime: ${error.message}`);
      throw error; // Re-throw to indicate a critical setup failure
    }
  }

  /**
   * Loads cookies from a JSON file and sets them in the Instagram API client's cookie jar.
   * @param {string} path - The path to the cookies JSON file.
   * @returns {Promise<void>}
   * @throws {Error} If the cookie file cannot be read or processed.
   */
  async loadCookiesFromJson(path = './cookies.json') {
    try {
      const raw = await fs.readFile(path, 'utf-8');
      const cookies = JSON.parse(raw);

      let cookiesLoaded = 0;
      for (const cookie of cookies) {
        const toughCookie = new tough.Cookie({
          key: cookie.name,
          value: cookie.value,
          domain: cookie.domain.replace(/^\./, ''),
          path: cookie.path || '/',
          secure: cookie.secure !== false,
          httpOnly: cookie.httpOnly !== false,
          expires: cookie.expires ? new Date(cookie.expires) : undefined,
        });

        await this.ig.state.cookieJar.setCookie(
          toughCookie.toString(),
          `https://${toughCookie.domain}${toughCookie.path}`
        );
        cookiesLoaded++;
      }
      this.log('INFO', `🍪 Successfully loaded ${cookiesLoaded}/${cookies.length} cookies from file.`);
    } catch (error) {
      this.log('ERROR', `❌ Critical error loading cookies from ${path}: ${error.message}`);
      this.log('DEBUG', 'Cookie loading error details:', error.stack);
      throw error; // Re-throw to stop the login process
    }
  }

  /**
   * Registers all real-time event handlers for the Instagram API client.
   * @private
   */
  registerRealtimeHandlers() {
    this.log('INFO', '📡 Registering real-time event handlers...');

    this.ig.realtime.on('message', async (data) => {
      this.log('DEBUG', '📨 [Realtime] Raw message event data received.');
      if (!data.message) {
        this.log('WARN', '⚠️ No message payload in event data.');
        return;
      }
      if (!this.isNewMessageById(data.message.item_id)) {
        this.log('DEBUG', `⚠️ Message ${data.message.item_id} filtered as duplicate (by ID).`);
        return;
      }
      this.log('INFO', '✅ Processing new message (by ID)...');
      await this.handleMessage(data.message, data);
    });

    this.ig.realtime.on('direct', async (data) => {
      this.log('DEBUG', '📨 [Realtime] Raw direct event data received.');
      if (data.message) {
        if (!this.isNewMessageById(data.message.item_id)) {
          this.log('DEBUG', `⚠️ Direct message ${data.message.item_id} filtered as duplicate (by ID).`);
          return;
        }
        this.log('INFO', '✅ Processing new direct message (by ID)...');
        await this.handleMessage(data.message, data);
      } else {
        this.log('INFO', 'ℹ️ Received non-message direct event.');
        this.log('DEBUG', 'Direct event details:', JSON.stringify(data, null, 2));
      }
    });

    this.ig.realtime.on('receive', (topic, messages) => {
      const topicStr = String(topic || '');
      if (topicStr.includes('direct') || topicStr.includes('message') || topicStr.includes('iris')) {
        this.log('DEBUG', `📥 [Realtime] Received on topic: ${topicStr}`);
      } else {
        this.log('TRACE', `📥 [Realtime] Received on other topic: ${topicStr}`);
      }
    });

    this.ig.realtime.on('error', (err) => {
      this.log('ERROR', `🚨 Realtime connection error: ${err.message || err}`);
    });

    this.ig.realtime.on('close', () => {
      this.log('WARN', '🔌 Realtime connection closed.');
      this.isRunning = false;
    });

    this.ig.realtime.on('threadUpdate', (data) => {
      this.log('INFO', '🧵 Thread update event received.');
      this.log('DEBUG', 'Thread update details:', JSON.stringify(data, null, 2));
    });

    this.ig.realtime.on('realtimeSub', (data) => {
      this.log('INFO', '🔄 Generic realtime subscription event received.');
      this.log('DEBUG', 'RealtimeSub details:', JSON.stringify(data, null, 2));
    });

    this.ig.realtime.on('presence', (data) => {
      this.log('INFO', '👤 Presence update event received.');
      this.log('DEBUG', 'Presence details:', JSON.stringify(data, null, 2));
    });

    this.ig.realtime.on('typing', (data) => {
      this.log('INFO', '⌨️ Typing indicator event received.');
      this.log('DEBUG', 'Typing details:', JSON.stringify(data, null, 2));
    });

    this.ig.realtime.on('messageStatus', (data) => {
      this.log('INFO', '📊 Message status update event received.');
      this.log('DEBUG', 'MessageStatus details:', JSON.stringify(data, null, 2));
    });

    this.ig.realtime.on('liveNotification', (data) => {
      this.log('INFO', '📺 Live stream notification event received.');
      this.log('DEBUG', 'LiveNotification details:', JSON.stringify(data, null, 2));
    });

    this.ig.realtime.on('activity', (data) => {
      this.log('INFO', '⚡ Activity notification event received.');
      this.log('DEBUG', 'Activity details:', JSON.stringify(data, null, 2));
    });

    this.ig.realtime.on('connect', () => {
      this.log('INFO', '🔗 Realtime connection successfully established.');
      this.isRunning = true;
    });

    this.ig.realtime.on('reconnect', () => {
      this.log('INFO', '🔁 Realtime client is attempting to reconnect.');
    });

    this.ig.realtime.on('debug', (data) => {
      this.log('TRACE', '🐛 Realtime debug info:', data);
    });
  }

  /**
   * Checks if a message ID has already been processed to prevent duplicates.
   * @param {string} messageId - The ID of the message.
   * @returns {boolean} True if the message is new, false if it's a duplicate.
   */
  isNewMessageById(messageId) {
    if (!messageId) {
      this.log('WARN', '⚠️ Attempted to check message ID, but ID was missing.');
      return true; // Default to processing if ID is missing
    }

    if (this.processedMessageIds.has(messageId)) {
      return false; // Already processed
    }

    this.processedMessageIds.add(messageId);

    // Prevent memory leak by removing oldest IDs
    if (this.processedMessageIds.size > this.maxProcessedMessageIds) {
      const oldestId = this.processedMessageIds.values().next().value;
      if (oldestId !== undefined) {
        this.processedMessageIds.delete(oldestId);
      }
    }
    return true; // It's new
  }

  /**
   * Processes an incoming Instagram message and dispatches it to registered handlers.
   * @param {object} message - The raw message object from Instagram.
   * @param {object} eventData - The raw event data associated with the message.
   * @returns {Promise<void>}
   */
  async handleMessage(message, eventData) {
    try {
      if (!message || !message.user_id || !message.item_id) {
        this.log('WARN', '⚠️ Received message with missing essential fields.');
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
        type: message.item_type || 'unknown_type',
        raw: message,
      };

      this.log('INFO', `💬 [${processedMessage.threadTitle}] New message from @${processedMessage.senderUsername}: "${processedMessage.text}"`);

      for (const handler of this.messageHandlers) {
        try {
          await handler(processedMessage);
        } catch (handlerError) {
          this.log('ERROR', `❌ Error in message handler (${handler.name || 'anonymous'}): ${handlerError.message}`);
          this.log('DEBUG', 'Handler error stack:', handlerError.stack);
        }
      }
    } catch (error) {
      this.log('ERROR', `❌ Critical error handling message: ${error.message}`);
      this.log('DEBUG', 'Raw message data:', JSON.stringify({ message, eventData }, null, 2));
    }
  }

  /**
   * Registers a function to be called when a new message is received.
   * @param {function(ProcessedMessage): Promise<void>} handler - The asynchronous function to call with the processed message.
   */
  onMessage(handler) {
    if (typeof handler === 'function') {
      this.messageHandlers.push(handler);
      this.log('INFO', `📝 Added message handler (total: ${this.messageHandlers.length}).`);
    } else {
      this.log('WARN', '⚠️ Attempted to add a non-function as a message handler.');
    }
  }

  /**
   * Sends a text message to a specific Instagram direct message thread.
   * @param {string} threadId - The ID of the thread to send the message to.
   * @param {string} text - The text content of the message.
   * @returns {Promise<boolean>} True if the message was sent successfully, false otherwise.
   * @throws {Error} If threadId or text are missing, or if sending fails.
   */
  async sendMessage(threadId, text) {
    if (!threadId || !text) {
      this.log('WARN', '⚠️ sendMessage called with missing threadId or text.');
      throw new Error('Thread ID and text are required to send a message.');
    }
    try {
      await this.ig.entity.directThread(threadId).broadcastText(text);
      this.log('INFO', `📤 Message sent successfully to thread ${threadId}: "${text}"`);
      return true;
    } catch (error) {
      this.log('ERROR', `❌ Error sending message to thread ${threadId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Subscribes to live comments for a specific Instagram broadcast.
   * @param {string} broadcastId - The ID of the live broadcast.
   * @returns {Promise<boolean>} True if subscription was successful, false otherwise.
   */
  async subscribeToLiveComments(broadcastId) {
    if (!broadcastId) {
      this.log('WARN', '⚠️ subscribeToLiveComments called without broadcastId.');
      return false;
    }
    try {
      await this.ig.realtime.graphQlSubscribe(
        GraphQLSubscriptions.getLiveRealtimeCommentsSubscription(broadcastId)
      );
      this.log('INFO', `📺 Successfully subscribed to live comments for broadcast: ${broadcastId}.`);
      return true;
    } catch (error) {
      this.log('ERROR', `Failed to subscribe to live comments for ${broadcastId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Simulates the Instagram application's foreground/background state.
   * @param {boolean} inApp - Whether the app is in the foreground.
   * @param {boolean} inDevice - Whether the device is in the foreground.
   * @param {number} timeoutSeconds - Keep-alive timeout in seconds.
   * @returns {Promise<boolean>} True if the state was set successfully, false otherwise.
   */
  async setForegroundState(inApp = true, inDevice = true, timeoutSeconds = 60) {
    const timeout = inApp ? Math.max(10, timeoutSeconds) : 900;

    try {
      await this.ig.realtime.direct.sendForegroundState({
        inForegroundApp: Boolean(inApp),
        inForegroundDevice: Boolean(inDevice),
        keepAliveTimeout: timeout,
      });
      this.log('INFO', `📱 Foreground state set: App=${Boolean(inApp)}, Device=${Boolean(inDevice)}, Timeout=${timeout}s.`);
      return true;
    } catch (error) {
      this.log('ERROR', `Failed to set foreground state: ${error.message}`);
      return false;
    }
  }

  /**
   * Demonstrates toggling the device foreground state after a short delay.
   * Useful for simulating user activity.
   * @returns {Promise<void>}
   */
  async simulateDeviceToggle() {
    this.log('INFO', '📱 Starting device simulation: Turning OFF...');
    const offSuccess = await this.setForegroundState(false, false, 900);
    if (!offSuccess) {
      this.log('WARN', '📱 Simulation step 1 (device off) might have failed.');
    }

    setTimeout(async () => {
      this.log('INFO', '📱 Simulation: Turning device back ON...');
      const onSuccess = await this.setForegroundState(true, true, 60);
      if (!onSuccess) {
        this.log('WARN', '📱 Simulation step 2 (device on) might have failed.');
      } else {
        this.log('INFO', '📱 Device simulation cycle completed.');
      }
    }, 5000); // 5 seconds for demo, increase for real usage
  }

  /**
   * Fetches pending message requests.
   * @returns {Promise<Array<object>>} An array of message request threads.
   */
  async getMessageRequests() {
    try {
      const pendingResponse = await this.ig.feed.directPending().request();
      const threads = pendingResponse.inbox?.threads || [];
      this.log('INFO', `📬 Fetched ${threads.length} message requests.`);
      return threads;
    } catch (error) {
      this.log('ERROR', `Failed to fetch message requests: ${error.message}`);
      return [];
    }
  }

  /**
   * Approves a specific message request thread.
   * @param {string} threadId - The ID of the message request thread to approve.
   * @returns {Promise<boolean>} True if approved successfully, false otherwise.
   */
  async approveMessageRequest(threadId) {
    if (!threadId) {
      this.log('WARN', '⚠️ approveMessageRequest called without threadId.');
      return false;
    }
    try {
      await this.ig.directThread.approve(threadId);
      this.log('INFO', `✅ Successfully approved message request: ${threadId}`);
      return true;
    } catch (error) {
      this.log('ERROR', `Failed to approve message request ${threadId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Declines a specific message request thread.
   * @param {string} threadId - The ID of the message request thread to decline.
   * @returns {Promise<boolean>} True if declined successfully, false otherwise.
   */
  async declineMessageRequest(threadId) {
    if (!threadId) {
      this.log('WARN', '⚠️ declineMessageRequest called without threadId.');
      return false;
    }
    try {
      await this.ig.directThread.decline(threadId);
      this.log('INFO', `❌ Successfully declined message request: ${threadId}`);
      return true;
    } catch (error) {
      this.log('ERROR', `Failed to decline message request ${threadId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Starts a periodic monitor for new message requests.
   * @param {number} intervalMs - The interval in milliseconds to check for new requests (default: 5 minutes).
   * @returns {Promise<void>}
   */
  async startMessageRequestsMonitor(intervalMs = 300000) {
    if (this.messageRequestsMonitorInterval) {
      clearInterval(this.messageRequestsMonitorInterval);
      this.log('WARN', '🛑 Stopping existing message requests monitor before starting a new one.');
    }

    this.messageRequestsMonitorInterval = setInterval(async () => {
      if (this.isRunning) {
        try {
          await this.getMessageRequests(); // This method already handles logging
        } catch (error) {
          this.log('ERROR', `Error in periodic message requests check: ${error.message}`);
        }
      }
    }, intervalMs);

    this.log('INFO', `🕒 Started message requests monitor (checking every ${intervalMs / 1000 / 60} minutes).`);
  }

  /**
   * Gracefully disconnects the bot from Instagram, clearing intervals and setting foreground state.
   * @returns {Promise<void>}
   */
  async disconnect() {
    this.log('INFO', '🔌 Initiating graceful disconnect from Instagram...');
    this.isRunning = false;

    if (this.messageRequestsMonitorInterval) {
      clearInterval(this.messageRequestsMonitorInterval);
      this.messageRequestsMonitorInterval = null;
      this.log('INFO', '🕒 Message requests monitor stopped.');
    }

    try {
      this.log('DEBUG', '📱 Setting foreground state to background before disconnect...');
      await this.setForegroundState(false, false, 900);
    } catch (stateError) {
      this.log('WARN', `⚠️ Error setting background state before disconnect: ${stateError.message}`);
    }

    try {
      if (this.ig.realtime && typeof this.ig.realtime.disconnect === 'function') {
        await this.ig.realtime.disconnect();
        this.log('INFO', '✅ Disconnected from Instagram realtime successfully.');
      } else {
        this.log('WARN', '⚠️ Realtime client was not initialized or disconnect method not found.');
      }
    } catch (disconnectError) {
      this.log('WARN', `⚠️ Error during disconnect: ${disconnectError.message}`);
    }
  }
}

---

## Main Bot Execution

This section contains the main logic for initializing and running the Instagram bot, including module loading, message handling, and graceful shutdown procedures.

```javascript
/**
 * Main function to initialize and run the Instagram bot.
 * @returns {Promise<void>}
 */
async function main() {
  let bot;
  try {
    bot = new InstagramBot();
    await bot.login();

    const moduleManager = new ModuleManager(bot);
    await moduleManager.loadModules();
    console.log(`✨ Loaded ${moduleManager.modules.length} modules.`);

    const messageHandler = new MessageHandler(bot, moduleManager);

    bot.onMessage((message) => messageHandler.handleMessage(message));

    await bot.startMessageRequestsMonitor();

    console.log('🚀 Bot is running with full module support. Type .help or use your commands.');

    // Periodic heartbeat for status logging
    setInterval(() => {
      console.log(`💓 [${new Date().toISOString()}] Bot heartbeat - Running: ${bot.isRunning}`);
    }, 300000); // Every 5 minutes

    // Graceful shutdown handling for SIGINT (Ctrl+C) and SIGTERM
    const shutdownHandler = async () => {
      console.log('\n👋 [SIGINT/SIGTERM] Shutting down gracefully...');
      if (bot) {
        await bot.disconnect();
      }
      console.log('🛑 Shutdown complete.');
      process.exit(0);
    };

    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler);
  } catch (error) {
    console.error(`❌ Bot failed to start: ${error.message}`);
    console.error('DEBUG: Initialization error stack:', error.stack);
    if (bot) {
      try {
        await bot.disconnect();
      } catch (disconnectError) {
        console.error(`❌ Error during cleanup disconnect: ${disconnectError.message}`);
      }
    }
    process.exit(1);
  }
}

// Ensure main() is called only when the script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`❌ Unhandled error in main execution: ${error.message}`);
    process.exit(1);
  });
}

export { InstagramBot };
