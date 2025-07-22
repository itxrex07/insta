import { BaseModule } from '../core/base-module.js';
import { logger } from '../core/utils.js';
import { config } from '../config.js';
import os from 'os';

export class CoreModule extends BaseModule {
  constructor(instagramBot) {
    super();
    this.instagramBot = instagramBot;
    this.startTime = new Date();
    this.description = 'Core bot commands and system information';
    this.messageCount = 0;
    this.commandCount = 0;
    this.logBuffer = [];
    this.maxLogBuffer = 50;
    
    this.setupCommands();
  }

  setupCommands() {
    this.registerCommand('ping', this.handlePing, 'Test bot responsiveness with actual ping', '.ping');
    this.registerCommand('status', this.handleStatus, 'Show bot operational status', '.status');
    this.registerCommand('server', this.handleServer, 'Show server system information', '.server');
    this.registerCommand('logs', this.handleLogs, 'Show recent bot activity logs', '.logs [count]');
    this.registerCommand('restart', this.handleRestart, 'Restart the bot', '.restart', true);
  }

  async process(message) {
    this.messageCount++;
    this.addToLogBuffer(`[${new Date().toISOString().split('T')[1].split('.')[0]}] @${message.senderUsername}: ${message.text || '[Media]'}`);
    return message;
  }

  async handlePing(args, message) {
    const start = Date.now();
    const sent = await this.sendReply(message, '🏓 Pinging...');
    if (sent) {
      const ping = Date.now() - start;
      await this.sendReply(message, `🏓 Pong! ${ping}ms`);
    }
  }

  async handleStatus(args, message) {
    const uptime = this.getUptime();
    const memUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    
    const status = `🚀 **Hyper Insta Status**\n\n` +
      `✅ Status: Online & Active\n` +
      `⏱️ Uptime: ${uptime}\n` +
      `📊 Messages: ${this.messageCount}\n` +
      `🎯 Commands: ${this.commandCount}\n` +
      `💾 Memory: ${memUsage}MB`;

    await this.sendReply(message, status);
  }

  async handleServer(args, message) {
    const serverInfo = `🖥️ **Server Information**\n\n` +
      `🔧 Platform: ${os.platform()} ${os.arch()}\n` +
      `🟢 Node.js: ${process.version}\n` +
      `💻 CPU Cores: ${os.cpus().length}\n` +
      `🧠 Total RAM: ${Math.round(os.totalmem() / 1024 / 1024)}MB\n` +
      `🆓 Free RAM: ${Math.round(os.freemem() / 1024 / 1024)}MB\n` +
      `📈 Load Avg: ${os.loadavg().map(l => l.toFixed(2)).join(', ')}`;

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