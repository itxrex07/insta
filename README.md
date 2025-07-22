# 🚀 Hyper Insta

**The most advanced, fast, and modular Instagram bot with Telegram integration**

## ⚡ Features

- **🔥 Ultra Fast** - Optimized for speed and responsiveness
- **📱 Instagram Integration** - Full message handling and sending
- **📨 Telegram Bridge** - Bidirectional message forwarding
- **🔌 Modular System** - Easy to extend with custom modules
- **💾 Smart Sessions** - MongoDB + file-based session management
- **🎯 Command System** - Lightning-fast command processing
- **🛡️ Admin Controls** - Secure admin-only commands
- **📊 Real-time Stats** - Live performance monitoring


## 🚀 Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure the bot** in `config.js`:
   ```javascript
   export const config = {
     instagram: {
       username: 'your_username',
       password: 'your_password'
     },
     telegram: {
       botToken: 'your_bot_token',
       chatId: 'your_chat_id',
       enabled: true
     },
     admin: {
       users: ['your_username']
     }
   };
   ```

3. **Add Instagram cookies** to `./session/cookies.json`

4. **Start the bot**
   ```bash
   npm start
   ```

## 🎯 Commands

### Core Commands
- `.ping` - Test bot responsiveness with actual ping time
- `.status` - Show bot operational status
- `.server` - Display server system information  
- `.logs [count]` - Show recent bot activity logs
- `.restart` - Restart the bot (admin only)

### Help Commands
- `.help` - Show general help
- `.help <command>` - Show specific command help
- `.help <module>` - Show module help
- `.commands` - List all available commands
- `.modules` - List all loaded modules

## 🔌 Creating Modules

Create a new module by extending `BaseModule`:

```javascript
import { BaseModule } from '../core/base-module.js';

export class MyModule extends BaseModule {
  constructor() {
    super();
    this.description = 'My custom module';
    this.setupCommands();
  }

  setupCommands() {
    this.registerCommand('mycommand', this.handleMyCommand, 'My command description', '.mycommand');
  }

  async handleMyCommand(args, message) {
    await this.sendReply(message, 'Hello from my module!');
  }

  async sendReply(message, text) {
    // Get core module to send messages
    const coreModule = this.moduleManager.getModule('core');
    return await coreModule.instagramBot.sendMessage(message.threadId, text);
  }
}
```

## 💾 Database Integration

All modules can access MongoDB:

```javascript
import { connectDb } from '../db/index.js';

export class MyModule extends BaseModule {
  async someMethod() {
    const db = await connectDb();
    const collection = db.collection('my_collection');
    // Use MongoDB operations
  }
}
```

## ⚙️ Configuration

### Instagram Settings
```javascript
instagram: {
  username: 'your_username',
  password: 'your_password',
  messageCheckInterval: 5000,
  useMongoSession: true
}
```

### Telegram Settings
```javascript
telegram: {
  botToken: 'your_bot_token',
  chatId: 'your_chat_id',
  enabled: true,
  forwardMessages: true,
  forwardMedia: true
}
```

### MongoDB Settings
```javascript
mongo: {
  uri: 'mongodb://localhost:27017',
  dbName: 'hyper_insta',
  options: {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }
}
```

## 🔥 Performance Features

- **⚡ Instant Commands** - Commands execute in milliseconds
- **🎯 Smart Caching** - Command registry cached for O(1) lookup
- **📊 Optimized Polling** - Reduced Instagram API calls
- **💾 Session Persistence** - MongoDB + file fallback
- **🔄 Auto Recovery** - Automatic session refresh on expiry

## 📨 Telegram Integration

- **📤 Auto Forward** - Instagram messages → Telegram
- **📥 Reply Back** - Reply in Telegram → Instagram
- **🖼️ Media Support** - Photos and videos
- **🔄 Bidirectional** - Full two-way communication

## 🛡️ Security

- **👑 Admin System** - Restricted admin commands
- **🔐 Session Security** - Encrypted session storage
- **🚫 Rate Limiting** - Built-in Instagram rate limiting
- **🛡️ Error Handling** - Graceful error recovery

## 📊 Monitoring

- **📈 Real-time Stats** - Live performance metrics
- **📝 Activity Logs** - Detailed bot activity logging
- **⏱️ Uptime Tracking** - Continuous uptime monitoring
- **💾 Memory Usage** - Resource usage tracking

## 🚀 Why Hyper Insta?

- **🔥 Blazing Fast** - Optimized for maximum performance
- **🔌 Modular** - Easy to extend and customize
- **🛡️ Reliable** - Built-in error handling and recovery
- **📱 Modern** - Latest Instagram API integration
- **🎯 Focused** - Clean, purpose-built architecture

## 📝 License

MIT License - Use responsibly and comply with Instagram's Terms of Service.

## ⚠️ Disclaimer

This bot is for educational purposes. Use at your own risk and ensure compliance with Instagram's Terms of Service.
