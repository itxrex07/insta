export class CoreModule {
  constructor(instagramBot) {
    this.instagramBot = instagramBot;
    this.name = 'core';
    this.description = 'Core bot commands and system information';
    this.startTime = new Date();
    this.messageCount = 0;
    this.commandCount = 0;
    this.logBuffer = [];
    this.maxLogBuffer = 50;
    this.commands = {};
    this.setupCommands();
  }

  setupCommands() {
    this.commands['ping'] = {
      handler: this.handlePing.bind(this),
      description: 'Test bot responsiveness with actual ping',
      usage: '.ping',
      adminOnly: false
    };

    this.commands['status'] = {
      handler: this.handleStatus.bind(this),
      description: 'Show bot operational status',
      usage: '.status',
      adminOnly: false
    };

    this.commands['server'] = {
      handler: this.handleServer.bind(this),
      description: 'Show server system information',
      usage: '.server',
      adminOnly: false
    };

    this.commands['logs'] = {
      handler: this.handleLogs.bind(this),
      description: 'Show recent bot activity logs',
      usage: '.logs [count]',
      adminOnly: true
    };

    this.commands['restart'] = {
      handler: this.handleRestart.bind(this),
      description: 'Restart the bot',
      usage: '.restart',
      adminOnly: true
    };
  }

  getCommands() {
    return this.commands;
  }

  async process(message) {
    this.messageCount++;
    this.addToLogBuffer(`[${new Date().toISOString().split('T')[1].split('.')[0]}] @${message.senderUsername}: ${message.text || '[Media]'}`);
    return message;
  }

  async handlePing(args, message) {
    const start = Date.now();
    await this.sendReply(message, '🏓 Pong!');
    const ping = Date.now() - start;
    await this.sendReply(message, `⚡ Response time: ${ping}ms`);
  }

  async handleStatus(args, message) {
    const uptime = this.getUptime();
    const memUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    
    const status = `🚀 **Bot Status**\n\n` +
      `✅ Status: Online\n` +
      `⏱️ Uptime: ${uptime}\n` +
      `📊 Messages: ${this.messageCount}\n` +
      `🎯 Commands: ${this.commandCount}\n` +
      `💾 Memory: ${memUsage}MB`;

    await this.sendReply(message, status);
  }

  async handleServer(args, message) {
    const os = await import('os');
    const serverInfo = `🖥️ **Server Info**\n\n` +
      `🔧 Platform: ${os.platform()} ${os.arch()}\n` +
      `🟢 Node.js: ${process.version}\n` +
      `💻 CPU Cores: ${os.cpus().length}\n` +
      `🧠 Total RAM: ${Math.round(os.totalmem() / 1024 / 1024)}MB\n` +
      `🆓 Free RAM: ${Math.round(os.freemem() / 1024 / 1024)}MB`;

    await this.sendReply(message, serverInfo);
  }

  async handleLogs(args, message) {
    const count = Math.min(parseInt(args[0]) || 10, this.maxLogBuffer);
    const logs = this.logBuffer.slice(-count);
    
    if (logs.length === 0) {
      await this.sendReply(message, '📝 No logs available');
      return;
    }

    const logsMessage = `📝 **Recent Logs (${logs.length})**\n\n${logs.join('\n')}`;
    await this.sendReply(message, logsMessage);
  }

  async handleRestart(args, message) {
    await this.sendReply(message, '🔄 Restarting...');
    setTimeout(() => process.exit(0), 1000);
  }

  async sendReply(message, text) {
    this.commandCount++;
    return await this.instagramBot.sendMessage(message.threadId, text);
  }

  getUptime() {
    const ms = Date.now() - this.startTime.getTime();
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  addToLogBuffer(entry) {
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxLogBuffer) {
      this.logBuffer.shift();
    }
  }
}