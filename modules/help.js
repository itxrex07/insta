import { BaseModule } from '../core/base-module.js';

export class HelpModule extends BaseModule {
  constructor(moduleManager) {
    super();
    this.moduleManager = moduleManager;
    this.description = 'Dynamic help system for all commands and modules';
    this.setupCommands();
  }

  setupCommands() {
    this.registerCommand('help', this.handleHelp, 'Show help for commands or modules', '.help [command|module]');
    this.registerCommand('commands', this.handleCommands, 'List all available commands', '.commands');
    this.registerCommand('modules', this.handleModules, 'List all loaded modules', '.modules');
  }

  async handleHelp(args, message) {
    const query = args[0]?.toLowerCase();
    
    if (!query) {
      const helpText = `🚀 **Hyper Insta Help**\n\n` +
        `**Quick Commands:**\n` +
        `• \`.ping\` - Test responsiveness\n` +
        `• \`.status\` - Bot status\n` +
        `• \`.help <command>\` - Command help\n` +
        `• \`.commands\` - All commands\n` +
        `• \`.modules\` - All modules\n\n` +
        `**Usage:** \`.help <command>\` or \`.help <module>\``;
      
      await this.sendReply(message, helpText);
      return;
    }

    // Check if it's a command
    const allCommands = this.getAllCommands();
    const command = allCommands.get(query);
    
    if (command) {
      const helpText = `🎯 **${query}**\n\n` +
        `📝 ${command.description}\n` +
        `💡 Usage: \`${command.usage}\`\n` +
        `🔧 Module: ${command.moduleName}` +
        (command.adminOnly ? '\n⚠️ Admin only' : '');
      
      await this.sendReply(message, helpText);
      return;
    }

    // Check if it's a module
    const module = this.moduleManager.getModule(query);
    if (module) {
      const commands = module.getCommands();
      const commandList = Object.entries(commands)
        .map(([name, cmd]) => `• \`.${name}\` - ${cmd.description}`)
        .join('\n');
      
      const helpText = `🔌 **${module.name} Module**\n\n` +
        `📝 ${module.description}\n\n` +
        `**Commands (${Object.keys(commands).length}):**\n${commandList || 'No commands'}`;
      
      await this.sendReply(message, helpText);
      return;
    }

    await this.sendReply(message, `❌ '${query}' not found`);
  }

  async handleCommands(args, message) {
    const allCommands = this.getAllCommands();
    const commandList = Array.from(allCommands.entries())
      .map(([name, cmd]) => `• \`.${name}\` - ${cmd.description}`)
      .join('\n');

    const helpText = `🎯 **All Commands (${allCommands.size})**\n\n${commandList}`;
    await this.sendReply(message, helpText);
  }

  async handleModules(args, message) {
    const modules = this.moduleManager.modules;
    const moduleList = modules.map(module => {
      const cmdCount = Object.keys(module.getCommands()).length;
      return `• **${module.name}** - ${cmdCount} commands`;
    }).join('\n');

    const helpText = `🔌 **Loaded Modules (${modules.length})**\n\n${moduleList}`;
    await this.sendReply(message, helpText);
  }

  getAllCommands() {
    const allCommands = new Map();
    
    for (const module of this.moduleManager.modules) {
      const commands = module.getCommands();
      for (const [name, command] of Object.entries(commands)) {
        allCommands.set(name.toLowerCase(), {
          ...command,
          moduleName: module.name
        });
      }
    }

    return allCommands;
  }

  async sendReply(message, text) {
    const coreModule = this.moduleManager.getModule('core');
    return await coreModule.instagramBot.sendMessage(message.threadId, text);
  }
}