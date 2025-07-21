import { logger } from '../utils.js';

export class HelpPlugin {
  constructor(pluginManager) {
    this.name = 'Help';
    this.pluginManager = pluginManager;
    this.commandPrefix = '!';
    this.commands = {
      'help': {
        description: 'Show available commands and plugins',
        usage: '!help [command|plugin]',
        handler: this.handleHelp.bind(this)
      },
      'commands': {
        description: 'List all available commands',
        usage: '!commands',
        handler: this.handleCommands.bind(this)
      },
      'plugins': {
        description: 'List all loaded plugins',
        usage: '!plugins',
        handler: this.handlePlugins.bind(this)
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
      logger.error('Error in Help plugin:', error);
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
      const helpMessage = `🤖 **Instagram UserBot Help**\n\n` +
        `Use \`!help <command>\` for specific command help\n` +
        `Use \`!commands\` to see all available commands\n` +
        `Use \`!plugins\` to see all loaded plugins\n\n` +
        `**Quick Commands:**\n` +
        `• \`!ping\` - Check bot status\n` +
        `• \`!status\` - Show detailed bot status\n` +
        `• \`!help\` - Show this help message\n\n` +
        `**Command Prefix:** \`${this.commandPrefix}\``;
      
      await this.sendReply(message, helpMessage);
      return;
    }

    // Check if it's a specific command
    const allCommands = this.getAllCommands();
    const command = allCommands[query];
    
    if (command) {
      const commandHelp = `🎯 **Command: ${query}**\n\n` +
        `📝 Description: ${command.description}\n` +
        `💡 Usage: \`${command.usage}\`\n` +
        `🔧 Plugin: ${command.plugin || 'Unknown'}` +
        (command.adminOnly ? '\n⚠️ Admin only command' : '');
      
      await this.sendReply(message, commandHelp);
      return;
    }

    // Check if it's a plugin
    const plugin = this.pluginManager.getPlugin(query);
    if (plugin) {
      await this.showPluginHelp(plugin, message);
      return;
    }

    await this.sendReply(message, `❌ Command or plugin '${query}' not found. Use \`!help\` to see available options.`);
  }

  async handleCommands(args, message) {
    const allCommands = this.getAllCommands();
    const commandList = Object.entries(allCommands)
      .map(([name, cmd]) => `• \`!${name}\` - ${cmd.description}`)
      .join('\n');

    const commandsMessage = `🎯 **Available Commands (${Object.keys(allCommands).length})**\n\n${commandList}\n\n` +
      `Use \`!help <command>\` for detailed usage information.`;

    await this.sendReply(message, commandsMessage);
  }

  async handlePlugins(args, message) {
    const plugins = this.pluginManager.plugins;
    const pluginList = plugins.map(plugin => {
      const commandCount = plugin.getCommands ? Object.keys(plugin.getCommands()).length : 0;
      return `• **${plugin.name || plugin.constructor.name}** - ${commandCount} commands`;
    }).join('\n');

    const pluginsMessage = `🔌 **Loaded Plugins (${plugins.length})**\n\n${pluginList}\n\n` +
      `Use \`!help <plugin>\` for plugin-specific help.`;

    await this.sendReply(message, pluginsMessage);
  }

  async showPluginHelp(plugin, message) {
    const pluginName = plugin.name || plugin.constructor.name;
    let helpMessage = `🔌 **Plugin: ${pluginName}**\n\n`;

    if (plugin.getCommands) {
      const commands = plugin.getCommands();
      const commandList = Object.entries(commands)
        .map(([name, cmd]) => `• \`!${name}\` - ${cmd.description}`)
        .join('\n');
      
      helpMessage += `**Commands (${Object.keys(commands).length}):**\n${commandList}`;
    } else {
      helpMessage += 'This plugin has no commands.';
    }

    await this.sendReply(message, helpMessage);
  }

  getAllCommands() {
    const allCommands = {};
    
    // Get commands from all plugins
    for (const plugin of this.pluginManager.plugins) {
      if (plugin.getCommands) {
        const commands = plugin.getCommands();
        for (const [name, command] of Object.entries(commands)) {
          allCommands[name] = {
            ...command,
            plugin: plugin.name || plugin.constructor.name
          };
        }
      }
    }

    return allCommands;
  }

  async sendReply(message, text) {
    try {
      // Get the Instagram bot instance from plugin manager
      const corePlugin = this.pluginManager.getPlugin('CorePlugin');
      if (corePlugin && corePlugin.instagramBot && corePlugin.instagramBot.sendMessage) {
        await corePlugin.instagramBot.sendMessage(message.threadId, text);
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
    logger.info('🧹 Help plugin cleaned up');
  }
}