import { logger } from '../core/utils.js';
import { config } from '../config.js';

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
    // This module only handles commands, no message processing
    return message;
  }

  async handleHelp(args, message) {
    const query = args[0]?.toLowerCase();
    
    if (!query) {
      const helpMessage = `🚀 **Hyper Insta Help**\n\n` +
        `Use \`.help <command>\` for specific help\n` +
        `Use \`.commands\` to see all commands\n` +
        `Use \`.modules\` to see all modules\n\n` +
        `**Quick Commands:**\n` +
        `• \`.ping\` - Check bot status\n` +
        `• \`.status\` - Show detailed status\n` +
        `• \`.help\` - Show this help\n\n` +
        `**Prefix:** \`${this.commandPrefix}\``;
      
      await this.sendReply(message, helpMessage);
      return;
    }

    // Get all commands dynamically
    const allCommands = this.getAllCommands();
    const command = allCommands.get(query);
    
    if (command) {
      const commandHelp = `🎯 **Command: ${query}**\n\n` +
        `📝 ${command.description}\n` +
        `💡 Usage: \`${command.usage}\`\n` +
        `🔧 Module: ${command.moduleName}` +
        (command.adminOnly ? '\n⚠️ Admin only' : '');
      
      await this.sendReply(message, commandHelp);
      return;
    }

    // Check if it's a module
    const module = this.moduleManager.getModule(query);
    if (module) {
      await this.showModuleHelp(module, message);
      return;
    }

    await this.sendReply(message, `❌ '${query}' not found. Use \`.help\` for options.`);
  }

  async handleCommands(args, message) {
    const allCommands = this.getAllCommands();
    const commandList = Array.from(allCommands.entries())
      .map(([name, cmd]) => `• \`.${name}\` - ${cmd.description}`)
      .join('\n');

    const commandsMessage = `🎯 **Commands (${allCommands.size})**\n\n${commandList}\n\n` +
      `Use \`.help <command>\` for details.`;

    await this.sendReply(message, commandsMessage);
  }

  async handleModules(args, message) {
    const modules = this.moduleManager.modules;
    const moduleList = modules.map(module => {
      const commandCount = module.getCommands ? Object.keys(module.getCommands()).length : 0;
      return `• **${module.name || module.constructor.name}** - ${commandCount} commands`;
    }).join('\n');

    const modulesMessage = `🔌 **Modules (${modules.length})**\n\n${moduleList}\n\n` +
      `Use \`.help <module>\` for module help.`;

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
      helpMessage += 'No commands available.';
    }

    await this.sendReply(message, helpMessage);
  }

  getAllCommands() {
    const allCommands = new Map();
    
    for (const module of this.moduleManager.modules) {
      if (module.getCommands) {
        const commands = module.getCommands();
        for (const [name, command] of Object.entries(commands)) {
          allCommands.set(name.toLowerCase(), {
            ...command,
            moduleName: module.name || module.constructor.name
          });
        }
      }
    }

    return allCommands;
  }

  async sendReply(message, text) {
    try {
      const coreModule = this.moduleManager.getModule('core');
      if (coreModule && coreModule.instagramBot) {
        return await coreModule.instagramBot.sendMessage(message.threadId, text);
      }
      return false;
    } catch (error) {
      logger.error('Error sending help reply:', error);
      return false;
    }
  }

  getCommands() {
    return this.commands;
  }

  async cleanup() {
    // Cleanup if needed
  }
}