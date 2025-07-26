import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config.js';
import { getCollection, COLLECTIONS } from './db.js';
// Make sure 'node-fetch' is installed: npm install node-fetch
// Or use the global 'fetch' if your Node.js version supports it (Node 18+)
import fetch from 'node-fetch'; // Or import { default as fetch } from 'node-fetch';

// Fallback logger if utils logger isn't available
const logger = {
  info: (...args) => console.log('[INFO] [TelegramBridge]', ...args),
  warn: (...args) => console.warn('[WARN] [TelegramBridge]', ...args),
  error: (...args) => console.error('[ERROR] [TelegramBridge]', ...args),
  debug: (...args) => console.log('[DEBUG] [TelegramBridge]', ...args),
};

class TelegramBridge {
  constructor(instagramBot) {
    this.instagramBot = instagramBot;
    this.telegramBot = null;
    this.enabled = false;
    this.bridgeGroupId = config.telegram.bridgeGroupId; // The main Telegram group ID (must be a forum)
    this.adminUserId = config.telegram.adminUserId; // Numerical ID for admin notifications
    // Mappings stored in memory for quick lookup
    this.chatMappings = new Map(); // instagramChatId (string) -> telegramTopicId (number)
    this.topicMappings = new Map(); // telegramTopicId (number) -> instagramChatId (string)
    // Cache for topics being created to prevent duplicates
    this.creatingTopics = new Map(); // instagramChatId -> Promise

    if (config.telegram.token && config.telegram.enabled !== false && this.bridgeGroupId) {
      try {
        // Use long polling for simplicity, consider webhooks for production
        this.telegramBot = new TelegramBot(config.telegram.token, { polling: true });
        this.enabled = true;
        logger.info('✅ Telegram bot initialized');
        this._registerTelegramHandlers();
        this._loadMappingsFromDB(); // Load existing mappings on startup
      } catch (error) {
        logger.error('❌ Failed to initialize Telegram bot:', error.message);
        this.enabled = false;
      }
    } else {
      const missing = [];
      if (!config.telegram.token) missing.push('token');
      if (config.telegram.enabled === false) missing.push('enabled=true');
      if (!this.bridgeGroupId) missing.push('bridgeGroupId');
      // --- FIX: Use internal logger and check method existence ---
      if (typeof logger.warn === 'function') {
         logger.warn(`⚠️ Telegram bot not initialized. Missing config: ${missing.join(', ')}. Bridge will be disabled.`);
      } else {
         logger.info(`⚠️ [WARN FALLBACK] Telegram bot not initialized. Missing config: ${missing.join(', ')}. Bridge will be disabled.`);
      }
      // --- END FIX ---
    }
  }

  /**
   * Loads existing chat mappings from the database into memory on startup.
   * @private
   */
  async _loadMappingsFromDB() {
    try {
      const collectionName = COLLECTIONS.THREAD_MAPPINGS; // Use the constant
      logger.debug(`[DB] Attempting to load mappings from collection: '${collectionName}'`);
      if (typeof collectionName !== 'string' || !collectionName.trim()) {
          throw new Error(`Invalid collection name constant: COLLECTIONS.THREAD_MAPPINGS = ${collectionName}`);
      }
      const collection = await getCollection(collectionName);
      const mappings = await collection.find({}).toArray(); // Ensure find({}) is correct
      logger.debug(`[DB] Found ${mappings.length} mappings to load.`);
      let loadedCount = 0;
      for (const mapping of mappings) {
        // Ensure types are correct when loading
        const igChatId = mapping.instagramChatId?.toString(); // Ensure string
        const tgTopicId = Number(mapping.telegramTopicId);   // Ensure number
        if (igChatId && !isNaN(tgTopicId)) {
            this.chatMappings.set(igChatId, tgTopicId);
            this.topicMappings.set(tgTopicId, igChatId);
            loadedCount++;
            logger.debug(`[DB] Loaded mapping: ${igChatId} <-> ${tgTopicId}`);
        } else {
            // --- FIX: Check method existence ---
            if (typeof logger.warn === 'function') {
                logger.warn(`[DB] Skipping invalid mapping from DB:`, mapping);
            } else {
                logger.error(`[DB] Skipping invalid mapping from DB (logger.warn unavailable):`, mapping);
            }
            // --- END FIX ---
        }
      }
      logger.info(`📚 Loaded ${loadedCount} chat mappings from database.`);
    } catch (error) {
      logger.error('❌ Error loading chat mappings from DB:', error.message);
      // --- FIX: Check method existence ---
      if (typeof logger.debug === 'function') {
         logger.debug('DB Load Error Details:', error); // Log full error for debugging the "string" error
      } else {
         logger.info('DB Load Error Details (logger.debug unavailable):', error.message); // Fallback
      }
      // --- END FIX ---
    }
  }

  /**
   * Registers event handlers for Telegram messages and commands.
   * @private
   */
  _registerTelegramHandlers() {
    if (!this.telegramBot) return;
    this.telegramBot.on('message', async (msg) => {
      await this._handleTelegramMessage(msg);
    });
    this.telegramBot.on('error', (error) => {
      logger.error('🚨 Telegram bot error:', error.message);
    });
  }

  /**
   * Handles incoming messages from Telegram.
   * @param {TelegramBot.Message} msg - The Telegram message object.
   * @private
   */
  async _handleTelegramMessage(msg) {
    try {
      // Ignore messages not in the designated bridge group
      if (msg.chat.id.toString() !== this.bridgeGroupId?.toString()) {
        return; // Ignore messages outside the bridge group
      }
      // Ignore messages not in a topic (main chat messages)
      if (!msg.message_thread_id) {
        logger.debug(`📥 Ignoring message in main chat ${msg.chat.id}`);
        return;
      }
      const telegramTopicId = msg.message_thread_id;
      const instagramChatId = this.topicMappings.get(telegramTopicId);
      if (!instagramChatId) {
        // --- FIX: Check method existence ---
        if (typeof logger.warn === 'function') {
            logger.warn(`❓ No Instagram chat mapped to Telegram topic ${telegramTopicId}. Message ignored or topic needs recreation.`);
        } else {
            logger.info(`❓ [WARN FALLBACK] No Instagram chat mapped to Telegram topic ${telegramTopicId}. Message ignored or topic needs recreation.`);
        }
        // --- END FIX ---
        // Could potentially trigger topic recreation logic here if needed automatically,
        // but usually it's triggered by an incoming IG message to a deleted topic.
        return;
      }
      // --- FIX: Check method existence ---
      if (typeof logger.debug === 'function') {
         logger.debug(`📥 Telegram message received in topic ${telegramTopicId} (IG chat ${instagramChatId}): ${msg.text || '[Media]'}`);
      } else {
         logger.info(`📥 Telegram message received in topic ${telegramTopicId} (IG chat ${instagramChatId}): ${msg.text || '[Media]'}`);
      }
      // --- END FIX ---
      let forwardSuccess = false; // Flag to track success for reaction

      // Determine message type and forward to Instagram
      if (msg.text) {
        const tgUsername = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name || 'Telegram User';
        const prefixedText = `[TG: ${tgUsername}] ${msg.text}`;
        await this.instagramBot.sendMessage(instagramChatId, prefixedText);
        logger.info(`📤 Forwarded text from TG topic ${telegramTopicId} to IG chat ${instagramChatId}`);
        forwardSuccess = true;
      } else if (msg.photo) {
        forwardSuccess = await this._handleTelegramMedia(msg, 'photo', instagramChatId);
      } else if (msg.voice) {
        forwardSuccess = await this._handleTelegramMedia(msg, 'voice', instagramChatId);
      } else if (msg.document) {
        forwardSuccess = await this._handleTelegramMedia(msg, 'document', instagramChatId);
        // Add handling for video, etc. as needed
      } else {
        // --- FIX: Check method existence ---
        if (typeof logger.debug === 'function') {
           logger.debug(`.Unsupported message type in TG topic ${telegramTopicId}. Message structure:`, JSON.stringify({ keys: Object.keys(msg), photo: !!msg.photo, document: !!msg.document, voice: !!msg.voice, text: !!msg.text }, null, 2));
        } else {
           logger.info(`.Unsupported message type in TG topic ${telegramTopicId}. Message structure (logger.debug unavailable).`);
        }
        // --- END FIX ---
        // For unsupported types, we might still want to acknowledge receipt
        forwardSuccess = false;
      }

      // --- React on successful forward (Telegram -> Instagram) ---
      if (forwardSuccess !== null) { // Only react if we attempted to forward
          const reactionEmoji = forwardSuccess ? '👍' : '❌'; // Use checkmark or cross
          await this.setReaction(msg.chat.id, msg.message_id, reactionEmoji);
      }
      // --- End Reaction ---
    } catch (error) {
      logger.error('❌ Error handling Telegram message:', error.message);
      // --- FIX: Check method existence ---
       if (typeof logger.debug === 'function') {
          logger.debug('Telegram message error stack:', error.stack);
       } else {
          logger.info('Telegram message error stack (logger.debug unavailable):', error.stack || error.message);
       }
      // --- END FIX ---
      // Optionally, react with an error emoji if the main processing failed
      // await this.setReaction(msg.chat.id, msg.message_id, '❓'); // Question mark for unknown errors
    }
  }

  /**
   * Handles forwarding different types of Telegram media to Instagram.
   * @param {TelegramBot.Message} msg - The Telegram message object.
   * @param {string} mediaType - Type of media (photo, voice, document).
   * @param {string} instagramChatId - The target Instagram chat ID.
   * @returns {Promise<boolean>} True if successful, false otherwise.
   * @private
   */
  async _handleTelegramMedia(msg, mediaType, instagramChatId) {
    try {
        let fileId;
        if (mediaType === 'photo') {
            // Get the highest resolution photo
            fileId = msg.photo[msg.photo.length - 1].file_id;
        } else if (mediaType === 'voice') {
            fileId = msg.voice.file_id;
        } else if (mediaType === 'document') {
            fileId = msg.document.file_id;
        } else {
            // --- FIX: Check method existence ---
            if (typeof logger.warn === 'function') {
                logger.warn(`.Unsupported media type for forwarding: ${mediaType}`);
            } else {
                 logger.info(`.Unsupported media type for forwarding (logger.warn fallback): ${mediaType}`);
            }
            // --- END FIX ---
            return false;
        }
        // Get file link
        const fileLink = await this.telegramBot.getFileLink(fileId);
        // --- FIX: Check method existence ---
        if (typeof logger.debug === 'function') {
            logger.debug(`🔗 Got file link for ${mediaType}: ${fileLink}`);
        } else {
            logger.info(`🔗 Got file link for ${mediaType}: ${fileLink}`);
        }
        // --- END FIX ---
        // --- Download and Send to Instagram ---
        const response = await fetch(fileLink);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (mediaType === 'photo') {
            await this.instagramBot.ig.entity.directThread(instagramChatId).broadcastPhoto({ file: buffer });
        } else if (mediaType === 'voice') {
             // Voice notes usually need to be in MP4 format for Instagram
             await this.instagramBot.ig.entity.directThread(instagramChatId).broadcastVoice({ file: buffer });
        } else if (mediaType === 'document') {
             // Sending documents as photos is a fallback. Implement specific logic if needed.
             await this.instagramBot.ig.entity.directThread(instagramChatId).broadcastPhoto({ file: buffer });
        }
        // --- End Send to Instagram ---
        logger.info(`📤 Forwarded ${mediaType} from TG topic ${msg.message_thread_id} to IG chat ${instagramChatId}`);
        return true;
    } catch (error) {
      logger.error(`❌ Error forwarding ${mediaType} from TG to IG:`, error.message);
      // --- FIX: Check method existence ---
       if (typeof logger.debug === 'function') {
           logger.debug(`Error details for ${mediaType}:`, error.stack);
       } else {
           logger.info(`Error details for ${mediaType} (logger.debug unavailable):`, error.stack || error.message);
       }
      // --- END FIX ---
      return false;
    }
  }

  /**
   * Forwards an Instagram message to the corresponding Telegram forum topic.
   * @param {Object} instagramMessage - The processed Instagram message object.
   */
  async forwardInstagramMessage(instagramMessage) {
    if (!this.enabled || !this.bridgeGroupId) {
      logger.debug('⏭️ Telegram bridge is disabled or group ID not set, skipping forward.');
      return;
    }
    try {
      // 1. Filter out messages sent *by the bot itself* (prevent echo)
      if (instagramMessage.senderId?.toString() === this.instagramBot.ig.state.cookieUserId?.toString()) {
        logger.debug(`⏭️ Skipping message from bot itself (ID: ${instagramMessage.senderId})`);
        return;
      }
      const instagramChatId = instagramMessage.threadId;
      // --- FIX: Check method existence ---
      if (typeof logger.debug === 'function') {
          logger.debug(`🔁 Attempting to forward IG message from chat ${instagramChatId}`);
      } else {
          logger.info(`🔁 Attempting to forward IG message from chat ${instagramChatId}`);
      }
      // --- END FIX ---
      // 2. Find or Create the mapped Telegram topic
      let telegramTopicId = this.chatMappings.get(instagramChatId);
      // --- Auto-Recreate Topic Logic ---
      let topicRecreated = false;
      if (telegramTopicId) {
          // Basic check for topic existence could be added here if needed.
      } else {
          logger.info(`❓ No Telegram topic mapped for Instagram chat ${instagramChatId}. Creating topic.`);
      }
      // If no topic ID or topic needs recreation, create it
      if (!telegramTopicId || topicRecreated) {
        telegramTopicId = await this._getOrCreateTopic(instagramMessage); // Pass the message for user info
        if (!telegramTopicId) {
            logger.error(`❌ Failed to get or create Telegram topic for IG chat ${instagramChatId}. Message not forwarded.`);
            return;
        }
        if (topicRecreated) {
            logger.info(`🔄 Recreated and linked TG topic ${telegramTopicId} to IG chat ${instagramChatId}`);
        } else {
            logger.info(`✅ Created and linked TG topic ${telegramTopicId} to IG chat ${instagramChatId}`);
        }
      }
      // --- End Auto-Recreate Topic Logic ---
      // 3. Forward the message to the Telegram topic
      if (instagramMessage.type === 'text' && instagramMessage.text) {
        await this.telegramBot.sendMessage(this.bridgeGroupId, instagramMessage.text, {
          message_thread_id: telegramTopicId
        });
        logger.info(`📤 Forwarded text from IG chat ${instagramChatId} to TG topic ${telegramTopicId}`);
      } else if (instagramMessage.type === 'media' && instagramMessage.mediaData?.url) {
        // --- Download Instagram Media and Send to Telegram ---
        try {
            // --- FIX: Check method existence ---
            if (typeof logger.debug === 'function') {
                logger.debug(`📥 Downloading media from Instagram: ${instagramMessage.mediaData.url}`);
            } else {
                 logger.info(`📥 Downloading media from Instagram: ${instagramMessage.mediaData.url}`);
            }
            // --- END FIX ---
            const response = await fetch(instagramMessage.mediaData.url);
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            // Determine Telegram method based on Instagram media type if available
            const mediaType = instagramMessage.mediaData?.type || 'photo';
            let tgMethod;
            let tgOptions = { message_thread_id: telegramTopicId };
            // Omit caption as per request
            if (mediaType === 'video') {
              tgMethod = 'sendVideo';
            } else if (mediaType === 'animated') {
              tgMethod = 'sendAnimation';
            } else {
              // Default to photo for images
              tgMethod = 'sendPhoto';
            }
            await this.telegramBot[tgMethod](this.bridgeGroupId, buffer, tgOptions);
            logger.info(`📤 Forwarded downloaded ${mediaType} from IG chat ${instagramChatId} to TG topic ${telegramTopicId}`);
        } catch (downloadError) {
            logger.error(`❌ Error downloading/sending Instagram media to TG topic ${telegramTopicId}:`, downloadError.message);
            // Fallback: Send the URL as a link
            await this.telegramBot.sendMessage(
              this.bridgeGroupId,
              `🔗 [Media](${instagramMessage.mediaData?.url || 'N/A'}) received from @${instagramMessage.senderUsername}. (Download failed: ${downloadError.message})`,
              { message_thread_id: telegramTopicId, parse_mode: 'Markdown', disable_web_page_preview: true }
            );
        }
        // --- End Download and Send ---
      } else if (instagramMessage.type === 'voice_media' && instagramMessage.voiceData?.url) {
        // Sending voice notes to Telegram requires downloading
        // --- FIX: Check method existence ---
        if (typeof logger.warn === 'function') {
             logger.warn(`🔄 Voice message forwarding logic (IG->TG) needs full implementation. Sending placeholder.`);
        } else {
             logger.info(`🔄 Voice message forwarding logic (IG->TG) needs full implementation. Sending placeholder. (logger.warn fallback)`);
        }
        // --- END FIX ---
        await this.telegramBot.sendMessage(this.bridgeGroupId, `[Voice Message received from @${instagramMessage.senderUsername}]`, {
          message_thread_id: telegramTopicId
        });
        // Implement actual voice note sending if needed (download URL, send as voice note)
      } else if (instagramMessage.type === 'like') {
        await this.telegramBot.sendMessage(this.bridgeGroupId, `❤️ Like received from @${instagramMessage.senderUsername}`, {
          message_thread_id: telegramTopicId
        });
        logger.info(`📤 Forwarded like from IG chat ${instagramChatId} to TG topic ${telegramTopicId}`);
      } else {
        // --- FIX: Check method existence ---
        if (typeof logger.debug === 'function') {
            logger.debug(`🔄 Forwarding generic message type '${instagramMessage.type}' from IG->TG`);
        } else {
             logger.info(`🔄 Forwarding generic message type '${instagramMessage.type}' from IG->TG`);
        }
        // --- END FIX ---
        await this.telegramBot.sendMessage(this.bridgeGroupId, `[${instagramMessage.type}] Message received from @${instagramMessage.senderUsername}`, {
          message_thread_id: telegramTopicId
        });
      }
    } catch (error) {
      // --- Specific Error Handling for Topic Deletion ---
      if (error.response?.body?.description?.includes("Bad Request: message thread not found")) {
          // --- FIX: Check method existence ---
          if (typeof logger.warn === 'function') {
               logger.warn(`🗑️ Topic for IG chat ${instagramMessage.threadId} seems deleted. Recreating...`);
          } else {
               logger.info(`🗑️ Topic for IG chat ${instagramMessage.threadId} seems deleted. Recreating... (logger.warn fallback)`);
          }
          // --- END FIX ---
          // Mark the old mapping for deletion
          const oldTopicId = this.chatMappings.get(instagramMessage.threadId);
          if (oldTopicId) {
              this.topicMappings.delete(oldTopicId);
          }
          this.chatMappings.delete(instagramMessage.threadId);
          // Attempt to recreate the topic
          const newTelegramTopicId = await this._getOrCreateTopic(instagramMessage);
          if (newTelegramTopicId) {
              logger.info(`✅ Recreated topic ${newTelegramTopicId} for IG chat ${instagramMessage.threadId}. Retrying message send...`);
              // Retry sending the message to the new topic
              try {
                  const tgOptions = { message_thread_id: newTelegramTopicId };
                  if (instagramMessage.type === 'text' && instagramMessage.text) {
                      await this.telegramBot.sendMessage(this.bridgeGroupId, instagramMessage.text, tgOptions);
                  } else if (instagramMessage.type === 'media' && instagramMessage.mediaData?.url) {
                      // Retry media send (download and send again)
                      try {
                          // --- FIX: Check method existence ---
                          if (typeof logger.debug === 'function') {
                              logger.debug(`📥 Retrying download for media: ${instagramMessage.mediaData.url}`);
                          } else {
                               logger.info(`📥 Retrying download for media: ${instagramMessage.mediaData.url}`);
                          }
                          // --- END FIX ---
                          const response = await fetch(instagramMessage.mediaData.url);
                          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                          const buffer = Buffer.from(await response.arrayBuffer());
                          const mediaType = instagramMessage.mediaData?.type || 'photo';
                          let tgMethod;
                          if (mediaType === 'video') {
                            tgMethod = 'sendVideo';
                          } else if (mediaType === 'animated') {
                            tgMethod = 'sendAnimation';
                          } else {
                            tgMethod = 'sendPhoto';
                          }
                          await this.telegramBot[tgMethod](this.bridgeGroupId, buffer, tgOptions);
                          logger.info(`📤 Retried and forwarded ${mediaType} to recreated TG topic ${newTelegramTopicId}`);
                      } catch (retryMediaError) {
                          logger.error(`❌ Failed to retry media send to recreated topic ${newTelegramTopicId}:`, retryMediaError.message);
                          await this.telegramBot.sendMessage(this.bridgeGroupId, `[${instagramMessage.type}] Message (Retry Failed)`, tgOptions);
                      }
                  } else {
                      await this.telegramBot.sendMessage(this.bridgeGroupId, `[${instagramMessage.type}] Message (Retry)`, tgOptions);
                  }
                  logger.info(`📤 Forwarded message to newly recreated TG topic ${newTelegramTopicId} for IG chat ${instagramMessage.threadId}`);
              } catch (retryError) {
                  logger.error(`❌ Failed to send message to recreated topic ${newTelegramTopicId}:`, retryError.message);
              }
          } else {
              logger.error(`❌ Failed to recreate topic for IG chat ${instagramMessage.threadId} after deletion.`);
          }
      } else {
          // --- General Error Handling ---
          logger.error('❌ Error forwarding Instagram message to Telegram:', error.message);
          // --- FIX: Check method existence ---
          if (typeof logger.debug === 'function') {
              logger.debug('Forwarding error details:', error.stack);
          } else {
               logger.info('Forwarding error details (logger.debug unavailable):', error.stack || error.message);
          }
          // --- END FIX ---
      }
      // --- End Specific Error Handling ---
    }
  }

  /**
   * Gets an existing topic ID or creates a new one for an Instagram chat.
   * Handles concurrent requests for the same chat.
   * @param {Object} instagramMessage - The initial Instagram message (used to identify the user/chat).
   * @returns {Promise<number|null>} The Telegram topic ID if successful, null otherwise.
   * @private
   */
  async _getOrCreateTopic(instagramMessage) {
    const instagramChatId = instagramMessage.threadId;
    // If already being created, wait for the existing promise
    if (this.creatingTopics.has(instagramChatId)) {
        // --- FIX: Check method existence ---
        if (typeof logger.debug === 'function') {
             logger.debug(`⏳ Topic creation for ${instagramChatId} already in progress, waiting...`);
        } else {
             logger.info(`⏳ Topic creation for ${instagramChatId} already in progress, waiting...`);
        }
        // --- END FIX ---
        return await this.creatingTopics.get(instagramChatId);
    }
    // Create a new promise for topic creation
    const creationPromise = (async () => {
        try {
            return await this._createTopicForChat(instagramMessage);
        } catch (error) {
          logger.error(`❌ Error during topic creation promise for ${instagramChatId}:`, error.message);
          return null;
        } finally {
            // Cleanup the promise from the cache once done (success or failure)
            this.creatingTopics.delete(instagramChatId);
            // --- FIX: Check method existence ---
            if (typeof logger.debug === 'function') {
                 logger.debug(`🧹 Cleaned up topic creation promise cache for ${instagramChatId}`);
            } else {
                 logger.info(`🧹 Cleaned up topic creation promise cache for ${instagramChatId}`);
            }
            // --- END FIX ---
        }
    })();
    // Store the promise in the cache
    this.creatingTopics.set(instagramChatId, creationPromise);
    // --- FIX: Check method existence ---
    if (typeof logger.debug === 'function') {
         logger.debug(`🚀 Started topic creation process for ${instagramChatId}`);
    } else {
         logger.info(`🚀 Started topic creation process for ${instagramChatId}`);
    }
    // --- END FIX ---
    // Wait for the creation to complete and return the result
    return await creationPromise;
  }

  /**
   * Creates a new forum topic for an Instagram chat and sends the welcome message.
   * @param {Object} instagramMessage - The initial Instagram message (used to identify the user/chat).
   * @returns {Promise<number|null>} The Telegram topic ID if successful, null otherwise.
   * @private
   */
  async _createTopicForChat(instagramMessage) {
    try {
      const instagramChatId = instagramMessage.threadId;
      const instagramUserId = instagramMessage.senderId;
      // --- 1. Determine Topic Name ---
      let topicName;
      let threadInfo = null;
      try {
          const threadFeed = this.instagramBot.ig.feed.directThread({ thread_id: instagramChatId });
          const threadResponse = await threadFeed.request();
          threadInfo = threadResponse.thread;
      } catch (fetchError) {
          // --- FIX: Check method existence ---
          if (typeof logger.warn === 'function') {
               logger.warn(`⚠️ Could not fetch thread info for ${instagramChatId} to generate topic name:`, fetchError.message);
          } else {
               logger.info(`⚠️ Could not fetch thread info for ${instagramChatId} to generate topic name (logger.warn fallback):`, fetchError.message);
          }
          // --- END FIX ---
      }
      if (threadInfo) {
          if (threadInfo.thread_type && threadInfo.thread_type !== 'private') {
              topicName = threadInfo.thread_title || `IG Group ${instagramChatId.substring(0, 6)}...`;
          } else {
              const recipient = threadInfo.users?.find(u => u.pk?.toString() !== this.instagramBot.ig.state.cookieUserId?.toString());
              let recipientUser = null;
              if (recipient) {
                  try {
                      recipientUser = await this.instagramBot.ig.user.info(recipient.pk);
                  } catch (userFetchError) {
                      // --- FIX: Check method existence ---
                      if (typeof logger.warn === 'function') {
                           logger.warn(`⚠️ Could not fetch recipient user info for ${recipient.pk}:`, userFetchError.message);
                      } else {
                           logger.info(`⚠️ Could not fetch recipient user info for ${recipient.pk} (logger.warn fallback):`, userFetchError.message);
                      }
                      // --- END FIX ---
                  }
              }
              topicName = recipientUser ? `@${recipientUser.username}` : `IG DM ${instagramUserId}`;
          }
      } else {
          topicName = `IG Chat ${instagramChatId.substring(0, 10)}...`;
      }
      if (topicName.length > 128) {
          topicName = topicName.substring(0, 125) + '...';
      }
      // --- FIX: Check method existence ---
      if (typeof logger.debug === 'function') {
           logger.debug(`🏗️ Creating forum topic named '${topicName}' for IG chat ${instagramChatId}`);
      } else {
           logger.info(`🏗️ Creating forum topic named '${topicName}' for IG chat ${instagramChatId}`);
      }
      // --- END FIX ---
      // --- 2. Create Forum Topic ---
      const topic = await this.telegramBot.createForumTopic(
        this.bridgeGroupId,
        topicName,
        { icon_color: 0x6FB9F0 }
      );
      const telegramTopicId = topic.message_thread_id;
      logger.info(`✅ Created Telegram forum topic '${topicName}' (ID: ${telegramTopicId}) for IG chat ${instagramChatId}`);
      // --- 3. Store Mappings ---
      this.chatMappings.set(instagramChatId, telegramTopicId);
      this.topicMappings.set(telegramTopicId, instagramChatId);
      // Save mapping to database
      try {
          const collection = await getCollection(COLLECTIONS.THREAD_MAPPINGS);
          await collection.insertOne({
              instagramChatId,
              telegramTopicId,
              createdAt: new Date(),
              topicName
          });
          logger.debug(`💾 Saved mapping IG:${instagramChatId} <-> TG:${telegramTopicId} to database.`);
      } catch (dbError) {
          logger.error(`❌ Failed to save mapping to database for IG:${instagramChatId} <-> TG:${telegramTopicId}:`, dbError.message);
          // --- FIX: Check method existence ---
          if (typeof logger.debug === 'function') {
              logger.debug('DB Save Error Details:', dbError);
          } else {
              logger.info('DB Save Error Details (logger.debug unavailable):', dbError.message);
          }
          // --- END FIX ---
      }
      // --- 4. Send Welcome Message (with merged profile picture) ---
      let userInfo = null;
      try {
          userInfo = await this.instagramBot.ig.user.info(instagramUserId);
      } catch (userError) {
          // --- FIX: Check method existence ---
          if (typeof logger.warn === 'function') {
               logger.warn(`⚠️ Could not fetch user info for ${instagramUserId}:`, userError.message);
          } else {
               logger.info(`⚠️ Could not fetch user info for ${instagramUserId} (logger.warn fallback):`, userError.message);
          }
          // --- END FIX ---
      }
      let welcomeText;
      if (userInfo) {
          welcomeText = `👤 *Instagram User Profile*
` +
                        `Username: [@${userInfo.username}](https://www.instagram.com/${userInfo.username}/)
` +
                        `Full Name: ${userInfo.full_name || 'N/A'}
` +
                        `Bio: ${userInfo.biography?.substring(0, 200) || 'N/A'}
` +
                        `Followers: ${userInfo.follower_count?.toLocaleString() || 'N/A'}
` +
                        `Following: ${userInfo.following_count?.toLocaleString() || 'N/A'}
` +
                        `
*Chat ID:* \`${instagramChatId}\``;
      } else {
          welcomeText = `👤 *Instagram Chat*
` +
                        `User ID: \`${instagramUserId}\`
` +
                        `Chat ID: \`${instagramChatId}\`
` +
                        `_Note: Full profile could not be fetched._`;
      }
      // --- 4a. Send Profile Picture First ---
      let profilePicMessageId = null;
      if (userInfo?.hd_profile_pic_url_info?.url || userInfo?.profile_pic_url) {
          const profilePicUrl = userInfo.hd_profile_pic_url_info?.url || userInfo.profile_pic_url;
          try {
              const photoMsg = await this.telegramBot.sendPhoto(this.bridgeGroupId, profilePicUrl, {
                  message_thread_id: telegramTopicId
              });
              profilePicMessageId = photoMsg.message_id;
              logger.info(`🖼️ Sent profile picture for @${userInfo.username} to topic ${telegramTopicId}`);
          } catch (photoError) {
              // --- FIX: Check method existence ---
              if (typeof logger.warn === 'function') {
                   logger.warn(`⚠️ Could not send profile picture for @${userInfo.username} to topic ${telegramTopicId}:`, photoError.message);
              } else {
                   logger.info(`⚠️ Could not send profile picture for @${userInfo.username} to topic ${telegramTopicId} (logger.warn fallback):`, photoError.message);
              }
              // --- END FIX ---
          }
      }
      // --- 4b. Send Welcome Message (replying to the profile pic if sent) ---
      let welcomeSendOptions = {
          message_thread_id: telegramTopicId,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
      };
      if (profilePicMessageId) {
          welcomeSendOptions.reply_parameters = { message_id: profilePicMessageId };
      }
      const sentWelcomeMessage = await this.telegramBot.sendMessage(
          this.bridgeGroupId,
          welcomeText,
          welcomeSendOptions
      );
      logger.debug(`📨 Sent welcome message to topic ${telegramTopicId}`);
      // --- 4c. Pin Welcome Message ---
      try {
          await this.telegramBot.pinChatMessage(this.bridgeGroupId, sentWelcomeMessage.message_id, {
              message_thread_id: telegramTopicId,
              disable_notification: true
          });
          logger.info(`📌 Pinned welcome message in topic ${telegramTopicId}`);
      } catch (pinError) {
          // --- FIX: Check method existence ---
          if (typeof logger.warn === 'function') {
               logger.warn(`⚠️ Could not pin welcome message in topic ${telegramTopicId}:`, pinError.message);
          } else {
               logger.info(`⚠️ Could not pin welcome message in topic ${telegramTopicId} (logger.warn fallback):`, pinError.message);
          }
          // --- END FIX ---
      }
      // --- End Welcome Message ---
      return telegramTopicId;
    } catch (error) {
      logger.error('❌ Failed to create forum topic:', error.message);
      if (error.response?.body) {
          // --- FIX: Check method existence ---
          if (typeof logger.debug === 'function') {
              logger.debug('Telegram API Error Details:', JSON.stringify(error.response.body, null, 2));
          } else {
              logger.info('Telegram API Error Details (logger.debug unavailable):', JSON.stringify(error.response.body, null, 2));
          }
          // --- END FIX ---
      }
      return null;
    }
  }

  /**
   * Sets a reaction (emoji) on a Telegram message.
   * Inspired by WhatsApp bridge, using raw API call.
   * @param {number} chatId - The Telegram chat ID.
   * @param {number} messageId - The Telegram message ID.
   * @param {string} emoji - The emoji reaction to set.
   */
  async setReaction(chatId, messageId, emoji) {
    if (!this.telegramBot) return;
    try {
      const apiUrl = `https://api.telegram.org/bot${config.telegram.token}/setMessageReaction`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reaction: [{ type: 'emoji', emoji: emoji }]
        })
      });
      const data = await response.json();
      if (data.ok) {
        logger.debug(`👍 Set reaction '${emoji}' on Telegram message ${messageId} in chat ${chatId}`);
      } else {
        // --- FIX: Check method existence ---
        if (typeof logger.debug === 'function') {
             logger.debug(`⚠️ Telegram API returned not OK for reaction '${emoji}' on ${messageId}:`, data.description || data);
        } else {
             logger.info(`⚠️ Telegram API returned not OK for reaction '${emoji}' on ${messageId}:`, data.description || data);
        }
        // --- END FIX ---
      }
    } catch (error) {
      // --- FIX: Check method existence ---
      if (typeof logger.debug === 'function') {
           logger.debug(`⚠️ Could not set reaction '${emoji}' on message ${messageId} via raw API:`, error.message);
      } else {
           logger.info(`⚠️ Could not set reaction '${emoji}' on message ${messageId} via raw API (logger.debug fallback):`, error.message);
      }
      // --- END FIX ---
    }
  }
}

export default TelegramBridge;
