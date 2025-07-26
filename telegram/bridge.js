const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const { connectDb } = require('../utils/db');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const mime = require('mime-types');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const ffmpeg = require('fluent-ffmpeg');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const sharp = require('sharp'); // For sticker fallback

// A simplified logger to replace the original 'logger' for this bridge
const logger = {
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    debug: (...args) => { /* console.debug('[DEBUG]', ...args); */ } // Debug logs are mostly removed
};

class TelegramBridge {
    constructor(instagramBot) { // Changed from whatsappBot to instagramBot
        this.instagramBot = instagramBot; // Renamed for clarity with Instagram
        this.telegramBot = null;
        this.chatMappings = new Map(); // Maps Instagram threadId to Telegram topicId
        this.tempDir = path.join(__dirname, '../temp');
        this.botChatId = null; // Stores the main bot chat ID for private commands
        this.db = null;
        this.collection = null;
        this.userChatIds = new Set(); // Runtime memory for authorized Telegram users
        this.creatingTopics = new Map(); // To prevent duplicate topic creation
    }

    async initialize() {
        const token = config.telegram?.botToken; // Access from config object
        const chatId = config.telegram?.chatId; // Access from config object

        if (!token || token.includes('YOUR_BOT_TOKEN') || !chatId || chatId.includes('YOUR_CHAT_ID')) {
            logger.warn('⚠️ Telegram bot token or chat ID not configured. Bridge will not start.');
            return;
        }

        try {
            await this.initializeDatabase();
            await fs.ensureDir(this.tempDir); // Ensure temp directory exists

            this.telegramBot = new TelegramBot(token, {
                polling: true,
                onlyFirstMatch: true
            });

            await this.setupTelegramHandlers();
            await this.loadMappingsFromDb();
            await this.loadUserChatIds();

            logger.info('✅ Telegram bridge initialized. Ready for basic messaging.');
        } catch (error) {
            logger.error('❌ Failed to initialize Telegram bridge:', error.message);
            // console.error(error.stack); // Uncomment for detailed stack trace during debugging
        }
    }

    async initializeDatabase() {
        try {
            this.db = await connectDb();
            await this.db.command({ ping: 1 });
            logger.info('✅ MongoDB connection successful for Telegram bridge.');
            this.collection = this.db.collection('bridge_instagram'); // Use a distinct collection name
            // Index for chat mappings (Instagram threadId to Telegram topicId)
            await this.collection.createIndex({ type: 1, 'data.instagramThreadId': 1 }, { unique: true, partialFilterExpression: { type: 'chat' } });
            // Index for authorized Telegram users
            await this.collection.createIndex({ type: 1, 'data.chatId': 1 }, { unique: true, partialFilterExpression: { type: 'userChat' } });
            logger.info('📊 Database initialized for Telegram bridge.');
        } catch (error) {
            logger.error('❌ Failed to initialize database:', error.message);
        }
    }

    async loadMappingsFromDb() {
        try {
            const mappings = await this.collection.find({ type: 'chat' }).toArray();
            for (const mapping of mappings) {
                this.chatMappings.set(mapping.data.instagramThreadId, mapping.data.telegramTopicId);
            }
            logger.info(`📊 Loaded ${this.chatMappings.size} chat mappings from DB.`);
        } catch (error) {
            logger.error('❌ Failed to load chat mappings:', error.message);
        }
    }

    async saveChatMapping(instagramThreadId, telegramTopicId) {
        try {
            const updateData = {
                type: 'chat',
                data: {
                    instagramThreadId,
                    telegramTopicId,
                    createdAt: new Date(),
                    lastActivity: new Date()
                }
            };

            await this.collection.updateOne(
                { type: 'chat', 'data.instagramThreadId': instagramThreadId },
                { $set: updateData },
                { upsert: true }
            );

            this.chatMappings.set(instagramThreadId, telegramTopicId);
            logger.info(`✅ Saved chat mapping: ${instagramThreadId} -> ${telegramTopicId}`);
        } catch (error) {
            logger.error('❌ Failed to save chat mapping:', error.message);
        }
    }

    async loadUserChatIds() {
        try {
            const users = await this.collection.find({ type: 'userChat' }).toArray();
            this.userChatIds = new Set(users.map(u => u.data.chatId));
            logger.info(`✅ Loaded ${this.userChatIds.size} authorized Telegram bot users.`);
        } catch (err) {
            logger.error('❌ Failed to load user chat IDs:', err.message);
        }
    }

    // --- Telegram -> Instagram Message Handling ---
    async setupTelegramHandlers() {
        this.awaitingPassword = new Set(); // Track users awaiting password

        this.telegramBot.on('message', this.wrapHandler(async (msg) => {
            const chatType = msg.chat.type;

            // 1. Private chat (user DMs the bot for password/commands)
            if (chatType === 'private') {
                const chatId = msg.chat.id;
                const BOT_PASSWORD = config.telegram?.botPassword; // Access from config object

                const isVerified = await this.collection.findOne({ type: 'userChat', 'data.chatId': chatId });

                if (!isVerified) {
                    if (this.awaitingPassword.has(chatId)) {
                        if (msg.text?.trim() === BOT_PASSWORD) {
                            await this.collection.insertOne({
                                type: 'userChat',
                                data: { chatId, firstSeen: new Date() }
                            });
                            this.userChatIds.add(chatId);
                            this.botChatId = chatId;
                            this.awaitingPassword.delete(chatId);
                            await this.telegramBot.sendMessage(chatId, '✅ Access granted! You can now use the bot.');
                            logger.info(`🔓 Telegram bot access granted to: ${chatId}`);
                        } else {
                            await this.telegramBot.sendMessage(chatId, '❌ Incorrect password. Try again:');
                        }
                    } else {
                        this.awaitingPassword.add(chatId);
                        await this.telegramBot.sendMessage(chatId, '🔐 This bot is password-protected.\nPlease enter the password to continue:');
                    }
                    return; // Stop processing private messages further
                }

                // If already verified, allow commands (if you add any later)
                this.userChatIds.add(chatId); // Ensure it's in runtime set
                this.botChatId = chatId;
                // For this simplified bridge, we don't handle commands from Telegram directly
                // If you need them, re-integrate TelegramCommands and handleCommand here.
                await this.telegramBot.sendMessage(chatId, 'I only bridge messages. Please use a topic for chat.');

            }
            // 2. Group messages from forum topics (where bridging happens)
            else if (
                (chatType === 'supergroup' || chatType === 'group') &&
                msg.is_topic_message &&
                msg.message_thread_id
            ) {
                await this.handleTelegramMessage(msg);
            }
        }));

        this.telegramBot.on('polling_error', (error) => {
            logger.error('Telegram polling error:', error.message);
        });

        this.telegramBot.on('error', (error) => {
            logger.error('Telegram bot error:', error.message);
        });

        logger.info('📱 Telegram message handlers set up.');
    }

    wrapHandler(handler) {
        return async (...args) => {
            try {
                await handler(...args);
            } catch (error) {
                logger.error('❌ Unhandled error in Telegram handler:', error.message);
            }
        };
    }

    async handleTelegramMessage(msg) {
        try {
            const topicId = msg.message_thread_id;
            const instagramThreadId = this.findInstagramThreadIdByTopic(topicId);

            if (!instagramThreadId) {
                logger.warn(`⚠️ Could not find Instagram thread for Telegram topic ID: ${topicId}`);
                await this.telegramBot.sendMessage(msg.chat.id, '❌ This topic is not linked to an Instagram chat.', {
                    message_thread_id: topicId
                });
                return;
            }

            // Handle media messages from Telegram
            if (msg.photo) {
                await this.handleTelegramMedia(msg, 'photo', instagramThreadId);
            } else if (msg.video) {
                await this.handleTelegramMedia(msg, 'video', instagramThreadId);
            } else if (msg.animation) {
                await this.handleTelegramMedia(msg, 'animation', instagramThreadId);
            } else if (msg.video_note) {
                await this.handleTelegramMedia(msg, 'video_note', instagramThreadId);
            } else if (msg.voice) {
                await this.handleTelegramMedia(msg, 'voice', instagramThreadId);
            } else if (msg.audio) {
                await this.handleTelegramMedia(msg, 'audio', instagramThreadId);
            } else if (msg.document) {
                await this.handleTelegramMedia(msg, 'document', instagramThreadId);
            } else if (msg.sticker) {
                await this.handleTelegramSticker(msg, instagramThreadId);
            } else if (msg.text) {
                // Handle text messages from Telegram
                const originalText = msg.text.trim();
                await this.instagramBot.sendMessage(instagramThreadId, originalText);
                logger.info(`✅ Telegram text sent to Instagram thread ${instagramThreadId}`);
                await this.setReaction(msg.chat.id, msg.message_id, '👍');
            }

        } catch (error) {
            logger.error('❌ Failed to handle Telegram message for Instagram:', error.message);
            await this.setReaction(msg.chat.id, msg.message_id, '❌');
        }
    }

    async handleTelegramMedia(msg, mediaType, instagramThreadId) {
        try {
            let fileId, fileName, caption = msg.caption || '';

            switch (mediaType) {
                case 'photo':
                    fileId = msg.photo[msg.photo.length - 1].file_id;
                    fileName = `photo_${Date.now()}.jpg`;
                    break;
                case 'video':
                    fileId = msg.video.file_id;
                    fileName = `video_${Date.now()}.mp4`;
                    break;
                case 'animation':
                    fileId = msg.animation.file_id;
                    fileName = `animation_${Date.now()}.mp4`;
                    break;
                case 'video_note':
                    fileId = msg.video_note.file_id;
                    fileName = `video_note_${Date.now()}.mp4`;
                    break;
                case 'voice':
                    fileId = msg.voice.file_id;
                    fileName = `voice_${Date.now()}.ogg`;
                    break;
                case 'audio':
                    fileId = msg.audio.file_id;
                    fileName = msg.audio.file_name || `audio_${Date.now()}.mp3`;
                    break;
                case 'document':
                    fileId = msg.document.file_id;
                    fileName = msg.document.file_name || `document_${Date.now()}`;
                    break;
                default:
                    logger.warn(`⚠️ Unsupported media type from Telegram: ${mediaType}`);
                    return;
            }

            logger.info(`📥 Downloading ${mediaType} from Telegram.`);
            const fileLink = await this.telegramBot.getFileLink(fileId);
            const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data);

            const filePath = path.join(this.tempDir, fileName);
            await fs.writeFile(filePath, buffer);
            logger.info(`💾 Saved ${mediaType} to: ${filePath}`);

            // Instagram API often requires specific methods for media
            // This is a simplified example, you might need to adjust based on instagram-private-api capabilities
            let sendSuccess = false;
            if (mediaType === 'photo') {
                // Instagram API has methods like uploadPhoto, broadcastPhoto
                // Assuming instagramBot has a method like sendPhoto or similar
                // You might need to adjust this based on your InstagramBot's actual capabilities
                await this.instagramBot.sendPhoto(instagramThreadId, filePath, caption);
                sendSuccess = true;
            } else if (mediaType === 'video' || mediaType === 'animation' || mediaType === 'video_note') {
                // Assuming instagramBot has a method like sendVideo or similar
                await this.instagramBot.sendVideo(instagramThreadId, filePath, caption);
                sendSuccess = true;
            } else if (mediaType === 'audio' || mediaType === 'voice' || mediaType === 'document') {
                // Instagram Direct API might not support all file types directly.
                // You might need to send a link or a text message indicating a file.
                // For simplicity, we'll send a text message as a fallback.
                await this.instagramBot.sendMessage(instagramThreadId, `[Received ${mediaType} from Telegram: ${caption || fileName}]`);
                sendSuccess = true;
            }

            await fs.unlink(filePath).catch(() => {}); // Clean up temp file

            if (sendSuccess) {
                logger.info(`✅ Successfully sent ${mediaType} from Telegram to Instagram thread ${instagramThreadId}`);
                await this.setReaction(msg.chat.id, msg.message_id, '👍');
            } else {
                logger.warn(`⚠️ Failed to send ${mediaType} to Instagram (unsupported type or method missing).`);
                await this.setReaction(msg.chat.id, msg.message_id, '❌');
            }

        } catch (error) {
            logger.error(`❌ Failed to handle Telegram ${mediaType}:`, error.message);
            await this.setReaction(msg.chat.id, msg.message_id, '❌');
        }
    }

    async handleTelegramSticker(msg, instagramThreadId) {
        const topicId = msg.message_thread_id;
        const chatId = msg.chat.id;

        try {
            const fileId = msg.sticker.file_id;
            const fileLink = await this.telegramBot.getFileLink(fileId);
            const stickerBuffer = (await axios.get(fileLink, { responseType: 'arraybuffer' })).data;
            const fileName = `sticker_${Date.now()}`;
            const inputPath = path.join(this.tempDir, `${fileName}.webp`);
            await fs.writeFile(inputPath, stickerBuffer);

            let outputBuffer;
            const isAnimated = msg.sticker.is_animated || msg.sticker.is_video;

            if (isAnimated) {
                // Convert animated sticker to a format Instagram might accept (e.g., MP4 or GIF)
                const animatedPath = await this.convertAnimatedSticker(inputPath);
                if (animatedPath) {
                    outputBuffer = await fs.readFile(animatedPath);
                    // Assuming InstagramBot has a method to send video/gif
                    await this.instagramBot.sendVideo(instagramThreadId, animatedPath, 'Animated sticker from Telegram');
                    await fs.unlink(animatedPath).catch(() => {});
                } else {
                    throw new Error('Animated sticker conversion failed');
                }
            } else {
                // Convert static sticker to PNG or JPG if Instagram doesn't accept WebP directly
                const pngPath = inputPath.replace('.webp', '.png');
                await sharp(stickerBuffer).png().toFile(pngPath);
                // Assuming InstagramBot has a method to send photo
                await this.instagramBot.sendPhoto(instagramThreadId, pngPath, 'Sticker from Telegram');
                await fs.unlink(pngPath).catch(() => {});
            }

            await fs.unlink(inputPath).catch(() => {});

            logger.info('✅ Sticker sent to Instagram');
            await this.setReaction(chatId, msg.message_id, '👍');

        } catch (err) {
            logger.error('❌ Failed to send sticker to Instagram:', err.message);
            await this.setReaction(chatId, msg.message_id, '❌');
            // Fallback: send text message indicating a sticker was received
            await this.instagramBot.sendMessage(instagramThreadId, '[Received a sticker from Telegram]');
        }
    }

    async convertAnimatedSticker(inputPath) {
        // This conversion is highly dependent on what Instagram's API accepts.
        // For simplicity, we'll try to convert to MP4.
        const outputPath = inputPath.replace('.webp', '-converted.mp4');

        return new Promise((resolve) => {
            ffmpeg(inputPath)
                .outputOptions([
                    '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black',
                    '-pix_fmt', 'yuv420p', // Important for broad compatibility
                    '-c:v', 'libx264', // H.264 codec
                    '-movflags', '+faststart', // Optimize for streaming
                    '-an' // No audio
                ])
                .outputFormat('mp4')
                .on('end', () => {
                    logger.debug('Animated sticker conversion to MP4 completed');
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    logger.debug('Animated sticker conversion to MP4 failed:', err.message);
                    resolve(null); // Return null on failure
                })
                .save(outputPath);
        });
    }

    // --- Instagram -> Telegram Message Handling ---
    async sendToTelegram(message) { // 'message' is the processedMessage from InstagramBot
        if (!this.telegramBot) {
            logger.warn('⚠️ Telegram bot not initialized, cannot send message.');
            return;
        }

        const instagramThreadId = message.threadId;
        const instagramSenderUsername = message.senderUsername;
        const instagramText = message.text;
        const instagramType = message.type; // e.g., 'text', 'media', 'raven_media'
        const instagramRaw = message.raw; // Full raw message from Instagram

        // Get or create a Telegram topic for this Instagram thread
        const topicId = await this.getOrCreateTopic(instagramThreadId, instagramSenderUsername);

        if (!topicId) {
            logger.error(`❌ Could not get or create Telegram topic for Instagram thread: ${instagramThreadId}`);
            return;
        }

        const chatId = config.telegram?.chatId; // Main Telegram chat ID

        // Construct message prefix for Telegram
        let prefix = `*${instagramSenderUsername}*: `;

        try {
            // Handle different message types from Instagram
            if (instagramType === 'text' && instagramText) {
                await this.telegramBot.sendMessage(chatId, prefix + instagramText, {
                    message_thread_id: topicId,
                    parse_mode: 'Markdown'
                });
                logger.info(`✅ Instagram text sent to Telegram topic ${topicId}`);
            } else if (instagramType === 'media' || instagramType === 'raven_media') {
                // Handle media messages from Instagram
                // This part needs to interact with instagram-private-api's download methods
                // and then send to Telegram. This is a placeholder.
                let mediaUrl = null;
                let mediaCaption = instagramRaw.caption?.text || '';

                if (instagramRaw.image_versions2?.candidates?.[0]?.url) {
                    mediaUrl = instagramRaw.image_versions2.candidates[0].url;
                    // Send as photo
                    await this.telegramBot.sendPhoto(chatId, mediaUrl, {
                        message_thread_id: topicId,
                        caption: prefix + mediaCaption,
                        parse_mode: 'Markdown'
                    });
                    logger.info(`✅ Instagram photo sent to Telegram topic ${topicId}`);
                } else if (instagramRaw.video_versions?.[0]?.url) {
                    mediaUrl = instagramRaw.video_versions[0].url;
                    // Send as video
                    await this.telegramBot.sendVideo(chatId, mediaUrl, {
                        message_thread_id: topicId,
                        caption: prefix + mediaCaption,
                        parse_mode: 'Markdown'
                    });
                    logger.info(`✅ Instagram video sent to Telegram topic ${topicId}`);
                } else {
                    // Fallback for other media types or if URL not easily found
                    await this.telegramBot.sendMessage(chatId, prefix + `[Received unsupported media type from Instagram: ${instagramType}] ${mediaCaption}`, {
                        message_thread_id: topicId,
                        parse_mode: 'Markdown'
                    });
                    logger.warn(`⚠️ Unsupported Instagram media type or no direct URL found: ${instagramType}`);
                }
            } else {
                // Fallback for any other unhandled message types
                await this.telegramBot.sendMessage(chatId, prefix + `[Received message of type: ${instagramType}]`, {
                    message_thread_id: topicId,
                    parse_mode: 'Markdown'
                });
                logger.warn(`⚠️ Unhandled Instagram message type: ${instagramType}`);
            }
        } catch (error) {
            logger.error(`❌ Failed to send Instagram message to Telegram topic ${topicId}:`, error.message);
        }
    }

    async getOrCreateTopic(instagramThreadId, instagramSenderUsername) {
        // If topic already cached, return
        if (this.chatMappings.has(instagramThreadId)) {
            return this.chatMappings.get(instagramThreadId);
        }

        // If another creation is in progress, wait for it
        if (this.creatingTopics.has(instagramThreadId)) {
            return await this.creatingTopics.get(instagramThreadId);
        }

        const creationPromise = (async () => {
            const chatId = config.telegram?.chatId;
            if (!chatId || chatId.includes('YOUR_CHAT_ID')) {
                logger.error('❌ Telegram chat ID not configured for topic creation.');
                return null;
            }

            try {
                // Use Instagram username as topic name
                const topicName = instagramSenderUsername;
                const iconColor = 0x6FB9F0; // A default color

                const topic = await this.telegramBot.createForumTopic(chatId, topicName, {
                    icon_color: iconColor
                });

                await this.saveChatMapping(instagramThreadId, topic.message_thread_id);
                logger.info(`🆕 Created Telegram topic: "${topicName}" (ID: ${topic.message_thread_id}) for Instagram thread ${instagramThreadId}`);

                return topic.message_thread_id;

            } catch (error) {
                logger.error('❌ Failed to create Telegram topic:', error.message);
                return null;
            } finally {
                this.creatingTopics.delete(instagramThreadId); // Cleanup after done
            }
        })();

        this.creatingTopics.set(instagramThreadId, creationPromise);
        return await creationPromise;
    }

    findInstagramThreadIdByTopic(topicId) {
        for (const [threadId, mappedTopicId] of this.chatMappings.entries()) {
            if (mappedTopicId === topicId) {
                return threadId;
            }
        }
        return null;
    }

    async setReaction(chatId, messageId, emoji) {
        try {
            const token = config.telegram?.botToken;
            if (!token) {
                logger.warn('⚠️ Telegram bot token missing for setting reaction.');
                return;
            }
            await axios.post(`https://api.telegram.org/bot${token}/setMessageReaction`, {
                chat_id: chatId,
                message_id: messageId,
                reaction: [{ type: 'emoji', emoji }]
            });
        } catch (err) {
            // Suppress reaction errors as they are not critical for bridging
            // logger.debug('❌ Failed to set reaction:', err?.response?.data?.description || err.message);
        }
    }

    async shutdown() {
        logger.info('🛑 Shutting down Telegram bridge...');
        if (this.telegramBot) {
            try {
                await this.telegramBot.stopPolling();
                logger.info('📱 Telegram bot polling stopped.');
            } catch (error) {
                logger.debug('Error stopping Telegram polling:', error.message);
            }
        }
        try {
            await fs.emptyDir(this.tempDir);
            logger.info('🧹 Temp directory cleaned.');
        } catch (error) {
            logger.debug('Could not clean temp directory:', error.message);
        }
        logger.info('✅ Telegram bridge shutdown complete.');
    }
}

module.exports = TelegramBridge;
