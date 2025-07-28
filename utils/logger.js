import { config } from '../config.js';

class Logger {
  constructor() {
    this.logLevel = config.app.logLevel;
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };
  }

  shouldLog(level) {
    return this.levels[level] <= this.levels[this.logLevel];
  }

  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const emoji = this.getEmoji(level);
    return `[${timestamp}] ${emoji} ${level.toUpperCase()}: ${message}`;
  }

  getEmoji(level) {
    const emojis = {
      error: '❌',
      warn: '⚠️',
      info: 'ℹ️',
      debug: '🐛',
      trace: '🔍'
    };
    return emojis[level] || 'ℹ️';
  }

  error(message, ...args) {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), ...args);
    }
  }

  warn(message, ...args) {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message), ...args);
    }
  }

  info(message, ...args) {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message), ...args);
    }
  }

  debug(message, ...args) {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message), ...args);
    }
  }

  trace(message, ...args) {
    if (this.shouldLog('trace')) {
      console.log(this.formatMessage('trace', message), ...args);
    }
  }
}

export const logger = new Logger();