import { logger } from '../core/utils.js';

export class HelpModule {
  constructor(moduleManager) {
    this.name = 'help';
    this.moduleManager = moduleManager;
    this.commandPrefix = '.';
    this.commands = {
      'help': {
        description: 'Show available commands and modules',
        usage: '.help [command|module]',
        handler: this.handleHelp.bind(this)
      },
      'commands': {
        description: 'List all available commands',
        usage: '.commands',
        handler: this.handleCommands.bind(this)
      },
      'modules': {
        description: 'List all loaded modules',
        usage: '.modules',
        handler: this.handleModules.bind(this)
      }
    };
  }

  async process(message) {
    try {
      // Check if message starts with command prefix
      if (message.text && message.text.startsWith(this.commandPrefix)) {
        const commandText = message.text.slice(this.commandPrefix.length).trim();
        const [commandName, ...args] = commandText.split(' ');
        
        if (this.commands[commandName.toLowerCase()]) {
          await this.executeCommand(commandName.toLowerCase(), args, message);
          message.shouldForward = false; // Don't forward command messages
        }
      }
    } catch (error) {
      logger.error('Error in Help module:', error);
    }

    return message;
  }

  async executeCommand(commandName, args, message) {
    try {
      const command = this.commands[commandName];
      logger.info(`🎯 Executing help command: ${commandName} by @${message.senderUsername}`);
      await command.handler(args, message);
    } catch (error) {
      logger.error(`Error executing help command ${commandName}:`, error);
      await this.sendReply(message, `❌ Error executing command: ${error.message}`);
    }
  }

  async handleHelp(args, message) {
    const query = args[0]?.toLowerCase();
    
    if (!query) {
      // Show general help
      const helpMessage = `🚀 **Hyper Insta Help**\n\n` +
        `Use \`.help <command>\` for specific command help\n` +
        `Use \`.commands\` to see all available commands\n` +
        `Use \`.modules\` to see all loaded modules\n\n` +
        `**Quick Commands:**\n` +
        `• \`.ping\` - Check bot status\n` +
        `• \`.status\` - Show detailed bot status\n` +
        `• \`.help\` - Show this help message\n\n` +
        `**Command Prefix:** \`${this.commandPrefix}\``;
      
      await this.sendReply(message, helpMessage);
      return;
    }

    // Check if it's a specific command
    const allCommands = this.moduleManager.getAllCommands();
    const command = allCommands[query];
    
    if (command) {
      const commandHelp = `🎯 **Command: ${query}**\n\n` +
        `📝 Description: ${command.description}\n` +
        `💡 Usage: \`${command.usage}\`\n` +
        `🔧 Module: ${command.module || 'Unknown'}` +
        (command.adminOnly ? '\n⚠️ Admin only command' : '');
      
      await this.sendReply(message, commandHelp);
      return;
    }

    // Check if it's a module
    const module = this.moduleManager.getModule(query);
    if (module) {
      await this.showModuleHelp(module, message);
      return;
    }

    await this.sendReply(message, `❌ Command or module '${query}' not found. Use \`.help\` to see available options.`);
  }

  async handleCommands(args, message) {
    const allCommands = this.moduleManager.getAllCommands();
    const commandList = Object.entries(allCommands)
      .map(([name, cmd]) => `• \`.${name}\` - ${cmd.description}`)
      .join('\n');

    const commandsMessage = `🎯 **Available Commands (${Object.keys(allCommands).length})**\n\n${commandList}\n\n` +
      `Use \`.help <command>\` for detailed usage information.`;

    await this.sendReply(message, commandsMessage);
  }

  async handleModules(args, message) {
    const modules = this.moduleManager.modules;
    const moduleList = modules.map(module => {
      const commandCount = module.getCommands ? Object.keys(module.getCommands()).length : 0;
      return `• **${module.name || module.constructor.name}** - ${commandCount} commands`;
    }).join('\n');

    const modulesMessage = `🔌 **Loaded Modules (${modules.length})**\n\n${moduleList}\n\n` +
      `Use \`.help <module>\` for module-specific help.`;

    await this.sendReply(message, modulesMessage);
  }

  async showModuleHelp(module, message) {
    const moduleName = module.name || module.constructor.name;
    let helpMessage = `🔌 **Module: ${moduleName}**\n\n`;

    if (module.getCommands) {
      const commands = module.getCommands();
      const commandList = Object.entries(commands)
        .map(([name, cmd]) => `• \`.${name}\` - ${cmd.description}`)
        .join('\n');
      
      helpMessage += `**Commands (${Object.keys(commands).length}):**\n${commandList}`;
    } else {
      helpMessage += 'This module has no commands.';
    }

    await this.sendReply(message, helpMessage);
  }

  async sendReply(message, text) {
    try {
      // Get the Instagram bot instance from module manager
      const coreModule = this.moduleManager.getModule('CoreModule');
      if (coreModule && coreModule.instagramBot && coreModule.instagramBot.sendMessage) {
        await coreModule.instagramBot.sendMessage(message.threadId, text);
      } else {
        logger.info(`🤖 Help reply to @${message.senderUsername}: ${text}`);
      }
    } catch (error) {
      logger.error('Error sending help reply:', error);
    }
  }

  getCommands() {
    return this.commands;
  }

  async cleanup() {
    logger.info('🧹 Help module cleaned up');
  }
}
