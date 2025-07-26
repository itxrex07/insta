// message-handler.js
// import { logger } from '../utils/utils.js'; // Uncomment if logger works
import { config } from '../config.js'; // Ensure path is correct

// Fallback logger if utils logger isn't working as expected for debugging
const logger = {
  info: (...args) => console.log('[INFO] [MessageHandler]', ...args),
  error: (...args) => console.error('[ERROR] [MessageHandler]', ...args),
  debug: (...args) => console.log('[DEBUG] [MessageHandler]', ...args), // Use console.log for debug
};

export class MessageHandler {
  /**
   * Creates a MessageHandler instance.
   * @param {InstagramBot} instagramBot - The main bot instance.
   * @param {ModuleManager} moduleManager - The module manager instance.
   * @param {TelegramBridge} telegramBridge - The Telegram bridge instance (can be null/disabled). <--- Updated
   */
  constructor(instagramBot, moduleManager, telegramBridge) { // <-- Updated
    if (!instagramBot) {
        throw new Error('InstagramBot instance is required');
    }
    if (!moduleManager) {
        throw new Error('ModuleManager instance is required');
    }
    this.instagramBot = instagramBot;
    this.moduleManager = moduleManager;
    this.telegramBridge = telegramBridge; // <-- Store it
    logger.debug('MessageHandler initialized with Telegram Bridge.');
  }


  /**
   * Main entry point for handling incoming messages.
   * @param {Object} message - The processed message object from InstagramBot.
   */
  async handleMessage(message) {
    try {
      logger.debug('📩 handleMessage called with:', JSON.stringify({ id: message?.id, sender: message?.senderUsername, text: message?.text }, null, 2));

      // Ensure message has basic structure
      if (!message || typeof message !== 'object') {
        logger.warn('⚠️ handleMessage received invalid message object:', message);
        return;
      }

      // 1. Pre-process message through modules (e.g., stats, logging, transformations)
      logger.debug('⚙️ Processing message through ModuleManager...');
      const processedMessage = await this.moduleManager.processMessage(message);
      logger.debug('✅ Message pre-processing complete.');

      // 2. Check for commands (messages starting with '.')
      if (processedMessage.text?.startsWith('.')) {
        logger.info(`⚡ Command detected: ${processedMessage.text} from @${processedMessage.senderUsername}`);
        await this.handleCommand(processedMessage);
        return; // Stop further processing for commands
      }

      // 3. Forward non-command messages to Telegram if enabled
      if (this.telegramBridge?.enabled && config.telegram?.enabled) {
        logger.debug('📨 Forwarding non-command message to Telegram...');
        await this.telegramBridge.forwardInstagramMessage(processedMessage);
        logger.debug('✅ Message forwarded to Telegram.');
      } else if (config.telegram?.enabled && !this.telegramBridge?.enabled) {
          logger.warn('⚠️ Telegram is enabled in config but bridge is not available or disabled.');
      }

      logger.debug('🏁 handleMessage finished for message ID:', processedMessage.id);

    } catch (error) {
      // Log the full error context
      logger.error('❌ Critical error in MessageHandler.handleMessage:', error.message);
      logger.debug('MessageHandler.handleError stack:', error.stack);
      logger.debug('Problematic message object:', JSON.stringify(message, null, 2));
      // Optionally, notify the user or admins about the internal error
      // This should be done carefully to avoid loops or leaking info
      /*
      if (message && message.threadId) {
        try {
          await this.instagramBot.sendMessage(message.threadId, "❌ Sorry, an internal error occurred while processing your message.");
        } catch (sendError) {
          logger.error("Failed to send error notification to user:", sendError.message);
        }
      }
      */
    }
  }

  /**
   * Handles command execution.
   * @param {Object} message - The processed message object containing the command.
   * @private
   */
  async handleCommand(message) {
    // Extract command name and arguments
    const commandText = message.text.slice(1).trim(); // Remove leading '.'
    const [commandName, ...args] = commandText.split(/\s+/); // Split by whitespace
    const commandNameLower = commandName?.toLowerCase(); // Normalize command name

    if (!commandNameLower) {
        logger.warn(`⚠️ Empty command received from @${message.senderUsername}`);
        // Optionally notify user: await this.instagramBot.sendMessage(message.threadId, "❓ Please provide a command.");
        return;
    }

    logger.debug(`🔍 Looking up command: ${commandNameLower}`);

    // 1. Retrieve the command handler from the module manager
    const command = this.moduleManager.getCommand(commandNameLower);

    // 2. Check if command exists
    if (!command) {
      logger.info(`❓ Unknown command '.${commandNameLower}' received from @${message.senderUsername}`);
      // Optionally notify user about unknown command
      await this.instagramBot.sendMessage(message.threadId, `❓ Unknown command: .${commandName}`);
      return;
    }

    logger.debug(`✅ Command '.${commandNameLower}' found.`);

    // 3. Check admin permissions if required
    if (command.adminOnly) {
      const isAdmin = this.isAdmin(message.senderUsername);
      logger.debug(`🔐 Admin check for '.${commandNameLower}' by @${message.senderUsername}: ${isAdmin}`);
      if (!isAdmin) {
        logger.info(`🚫 Admin access denied for '.${commandNameLower}' to user @${message.senderUsername}`);
        await this.instagramBot.sendMessage(message.threadId, '❌ Admin only command.');
        return;
      }
      logger.info(`✅ Admin access granted for '.${commandNameLower}' to user @${message.senderUsername}`);
    } else {
        logger.debug(`🔓 Command '.${commandNameLower}' is public.`);
    }

    try {
      // 4. Log command execution attempt
      logger.info(`🚀 Executing command: .${commandNameLower} by @${message.senderUsername} with args: [${args.join(', ')}]`);

      // 5. Execute the command handler
      // Pass args and the full message object to the handler
      // 'this' context inside the handler might need adjustment depending on how modules are written
      // If modules expect 'this.instagramBot' etc., you might need to bind or pass context differently
      await command.handler.call(command.context || this, args, message); // .call for potential context binding

      logger.info(`✅ Command '.${commandNameLower}' executed successfully.`);

    } catch (error) {
      // Log the command-specific error
      logger.error(`💥 Error executing command '.${commandNameLower}':`, error.message);
      logger.debug(`Command '.${commandNameLower}' error stack:`, error.stack);
      // Optionally, send error details back to the user
      await this.instagramBot.sendMessage(message.threadId, `❌ Command Error: ${error.message || 'Unknown error occurred.'}`);
    }
  }

  /**
   * Checks if a given username is an admin.
   * @param {string} username - The Instagram username to check.
   * @returns {boolean} True if the user is an admin, false otherwise.
   * @private
   */
  isAdmin(username) {
    const adminsList = config.admin?.users || [];
    const normalizedUsername = username?.toLowerCase().trim();
    const isAdmin = adminsList.includes(normalizedUsername);
    logger.debug(`.isAdmin check: '${normalizedUsername}' -> ${isAdmin}`);
    return isAdmin;
  }
}
