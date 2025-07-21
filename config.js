export const config = {
  instagram: {
    username: process.env.INSTAGRAM_USERNAME,
    password: process.env.INSTAGRAM_PASSWORD,
    sessionPath: './session/instagram_session.json',
    messageCheckInterval: 5000, // Check for messages every 5 seconds
    maxRetries: 3
  },
  
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    forwardMessages: process.env.FORWARD_MESSAGES !== 'false',
    forwardMedia: process.env.FORWARD_MEDIA !== 'false'
  },
  
  plugins: {
    autoReply: {
      enabled: process.env.AUTO_REPLY_ENABLED === 'true',
      greetings: ['hello', 'hi', 'hey', 'good morning', 'good evening'],
      responses: [
        'Hello! Thanks for your message.',
        'Hi there! I\'ll get back to you soon.',
        'Hey! Thanks for reaching out.'
      ]
    },
    
    messageFilter: {
      enabled: process.env.MESSAGE_FILTER_ENABLED === 'true',
      blockedUsers: (process.env.BLOCKED_USERS || '').split(',').filter(Boolean),
      spamKeywords: ['spam', 'promotion', 'offer', 'deal', 'discount']
    },
    
    messageLogger: {
      enabled: process.env.MESSAGE_LOGGER_ENABLED !== 'false',
      logPath: './logs/messages.json',
      maxLogSize: 1000 // Maximum number of messages to keep
    }
  },
  
  app: {
    logLevel: process.env.LOG_LEVEL || 'info',
    environment: process.env.NODE_ENV || 'development'
  }
};