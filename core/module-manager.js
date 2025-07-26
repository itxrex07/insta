import { logger } from '../utils/utils.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// For ES modules, we need to handle __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ModuleManager {
  constructor(instagramBot = null) {
    this.modules = [];
    this.commandRegistry = new Map();
    this.instagramBot = instagramBot;
    this.modulesPath = path.join(__dirname, '..', 'modules'); // Better path resolution
  }

  async loadModules() {
    try {
      logger.info('📂 Looking for modules in:', this.modulesPath);
      
      if (!fs.existsSync(this.modulesPath)) {
        logger.warn('📁 Modules directory not found');
        return;
      }

      const moduleFiles = fs.readdirSync(this.modulesPath)
        .filter(file => file.endsWith('.js') && file !== 'index.js')
        .sort();

      logger.info('📄 Found module files:', moduleFiles);

      for (const file of moduleFiles) {
        await this.loadModule(file);
      }

      this.buildCommandRegistry();
      logger.info(`🔌 Loaded ${this.modules.length} modules with ${this.commandRegistry.size} commands`);

    } catch (error) {
      logger.error('❌ Module loading error:', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  async loadModule(filename) {
    try {
      const modulePath = path.join(this.modulesPath, filename);
      logger.info(`📥 Loading module: ${filename} from ${modulePath}`);
      
      // Clear module cache for hot reloading (optional)
      const moduleUrl = `file://${modulePath}?update=${Date.now()}`;
      const moduleImport = await import(moduleUrl);
      const ModuleClass = Object.values(moduleImport)[0];
      
      if (!ModuleClass || typeof ModuleClass !== 'function') {
        throw new Error(`No valid module class in ${filename}`);
      }

      let moduleInstance;
      const moduleName = ModuleClass.name;

      logger.info(`🔧 Creating module instance: ${moduleName}`);

      if (moduleName === 'CoreModule') {
        moduleInstance = new ModuleClass(this.instagramBot);
      } else if (moduleName === 'HelpModule') {
        moduleInstance = new ModuleClass(this);
      } else {
        moduleInstance = new ModuleClass();
      }

      // Set module manager reference
      moduleInstance.moduleManager = this;
      this.modules.push(moduleInstance);
      logger.info(`✅ Loaded module: ${moduleName}`);

    } catch (error) {
      logger.error(`❌ Failed to load ${filename}:`, {
        error: error.message,
        stack: error.stack
      });
    }
  }

  buildCommandRegistry() {
    this.commandRegistry.clear();
    
    for (const module of this.modules) {
      try {
        const commands = module.getCommands();
        logger.info(`📋 Module ${module.constructor.name} has commands:`, Object.keys(commands));
        
        for (const [name, command] of Object.entries(commands)) {
          const fullCommand = {
            ...command,
            module: module,
            moduleName: module.name || module.constructor.name.replace('Module', '').toLowerCase()
          };
          
          this.commandRegistry.set(name.toLowerCase(), fullCommand);
          logger.info(`📌 Registered command: ${name} from ${module.constructor.name}`);
        }
      } catch (error) {
        logger.error(`❌ Error building commands for ${module.constructor.name}:`, error.message);
      }
    }
    
    logger.info(`📚 Total commands registered: ${this.commandRegistry.size}`);
  }

  getCommand(name) {
    const command = this.commandRegistry.get(name.toLowerCase());
    logger.info(`🔍 Command lookup for "${name}":`, {
      found: !!command,
      available: Array.from(this.commandRegistry.keys())
    });
    return command;
  }

  // ✅ This was missing!
  getAvailableCommands() {
    return Array.from(this.commandRegistry.keys());
  }

  getAllCommands() {
    return this.commandRegistry;
  }

  getModule(name) {
    return this.modules.find(module => 
      module.constructor.name.toLowerCase().includes(name.toLowerCase()) ||
      (module.name && module.name.toLowerCase() === name.toLowerCase())
    );
  }

  async processMessage(message) {
    for (const module of this.modules) {
      try {
        message = await module.process(message);
      } catch (error) {
        logger.error(`❌ Module ${module.constructor.name} processing error:`, error.message);
      }
    }
    return message;
  }

  async cleanup() {
    for (const module of this.modules) {
      if (module.cleanup) {
        await module.cleanup();
      }
    }
    this.modules = [];
    this.commandRegistry.clear();
  }
}
