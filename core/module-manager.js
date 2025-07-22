import { logger, fileUtils } from '../utils/utils.js';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';

export class ModuleManager {
  constructor(instagramBot = null, telegramBridge = null) {
    this.modules = [];
    this.instagramBot = instagramBot;
    this.telegramBridge = telegramBridge;
    this.modulesPath = './modules';
  }

  async loadModules() {
    try {
      logger.info('🔌 Auto-loading Hyper Insta modules...');

      // Get all .js files in modules directory except ModuleManager.js
      const moduleFiles = fs.readdirSync(this.modulesPath)
        .filter(file => file.endsWith('.js') && file !== 'ModuleManager.js')
        .sort(); // Sort for consistent loading order

      for (const file of moduleFiles) {
        try {
          await this.loadModule(file);
        } catch (error) {
          logger.error(`❌ Failed to load module ${file}:`, error.message);
        }
      }

      logger.info(`🎉 Successfully loaded ${this.modules.length} modules`);

    } catch (error) {
      logger.error('❌ Error auto-loading modules:', error);
    }
  }

  async loadModule(filename) {
    try {
      const modulePath = path.join(this.modulesPath, filename);
      const moduleImport = await import(`../${modulePath}`);
      
      // Get the first exported class
      const ModuleClass = Object.values(moduleImport)[0];
      
      if (!ModuleClass || typeof ModuleClass !== 'function') {
        throw new Error(`No valid module class found in ${filename}`);
      }

      // Create module instance with dependencies
      let moduleInstance;
      const moduleName = ModuleClass.name;

      // Pass appropriate dependencies based on module type
      if (moduleName === 'CoreModule') {
        moduleInstance = new ModuleClass(this.instagramBot);
      } else if (moduleName === 'HelpModule') {
        moduleInstance = new ModuleClass(this);
      } else if (moduleName === 'TelegramModule') {
        moduleInstance = new ModuleClass(this.telegramBridge);
      } else {
        moduleInstance = new ModuleClass();
      }

      this.modules.push(moduleInstance);
      logger.info(`✅ ${moduleName} loaded`);

    } catch (error) {
      logger.error(`❌ Error loading module ${filename}:`, error.message);
      throw error;
    }
  }

  async processMessage(message) {
    let processedMessage = { ...message };

    for (const module of this.modules) {
      try {
        processedMessage = await module.process(processedMessage);
        
        // If a module marks the message as not to be forwarded, stop processing
        if (!processedMessage.shouldForward) {
          break;
        }
      } catch (error) {
        logger.error(`Error in module ${module.constructor.name}:`, error);
      }
    }

    return processedMessage;
  }

  getModule(name) {
    return this.modules.find(module => 
      module.constructor.name === name || 
      module.name === name ||
      module.constructor.name.toLowerCase() === name.toLowerCase() ||
      (module.name && module.name.toLowerCase() === name.toLowerCase())
    );
  }

  getAllCommands() {
    const allCommands = {};
    
    // Get commands from all modules
    for (const module of this.modules) {
      if (module.getCommands) {
        const commands = module.getCommands();
        for (const [name, command] of Object.entries(commands)) {
          allCommands[name] = {
            ...command,
            module: module.name || module.constructor.name
          };
        }
      }
    }

    return allCommands;
  }

  async unloadModules() {
    for (const module of this.modules) {
      if (module.cleanup) {
        await module.cleanup();
      }
    }
    this.modules = [];
    logger.info('🔌 All modules unloaded');
  }
}
