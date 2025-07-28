import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

export class ModuleManager {
  constructor(instagramBot = null, telegramBridge = null) {
    this.modules = [];
    this.commandRegistry = new Map();
    this.instagramBot = instagramBot;
    this.telegramBridge = telegramBridge;
    this.modulesPath = './modules';
    this.loadedModules = new Set();
  }

  async loadModules() {
    try {
      if (!fs.existsSync(this.modulesPath)) {
        logger.warn(`Modules directory not found: ${this.modulesPath}`);
        return;
      }

      const moduleFiles = fs.readdirSync(this.modulesPath)
        .filter(file => file.endsWith('.js') && !file.startsWith('.'))
        .sort();

      logger.info(`Found ${moduleFiles.length} module files`);

      for (const file of moduleFiles) {
        await this.loadModule(file);
      }

      this.buildCommandRegistry();
      logger.info(`Successfully loaded ${this.modules.length} modules with ${this.commandRegistry.size} commands`);

    } catch (error) {
      logger.error('Error loading modules:', error.message);
    }
  }

  async loadModule(filename) {
    try {
      if (this.loadedModules.has(filename)) {
        logger.debug(`Module ${filename} already loaded, skipping`);
        return;
      }

      const modulePath = path.resolve(this.modulesPath, filename);
      const moduleImport = await import(`file://${modulePath}`);
      
      // Get the first exported class
      const ModuleClass = Object.values(moduleImport).find(exp => 
        typeof exp === 'function' && exp.prototype && exp.prototype.constructor === exp
      );
      
      if (!ModuleClass) {
        throw new Error(`No valid module class found in ${filename}`);
      }

      let moduleInstance;
      const moduleName = ModuleClass.name;

      // Initialize module with appropriate dependencies
      if (moduleName === 'CoreModule') {
        moduleInstance = new ModuleClass(this.instagramBot);
      } else if (moduleName === 'HelpModule') {
        moduleInstance = new ModuleClass(this);
      } else if (moduleName === 'FollowersModule') {
        moduleInstance = new ModuleClass(this.instagramBot);
      } else {
        // Generic module initialization
        moduleInstance = new ModuleClass(this.instagramBot, this.telegramBridge);
      }

      // Set module manager reference
      if (moduleInstance) {
        moduleInstance.moduleManager = this;
        this.modules.push(moduleInstance);
        this.loadedModules.add(filename);
        
        logger.debug(`Loaded module: ${moduleName} from ${filename}`);
      }

    } catch (error) {
      logger.error(`Failed to load module ${filename}:`, error.message);
    }
  }

  buildCommandRegistry() {
    this.commandRegistry.clear();
    
    for (const module of this.modules) {
      try {
        const commands = module.getCommands();
        if (!commands || typeof commands !== 'object') {
          logger.debug(`Module ${module.constructor.name} has no commands`);
          continue;
        }

        for (const [name, command] of Object.entries(commands)) {
          if (typeof command.handler !== 'function') {
            logger.warn(`Invalid command handler for ${name} in ${module.constructor.name}`);
            continue;
          }

          const commandKey = name.toLowerCase();
          if (this.commandRegistry.has(commandKey)) {
            logger.warn(`Command ${name} already exists, overriding`);
          }

          this.commandRegistry.set(commandKey, {
            ...command,
            module: module,
            moduleName: module.name || module.constructor.name.replace('Module', '').toLowerCase()
          });
        }
      } catch (error) {
        logger.error(`Error building commands for module ${module.constructor.name}:`, error.message);
      }
    }

    logger.debug(`Built command registry with ${this.commandRegistry.size} commands`);
  }

  getCommand(name) {
    if (!name) return null;
    return this.commandRegistry.get(name.toLowerCase());
  }

  getAllCommands() {
    return this.commandRegistry;
  }

  getModule(name) {
    if (!name) return null;
    
    return this.modules.find(module => {
      const moduleName = module.constructor.name.toLowerCase();
      const moduleAlias = module.name?.toLowerCase();
      const searchName = name.toLowerCase();
      
      return moduleName.includes(searchName) || 
             moduleAlias === searchName ||
             moduleName.replace('module', '') === searchName;
    });
  }

  async processMessage(message) {
    for (const module of this.modules) {
      try {
        if (typeof module.process === 'function') {
          message = await module.process(message);
        }
      } catch (error) {
        logger.error(`Error processing message in module ${module.constructor.name}:`, error.message);
      }
    }
    return message;
  }

  async reloadModule(filename) {
    try {
      // Remove from loaded modules
      this.loadedModules.delete(filename);
      
      // Remove existing module instance
      const moduleIndex = this.modules.findIndex(m => 
        m.constructor.name.toLowerCase().includes(filename.replace('.js', '').toLowerCase())
      );
      
      if (moduleIndex !== -1) {
        const module = this.modules[moduleIndex];
        if (typeof module.cleanup === 'function') {
          await module.cleanup();
        }
        this.modules.splice(moduleIndex, 1);
      }

      // Reload the module
      await this.loadModule(filename);
      this.buildCommandRegistry();
      
      logger.info(`Successfully reloaded module: ${filename}`);
      return true;
    } catch (error) {
      logger.error(`Failed to reload module ${filename}:`, error.message);
      return false;
    }
  }

  getModuleStats() {
    return {
      totalModules: this.modules.length,
      totalCommands: this.commandRegistry.size,
      modules: this.modules.map(module => ({
        name: module.constructor.name,
        alias: module.name,
        commands: Object.keys(module.getCommands?.() || {}).length
      }))
    };
  }

  async cleanup() {
    logger.info('Cleaning up module manager...');
    
    for (const module of this.modules) {
      try {
        if (typeof module.cleanup === 'function') {
          await module.cleanup();
        }
      } catch (error) {
        logger.error(`Error cleaning up module ${module.constructor.name}:`, error.message);
      }
    }
    
    this.modules = [];
    this.commandRegistry.clear();
    this.loadedModules.clear();
    
    logger.info('Module manager cleanup complete');
  }
}