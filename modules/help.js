export class HelpModule {
  constructor(moduleManager) {
    this.moduleManager = moduleManager;
    this.name = 'help';
    this.description = 'Dynamic help system';
    this.commands = {};
    this.setupCommands();
  }

  setupCommands() {
    this.commands['help'] = {
      handler: this.handleHelp.bind(this),
      description: 'Show help for commands or modules',
      usage: '.help [command|module]',
      adminOnly: false
    };
  }

  getCommands() {
    return this.commands;
  }

  async process(message) {
    return message;
  }

  async handleHelp(args, message) {
    const query = args[0]?.toLowerCase();
    
    if (!query) {
      // Show all commands organized by module
      const allCommands = this.moduleManager.getAllCommands();
      const moduleGroups = {};
      
      // Group commands by module
      for (const [name, cmd] of allCommands) {
        const moduleName = cmd.moduleName;
        if (!moduleGroups[moduleName]) {
          moduleGroups[moduleName] = [];
        }
        moduleGroups[moduleName].push({ name, ...cmd });
      }

      let helpText = `🚀 **Hyper Insta Commands**\n\n`;
      
      for (const [moduleName, commands] of Object.entries(moduleGroups)) {
        helpText += `**${moduleName.toUpperCase()}:**\n`;
        for (const cmd of commands) {
          helpText += `• \`.${cmd.name}\` - ${cmd.description}\n`;
        }
        helpText += `\n`;
      }
      
      helpText += `💡 Use \`.help <command>\` for detailed help`;
      
      await this.sendReply(message, helpText);
      return;
    }

    // Check if it's a specific command
    const command = this.moduleManager.getCommand(query);
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
        `**Commands:**\n${commandList || 'No commands'}`;
      
      await this.sendReply(message, helpText);
      return;
    }

    await this.sendReply(message, `❌ '${query}' not found`);
  }

  async sendReply(message, text) {
    const coreModule = this.moduleManager.getModule('core');
    return await coreModule.instagramBot.sendMessage(message.threadId, text);
  }
}