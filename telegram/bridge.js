// telegram/bridge.js
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs-extra'; // For temporary file handling and directory management
import path from 'path'; // For path manipulation
import axios from 'axios'; // For downloading media
import mime from 'mime-types'; // For determining file types from URLs
import { fileURLToPath } from 'url'; // Required for __dirname equivalent in ES Modules
import { dirname } from 'path';

// Local project imports
import { connectDb } from '../utils/db.js'; // Assuming you have a database utility
import { config } from '../config.js'; // Assuming your configuration file
import { logger } from '../utils/utils.js'; // Assuming you have a logger utility

// For ES Modules, to get __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class TelegramBridge {
    constructor() {
        this.instagramBot = null; // Will be set later when initialized
        this.telegramBot = null; // Telegram bot instance
        this.chatMappings = new Map(); // instagramThreadId -> telegramTopicId (or chat_id for non-forum)
        this.userMappings = new Map(); // instagramUserId -> { username, fullName, firstSeen, messageCount }
        this.profilePicCache = new Map(); // instagramId (thread/user) -> profilePicUrl
        
        // Define a dedicated temporary directory for this bridge
        this.tempDir = path.join(__dirname, '..', 'temp', 'telegram-bridge');
        
        this.db = null; // MongoDB database instance
        this.collection = null; // MongoDB collection for bridge data
        this.telegramChatId = null; // Main supergroup ID for forum topics (if applicable)
        this.creatingTopics = new Map(); // instagramThreadId => Promise (to prevent race conditions)
        this.topicVerificationCache = new Map(); // instagramThreadId => boolean (to cache topic existence)
        this.enabled = false; // Flag to indicate if the bridge is enabled
        this.filters = new Set(); // Placeholder for message filtering rules
    }

    async initialize(instagramBotInstance) {
        this.instagramBot = instagramBotInstance; // Link to the main Instagram bot instance

        const token = config.telegram?.botToken;
        this.telegramChatId = config.telegram?.chatId; // The main Telegram supergroup/forum ID from config

        if (!token) {
            logger.warn('Telegram bot token not found in config. Telegram bridge will be disabled.');
            this.enabled = false;
            return;
        }
        
        if (!this.telegramChatId) {
            logger.warn('Telegram main chat ID (supergroup) not found in config. Ensure this is set for forum functionality. Bridging DMs might still work if mapped.');
        }

        // Initialize Telegram Bot API with polling
        this.telegramBot = new TelegramBot(token, { polling: true });
        this.enabled = true; // Mark as enabled since token is present

        // Ensure the temporary directory exists
        await fs.ensureDir(this.tempDir);

        // Connect to MongoDB and set up collection for mappings and metadata
        try {
            this.db = await connectDb(); // Assuming connectDb returns the database instance
            this.collection = this.db.collection('telegram_bridge_data'); // Use a specific collection
            logger.info('🗄️ Connected to Telegram bridge database collection.');
        } catch (error) {
            logger.error('❌ Failed to connect to Telegram bridge database:', error.message);
            // Decide if you want to disable bridge or continue with limited functionality without DB
        }

        // Load existing chat mappings from DB
        await this.loadMappingsFromDb();

        // Setup Instagram event listeners (for outbound messages from Instagram to Telegram)
        this.setupInstagramHandlers();

        // Setup Telegram message listeners (for inbound messages from Telegram to Instagram)
        await this.setupTelegramHandlers(); // <--- Crucial call for listening to Telegram

        logger.info('✅ Telegram bridge initialized.');
    }

    // --- Database Operations ---
    async loadMappingsFromDb() {
        if (!this.collection) return;
        try {
            const mappings = await this.collection.find({ type: 'mapping' }).toArray();
            mappings.forEach(m => {
                if (m.instagramThreadId && m.telegramTopicId) {
                    this.chatMappings.set(m.instagramThreadId, m.telegramTopicId);
                    logger.debug(`Loaded mapping: Instagram ${m.instagramThreadId} -> Telegram ${m.telegramTopicId}`);
                }
            });
            logger.info(`Loaded ${this.chatMappings.size} chat mappings from database.`);
        } catch (error) {
            logger.error('Error loading mappings from DB:', error.message);
        }
    }

    async saveMappingToDb(instagramThreadId, telegramTopicId) {
        if (!this.collection) return;
        try {
            await this.collection.updateOne(
                { type: 'mapping', instagramThreadId: instagramThreadId },
                { $set: { telegramTopicId: telegramTopicId, lastUpdated: new Date() } },
                { upsert: true }
            );
            logger.debug(`Saved mapping: Instagram ${instagramThreadId} -> Telegram ${telegramTopicId}`);
        } catch (error) {
            logger.error('Error saving mapping to DB:', error.message);
        }
    }

    async getOrCreateTopic(instagramThreadId, senderUserId) {
        // Check if topic is already being created to prevent duplicate efforts
        if (this.creatingTopics.has(instagramThreadId)) {
            return this.creatingTopics.get(instagramThreadId);
        }

        // Check cache first
        if (this.topicVerificationCache.has(instagramThreadId)) {
            const cachedTopicId = this.chatMappings.get(instagramThreadId);
            if (cachedTopicId) return cachedTopicId;
        }

        // Try to get from existing mappings
        let telegramTopicId = this.chatMappings.get(instagramThreadId);
        if (telegramTopicId) {
            // Verify if the topic actually exists in Telegram (especially after bot restarts)
            try {
                // This is a dummy call to verify if the chat/topic exists and bot can access it
                await this.telegramBot.getChat(telegramTopicId);
                this.topicVerificationCache.set(instagramThreadId, true);
                return telegramTopicId;
            } catch (err) {
                logger.warn(`Telegram topic ${telegramTopicId} for Instagram thread ${instagramThreadId} no longer exists or is inaccessible. Recreating.`);
                this.chatMappings.delete(instagramThreadId);
                telegramTopicId = null; // Force recreation
            }
        }

        // If no existing mapping or it's invalid, create a new topic
        if (!telegramTopicId && this.telegramChatId) { // Only create if main chat ID is provided (for forum topics)
            logger.info(`Attempting to create new Telegram topic for Instagram thread: ${instagramThreadId}`);
            const createPromise = (async () => {
                try {
                    // Get Instagram thread info to name the topic
                    const threadInfo = await this.instagramBot.getThreadInfo(instagramThreadId);
                    const topicTitle = threadInfo.title || `Instagram Chat ${instagramThreadId.substring(0, 8)}`; // Use thread title or a generated one

                    const newTopic = await this.telegramBot.createForumTopic(this.telegramChatId, topicTitle, {
                        icon_color: Math.floor(Math.random() * (0xFFFFFF + 1)) // Random color
                    });
                    telegramTopicId = newTopic.message_thread_id;

                    this.chatMappings.set(instagramThreadId, telegramTopicId);
                    await this.saveMappingToDb(instagramThreadId, telegramTopicId);
                    this.topicVerificationCache.set(instagramThreadId, true);
                    logger.info(`✅ Created new Telegram topic ${telegramTopicId} for Instagram thread ${instagramThreadId}`);
                    return telegramTopicId;
                } catch (error) {
                    logger.error(`❌ Failed to create Telegram topic for Instagram thread ${instagramThreadId}:`, error.message);
                    this.topicVerificationCache.set(instagramThreadId, false); // Cache failure
                    throw error; // Re-throw to propagate failure
                } finally {
                    this.creatingTopics.delete(instagramThreadId); // Remove from 'creating' map
                }
            })();
            this.creatingTopics.set(instagramThreadId, createPromise);
            return createPromise;
        } else if (!telegramTopicId && !this.telegramChatId) {
            logger.warn(`No main Telegram chat ID configured to create forum topics. Bridging only to configured DMs.`);
            // If main chat ID is not set, we cannot create forum topics.
            // This scenario means mappings must be explicitly set in config for DMs.
            return null; // Cannot create topic, so return null
        }
        
        return null; // Should not reach here if logic is sound
    }

    // --- Instagram Event Handlers (for messages going from Instagram to Telegram) ---
    setupInstagramHandlers() {
        // The message processing from Instagram happens in MessageHandler and bot.js
        // MessageHandler calls this.telegramBridge.sendToTelegram(message);
        // So, this method primarily ensures that the bridge knows about the Instagram bot.
        logger.info('📱 Instagram event handlers assumed to be set up via MessageHandler.');
        // You can add more Instagram-specific listeners here if needed,
        // for example, to listen for thread updates, user profile changes etc.
        /*
        this.instagramBot.ig.realtime.on('direct_v2_message', async (data) => {
            // Process raw Instagram real-time messages if sendToTelegram doesn't cover all needs
            logger.debug('Raw Instagram Direct message received via Realtime:', data);
        });
        */
    }

    // --- Inbound from Telegram to Instagram ---
    async setupTelegramHandlers() {
        if (!this.telegramBot) {
            logger.error('Telegram bot not initialized. Cannot set up handlers.');
            return;
        }

        logger.info('👂 Setting up Telegram message handlers...');

        // Handle text messages from Telegram
        this.telegramBot.on('text', async (msg) => {
            const telegramChatId = msg.chat.id;
            const text = msg.text;

            // Determine effective chat ID for mapping (msg.chat.id for non-forums, msg.message_thread_id for forum topics)
            const effectiveTelegramChatId = msg.is_topic_message ? msg.message_thread_id : msg.chat.id;

            // Find mapping based on effective Telegram chat ID
            const mapping = config.mappings.find(m => m.telegram === effectiveTelegramChatId) || 
                            Array.from(this.chatMappings.entries()).find(([, value]) => value === effectiveTelegramChatId)?.[0]; // Check dynamic mappings too

            if (!mapping) {
                if (msg.chat.type === 'private' || msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
                    logger.warn(`Received text from unmapped Telegram chat ID: ${effectiveTelegramChatId}. User: ${msg.from.username || msg.from.first_name}`);
                    if (msg.chat.type === 'private') {
                         await this.telegramBot.sendMessage(telegramChatId, 'This bot is configured to bridge specific Instagram chats. Please ensure this chat is mapped in the configuration, or use /link command if available.');
                    }
                }
                return;
            }

            const instagramThreadId = mapping.instagram || mapping; // Use mapping.instagram if it's an object, else mapping itself
            const senderUsername = msg.from.username || msg.from.first_name || 'TelegramUser';

            logger.info(`➡️ Received text from Telegram (Chat ${effectiveTelegramChatId}, User ${senderUsername}): "${text}"`);

            try {
                // This assumes instagramBot has a sendMessage method.
                // You will need to ensure this is implemented in your `bot (2).js` (InstagramBot) file.
                await this.instagramBot.sendMessage(instagramThreadId, `[TG ${senderUsername}]: ${text}`);
                logger.info(`✅ Sent text to Instagram thread ${instagramThreadId}`);
            } catch (error) {
                logger.error(`❌ Error sending text from Telegram to Instagram thread ${instagramThreadId}:`, error.message);
                await this.telegramBot.sendMessage(telegramChatId, `❌ Failed to send message to Instagram: ${error.message}`);
            }
        });

        // Handle photos from Telegram
        this.telegramBot.on('photo', async (msg) => {
            const telegramChatId = msg.chat.id;
            const photo = msg.photo[msg.photo.length - 1]; // Get the highest resolution photo
            const caption = msg.caption || '';
            const senderUsername = msg.from.username || msg.from.first_name || 'TelegramUser';
            const effectiveTelegramChatId = msg.is_topic_message ? msg.message_thread_id : msg.chat.id;

            const mapping = config.mappings.find(m => m.telegram === effectiveTelegramChatId) || 
                            Array.from(this.chatMappings.entries()).find(([, value]) => value === effectiveTelegramChatId)?.[0];
            if (!mapping) {
                logger.warn(`Received photo from unmapped Telegram chat ID: ${effectiveTelegramChatId}. User: ${senderUsername}`);
                return;
            }
            const instagramThreadId = mapping.instagram || mapping;

            try {
                const fileLink = await this.telegramBot.getFileLink(photo.file_id);
                logger.info(`➡️ Received photo from Telegram (Chat ${effectiveTelegramChatId}, User ${senderUsername}). Download URL: ${fileLink}`);

                const tempFilePath = path.join(this.tempDir, `${photo.file_id}.${mime.extension(photo.mime_type || 'image/jpeg')}`);
                const response = await axios({ url: fileLink, method: 'GET', responseType: 'stream' });
                await new Promise((resolve, reject) => {
                    response.data.pipe(fs.createWriteStream(tempFilePath))
                        .on('finish', resolve)
                        .on('error', reject);
                });

                // This assumes instagramBot has a sendPhoto method that accepts a local file path.
                // You will need to ensure this is implemented in your `bot (2).js` (InstagramBot) file.
                await this.instagramBot.sendPhoto(instagramThreadId, tempFilePath, `[TG ${senderUsername}]: ${caption}`);
                logger.info(`✅ Sent photo from Telegram to Instagram thread ${instagramThreadId}`);

                await fs.remove(tempFilePath); // Clean up temporary file
            } catch (error) {
                logger.error(`❌ Error sending photo from Telegram to Instagram thread ${instagramThreadId}:`, error.message);
                await this.telegramBot.sendMessage(telegramChatId, `❌ Failed to send photo to Instagram: ${error.message}`);
            }
        });

        // Handle videos from Telegram
        this.telegramBot.on('video', async (msg) => {
            const telegramChatId = msg.chat.id;
            const video = msg.video;
            const caption = msg.caption || '';
            const senderUsername = msg.from.username || msg.from.first_name || 'TelegramUser';
            const effectiveTelegramChatId = msg.is_topic_message ? msg.message_thread_id : msg.chat.id;

            const mapping = config.mappings.find(m => m.telegram === effectiveTelegramChatId) || 
                            Array.from(this.chatMappings.entries()).find(([, value]) => value === effectiveTelegramChatId)?.[0];
            if (!mapping) {
                logger.warn(`Received video from unmapped Telegram chat ID: ${effectiveTelegramChatId}. User: ${senderUsername}`);
                return;
            }
            const instagramThreadId = mapping.instagram || mapping;

            try {
                const fileLink = await this.telegramBot.getFileLink(video.file_id);
                logger.info(`➡️ Received video from Telegram (Chat ${effectiveTelegramChatId}, User ${senderUsername}). Download URL: ${fileLink}`);

                const tempFilePath = path.join(this.tempDir, `${video.file_id}.${mime.extension(video.mime_type || 'video/mp4')}`);
                const response = await axios({ url: fileLink, method: 'GET', responseType: 'stream' });
                await new Promise((resolve, reject) => {
                    response.data.pipe(fs.createWriteStream(tempFilePath))
                        .on('finish', resolve)
                        .on('error', reject);
                });

                // This assumes instagramBot has a sendVideo method that accepts a local file path.
                // You will need to ensure this is implemented in your `bot (2).js` (InstagramBot) file.
                await this.instagramBot.sendVideo(instagramThreadId, tempFilePath, `[TG ${senderUsername}]: ${caption}`);
                logger.info(`✅ Sent video from Telegram to Instagram thread ${instagramThreadId}`);

                await fs.remove(tempFilePath); // Clean up temporary file
            } catch (error) {
                logger.error(`❌ Error sending video from Telegram to Instagram thread ${instagramThreadId}:`, error.message);
                await this.telegramBot.sendMessage(telegramChatId, `❌ Failed to send video to Instagram: ${error.message}`);
            }
        });

        // Add handlers for other types if needed (e.g., sticker, audio, document)
        this.telegramBot.on('sticker', async (msg) => {
            const telegramChatId = msg.chat.id;
            const sticker = msg.sticker;
            const senderUsername = msg.from.username || msg.from.first_name || 'TelegramUser';
            const effectiveTelegramChatId = msg.is_topic_message ? msg.message_thread_id : msg.chat.id;

            const mapping = config.mappings.find(m => m.telegram === effectiveTelegramChatId) || 
                            Array.from(this.chatMappings.entries()).find(([, value]) => value === effectiveTelegramChatId)?.[0];
            if (!mapping) {
                logger.warn(`Received sticker from unmapped Telegram chat ID: ${effectiveTelegramChatId}. User: ${senderUsername}`);
                return;
            }
            const instagramThreadId = mapping.instagram || mapping;

            try {
                const fileLink = await this.telegramBot.getFileLink(sticker.file_id);
                logger.info(`➡️ Received sticker from Telegram (Chat ${effectiveTelegramChatId}, User ${senderUsername}). File ID: ${sticker.file_id}`);
                // Instagram Direct Messaging does not natively support stickers in the same way Telegram does.
                // You might send it as a link or a generic "sent a sticker" message.
                await this.instagramBot.sendMessage(instagramThreadId, `[TG ${senderUsername}]: sent a sticker: ${sticker.emoji || ''} ${fileLink}`);
                logger.info(`✅ Sent sticker link/notification from Telegram to Instagram thread ${instagramThreadId}`);
            } catch (error) {
                logger.error(`❌ Error sending sticker from Telegram to Instagram thread ${instagramThreadId}:`, error.message);
                await this.telegramBot.sendMessage(telegramChatId, `❌ Failed to send sticker to Instagram: ${error.message}`);
            }
        });

        this.telegramBot.on('document', async (msg) => {
            const telegramChatId = msg.chat.id;
            const document = msg.document;
            const caption = msg.caption || '';
            const senderUsername = msg.from.username || msg.from.first_name || 'TelegramUser';
            const effectiveTelegramChatId = msg.is_topic_message ? msg.message_thread_id : msg.chat.id;

            const mapping = config.mappings.find(m => m.telegram === effectiveTelegramChatId) || 
                            Array.from(this.chatMappings.entries()).find(([, value]) => value === effectiveTelegramChatId)?.[0];
            if (!mapping) {
                logger.warn(`Received document from unmapped Telegram chat ID: ${effectiveTelegramChatId}. User: ${senderUsername}`);
                return;
            }
            const instagramThreadId = mapping.instagram || mapping;

            try {
                const fileLink = await this.telegramBot.getFileLink(document.file_id);
                logger.info(`➡️ Received document from Telegram (Chat ${effectiveTelegramChatId}, User ${senderUsername}). Filename: ${document.file_name}`);
                
                // Instagram Direct Messaging has limited document support. Best to send as a link.
                await this.instagramBot.sendMessage(instagramThreadId, `[TG ${senderUsername}]: sent a document: "${document.file_name}" ${caption ? `(${caption}) ` : ''}${fileLink}`);
                logger.info(`✅ Sent document link from Telegram to Instagram thread ${instagramThreadId}`);
            } catch (error) {
                logger.error(`❌ Error sending document from Telegram to Instagram thread ${instagramThreadId}:`, error.message);
                await this.telegramBot.sendMessage(telegramChatId, `❌ Failed to send document to Instagram: ${error.message}`);
            }
        });

        // Fallback for unhandled message types from Telegram
        this.telegramBot.on('message', async (msg) => {
            // This general handler catches anything not handled by specific listeners above
            // Check if it's not a handled type (text, photo, video, sticker, document, audio, voice)
            if (!msg.text && !msg.photo && !msg.video && !msg.document && !msg.sticker && !msg.audio && !msg.voice) {
                const telegramChatId = msg.chat.id;
                const senderUsername = msg.from.username || msg.from.first_name || 'TelegramUser';
                logger.warn(`Received unsupported message type from Telegram (Chat ${telegramChatId}, User ${senderUsername}):`, msg);
                // Optionally, send a message back to Telegram notifying about unsupported type
                // await this.telegramBot.sendMessage(telegramChatId, 'Received an unsupported message type.');
            }
        });

        logger.info('✅ Telegram message handlers set up.');
    }

    // --- Outbound from Instagram to Telegram ---
    async sendToTelegram(message) {
        if (!this.telegramBot || !this.enabled) return;

        try {
            const instagramThreadId = message.threadId;
            const senderUserId = message.senderId;
            // Assuming message contains senderUsername and profilePicUrl from MessageHandler
            const senderUsername = message.senderUsername; 
            const profilePicUrl = message.profilePicUrl; 

            // Get or create the Telegram topic/chat ID for this Instagram thread
            const telegramTopicId = await this.getOrCreateTopic(instagramThreadId, senderUserId);
            if (!telegramTopicId) {
                logger.error(`❌ Could not get/create Telegram topic for Instagram thread ${instagramThreadId}. Message not forwarded.`);
                return;
            }

            // Prepare sender information for Telegram (e.g., for forum topics)
            // Using HTML parse_mode for rich text
            const senderInfo = profilePicUrl ? `<a href="${profilePicUrl}"><b>${senderUsername}</b></a>` : `<b>${senderUsername}</b>`;
            const commonCaptionPrefix = `${senderInfo}: `;

            // Handle different message types coming from Instagram
            switch (message.type) {
                case 'text': {
                    const messageText = message.text || '';
                    await this.telegramBot.sendMessage(telegramTopicId, `${commonCaptionPrefix}${messageText}`, { parse_mode: 'HTML' });
                    logger.info(`✅ Sent text from Instagram to Telegram topic ${telegramTopicId}`);
                    break;
                }
                case 'media': // This typically refers to single photos/videos
                case 'photo': // Explicitly added for clarity, though often covered by 'media'
                case 'video': { // Explicitly added for clarity, though often covered by 'media'
                    const mediaUrl = message.media?.image_versions2?.candidates[0]?.url || message.media?.video_versions?.[0]?.url;
                    if (mediaUrl) {
                        const caption = `${commonCaptionPrefix}${message.text || ''}`;
                        const mimeType = mime.lookup(mediaUrl) || '';

                        if (mimeType.startsWith('image/')) {
                            await this.telegramBot.sendPhoto(telegramTopicId, mediaUrl, { caption: caption, parse_mode: 'HTML' });
                            logger.info(`✅ Sent photo from Instagram to Telegram topic ${telegramTopicId}`);
                        } else if (mimeType.startsWith('video/')) {
                            await this.telegramBot.sendVideo(telegramTopicId, mediaUrl, { caption: caption, parse_mode: 'HTML' });
                            logger.info(`✅ Sent video from Instagram to Telegram topic ${telegramTopicId}`);
                        } else {
                            await this.telegramBot.sendMessage(telegramTopicId, `${commonCaptionPrefix}[Unsupported Media Type] <a href="${mediaUrl}">Link</a>`, { parse_mode: 'HTML' });
                            logger.warn(`Unsupported Instagram media type with URL: ${mediaUrl}`);
                        }
                    } else {
                        await this.telegramBot.sendMessage(telegramTopicId, `${commonCaptionPrefix}[Media Message without URL]`, { parse_mode: 'HTML' });
                        logger.warn('Instagram media message without a direct URL found:', message);
                    }
                    break;
                }
                case 'animated_media': { // GIFs
                    const gifUrl = message.animated_media?.images?.[Object.keys(message.animated_media.images)[0]]?.url;
                    if (gifUrl) {
                        const caption = `${commonCaptionPrefix}${message.text || ''}`;
                        // Telegram often handles GIFs as documents or sends them directly if URL is .gif
                        await this.telegramBot.sendDocument(telegramTopicId, gifUrl, { caption: caption, parse_mode: 'HTML' });
                        logger.info(`✅ Sent GIF from Instagram to Telegram topic ${telegramTopicId}`);
                    } else {
                        await this.telegramBot.sendMessage(telegramTopicId, `${commonCaptionPrefix}[GIF Message without URL]`, { parse_mode: 'HTML' });
                        logger.warn('Instagram animated_media message without a direct URL found:', message);
                    }
                    break;
                }
                case 'media_share': { // Shared posts from Instagram
                    const postObj = message.media_share;
                    let postLink = '';
                    if (postObj.carousel_media) {
                        // For carousel, reconstruct the direct post link
                        const objId = postObj.id.substring(0,postObj.id.indexOf("_"));
                        // This assumes `idConverter` (from `instagram-id-to-url-segment`) is available in scope.
                        // If not, you'll need to import it or define it.
                        // Example: import idConverter from 'instagram-id-to-url-segment';
                        // For simplicity, including a direct link here.
                        postLink = `https://www.instagram.com/p/${idConverter.instagramIdToUrlSegment(objId)}/`; 
                    } else if (postObj.image_versions2) {
                        postLink = postObj.image_versions2?.candidates[0]?.url;
                    } else if (postObj.video_versions) {
                        postLink = postObj.video_versions?.[0]?.url;
                    }

                    let caption = `${commonCaptionPrefix}<b>[SHARED POST]</b> by @${postObj.user.username}.`;
                    if (postObj.caption?.text) {
                        caption += ` Caption: ${postObj.caption.text}`;
                    }

                    if (postLink) {
                        // Send as a link with a Telegram-friendly preview
                        await this.telegramBot.sendMessage(telegramTopicId, `${caption}\n<a href="${postLink}">View Post on Instagram</a>`, { parse_mode: 'HTML' });
                        logger.info(`✅ Sent media_share from Instagram to Telegram topic ${telegramTopicId}`);
                    } else {
                        await this.telegramBot.sendMessage(telegramTopicId, `${commonCaptionPrefix}[SHARED POST - Link Unavailable]`, { parse_mode: 'HTML' });
                        logger.warn('Instagram media_share message without a direct URL found:', message);
                    }
                    break;
                }
                case 'like': {
                    await this.telegramBot.sendMessage(telegramTopicId, `${commonCaptionPrefix}❤️ sent a like.`, { parse_mode: 'HTML' });
                    logger.info(`✅ Sent like notification from Instagram to Telegram topic ${telegramTopicId}`);
                    break;
                }
                case 'link': {
                    const linkText = message.link?.text || message.text || '';
                    await this.telegramBot.sendMessage(telegramTopicId, `${commonCaptionPrefix}[LINK] ${linkText}`, { parse_mode: 'HTML' });
                    logger.info(`✅ Sent link message from Instagram to Telegram topic ${telegramTopicId}`);
                    break;
                }
                case 'placeholder': {
                     let placeholderText = '';
                     if (message.placeholder?.title === "Post Unavailable") {
                         placeholderText = "<i>[SHARED POST] This post is unavailable due to its privacy settings.</i>";
                     } else {
                         placeholderText = "<i>[SHARED POST] This post is unavailable.</i>";
                     }
                     await this.telegramBot.sendMessage(telegramTopicId, `${commonCaptionPrefix}${placeholderText}`, { parse_mode: 'HTML' });
                     logger.info(`✅ Sent placeholder message from Instagram to Telegram topic ${telegramTopicId}`);
                     break;
                }
                default: {
                    logger.warn(`UNSUPPORTED INSTAGRAM MESSAGE TYPE (not forwarded to Telegram): ${message.type}`, message);
                    // Optionally, send a generic message to Telegram indicating an unhandled type
                    await this.telegramBot.sendMessage(telegramTopicId, `${commonCaptionPrefix}<i>[Unsupported Message Type: ${message.type}]</i>`, { parse_mode: 'HTML' });
                    break;
                }
            }
        } catch (error) {
            logger.error(`❌ Error sending message from Instagram to Telegram:`, error.message);
            // You might want to notify an admin or log this error more prominently
        }
    }

    // --- Shutdown ---
    async shutdown() {
        logger.info('🛑 Shutting down Instagram-Telegram bridge...');
        if (this.telegramBot) {
            try {
                await this.telegramBot.stopPolling();
                logger.info('📱 Telegram bot polling stopped.');
            } catch (error) {
                logger.debug('Error stopping Telegram polling:', error.message);
            }
        }
        try {
            // Clean up temporary files used for media transfers
            await fs.emptyDir(this.tempDir);
            logger.info('🧹 Temp directory cleaned.');
        } catch (error) {
            logger.debug('Could not clean temp directory:', error.message);
        }
        logger.info('✅ Instagram-Telegram bridge shutdown complete.');
    }
}

export { TelegramBridge };
