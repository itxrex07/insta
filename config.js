export const config = {
  instagram: {
    username: 'itxrey', // Your Instagram username
    password: 'your_instagram_password', // Your Instagram password
    sessionPath: './session/session.json',
    messageCheckInterval: 10000, // Check for messages every 10 seconds (reduced to avoid rate limiting)
    maxRetries: 3,
    useMongoSession: true // Set to false to use file-based sessions
  },
  
  telegram: {
    botToken: '7580382614:AAH30PW6TFmgRzbC7HUXIHQ35GpndbJOIEI',
    chatId: '-1002710686896',
    enabled: true,
    forwardMessages: true,
    forwardMedia: true
  },
  
  mongo: {
    uri: 'mongodb://localhost:27017',
    dbName: 'hyper_insta',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true
    }
  },
  
  modules: {
    autoReply: {
      enabled: false,
      greetings: ['hello', 'hi', 'hey', 'good morning', 'good evening'],
      responses: [
        'Hello! Thanks for your message.',
        'Hi there! I\'ll get back to you soon.',
        'Hey! Thanks for reaching out.'
      ]
    },
    
    messageFilter: {
      enabled: true,
      blockedUsers: [],
      spamKeywords: ['spam', 'promotion', 'offer', 'deal', 'discount']
    },
    
    messageLogger: {
      enabled: true,
      logPath: './logs/messages.json',
      maxLogSize: 1000 // Maximum number of messages to keep
    }
  },
  
  admin: {
    users: ['itxrey', 'iarshman'] // Admin usernames
  },
  
  app: {
    logLevel: 'info',
    environment: 'development'
  }
};