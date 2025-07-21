import { AutoReplyPlugin } from './AutoReplyPlugin.js';
import { MessageFilterPlugin } from './MessageFilterPlugin.js';
import { MessageLoggerPlugin } from './MessageLoggerPlugin.js';
import { CorePlugin } from './CorePlugin.js';
import { HelpPlugin } from './HelpPlugin.js';
import { logger } from '../utils.js';
import { config } from '../config.js';

export class PluginManager {
  constructor(instagramBot = null) {
    this.plugins = [];
    this.instagramBot = instagramBot;
  }

  async loadPlugins() {
    try {
      logger.info('🔌 Loading plugins...');

      // Load Core plugin first (always enabled)
      const corePlugin = new CorePlugin(this.instagramBot);
      this.plugins.push(corePlugin);
      logger.info('✅ Core plugin loaded');

      // Load Help plugin (always enabled)
      const helpPlugin = new HelpPlugin(this);
      this.plugins.push(helpPlugin);
      logger.info('✅ Help plugin loaded');

      // Load AutoReply plugin
      if (config.plugins.autoReply.enabled) {
        const autoReply = new AutoReplyPlugin();
        this.plugins.push(autoReply);
        logger.info('✅ AutoReply plugin loaded');
      }

      // Load MessageFilter plugin
      if (config.plugins.messageFilter.enabled) {
        const messageFilter = new MessageFilterPlugin();
        this.plugins.push(messageFilter);
        logger.info('✅ MessageFilter plugin loaded');
      }

      // Load MessageLogger plugin
      if (config.plugins.messageLogger.enabled) {
        const messageLogger = new MessageLoggerPlugin();
        this.plugins.push(messageLogger);
        logger.info('✅ MessageLogger plugin loaded');
      }

      logger.info(`🎉 Loaded ${this.plugins.length} plugins`);

    } catch (error) {
      logger.error('❌ Error loading plugins:', error);
    }
  }

  async processMessage(message) {
    let processedMessage = { ...message };

    for (const plugin of this.plugins) {
      try {
        processedMessage = await plugin.process(processedMessage);
        
        // If a plugin marks the message as not to be forwarded, stop processing
        if (!processedMessage.shouldForward) {
          break;
        }
      } catch (error) {
        logger.error(`Error in plugin ${plugin.constructor.name}:`, error);
      }
    }

    return processedMessage;
  }

  getPlugin(name) {
    return this.plugins.find(plugin => 
      plugin.constructor.name === name || 
      plugin.name === name ||
      plugin.constructor.name.toLowerCase() === name.toLowerCase() ||
      (plugin.name && plugin.name.toLowerCase() === name.toLowerCase())
    );
  }

  async unloadPlugins() {
    for (const plugin of this.plugins) {
      if (plugin.cleanup) {
        await plugin.cleanup();
      }
    }
    this.plugins = [];
    logger.info('🔌 All plugins unloaded');
  }
}