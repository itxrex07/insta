export const config = {
  instagram: {
    username: 'itxrey', // Your Instagram username
    password: 'your_instagram_password', // Your Instagram password
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
    uri: 'mongodb+srv://itxelijah07:ivp8FYGsbVfjQOkj@cluster0.wh25x.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
    dbName: 'hyper_insta',
  },
  
  modules: {

  },
  
  admin: {
    users: ['itxrey', 'iarshman'] // Admin usernames
  },
  
  app: {
    logLevel: 'info',
    environment: 'development'
  }
};
