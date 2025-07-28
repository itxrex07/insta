export const config = {
  instagram: {
    username: process.env.INSTAGRAM_USERNAME || 'ixnicx02',
    password: process.env.INSTAGRAM_PASSWORD || '',
    useMongoSession: true,
    sessionPath: './session.json',
    cookiesPath: './cookies.json'
  },
  
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '7580382614:AAH30PW6TFmgRzbC7HUXIHQ35GpndbJOIEI',
    chatId: process.env.TELEGRAM_CHAT_ID || '-1002287300661',
    adminUserId: process.env.TELEGRAM_ADMIN_ID || '7405203657',
    enabled: true,
    forumMode: true // Enable forum topics for organized chats
  },
  
  mongo: {
    uri: process.env.MONGODB_URI || 'mongodb+srv://itxelijah07:ivp8FYGsbVfjQOkj@cluster0.wh25x.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
    dbName: process.env.MONGODB_DB_NAME || 'hyper_insta',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    }
  },
  
  followers: {
    autoFollowBack: false,
    autoAcceptRequests: false,
    autoMessageNewFollowers: false,
    welcomeMessage: "Thanks for following! 🎉",
    checkInterval: 300000, // 5 minutes
    maxFollowsPerHour: 60,
    followDelay: { min: 30000, max: 120000 } // 30s to 2min delay
  },
  
  admin: {
    users: ['ixnickx02', 'iarshman'],
    allowedCommands: ['*'] // '*' means all commands
  },
  
  app: {
    logLevel: process.env.LOG_LEVEL || 'info',
    environment: process.env.NODE_ENV || 'development',
    maxRetries: 3,
    retryDelay: 5000
  }
};