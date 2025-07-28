# Hyper Insta - Professional Instagram Bot

A powerful, modular Instagram bot with Telegram bridge capabilities, advanced automation features, and enterprise-ready architecture.

## 🚀 Features

- **Instagram Integration**: Full Instagram Private API support with real-time messaging
- **Telegram Bridge**: Seamless message forwarding between Instagram and Telegram
- **Modular Architecture**: Easy to extend with custom modules
- **Auto-Follow System**: Intelligent follower management and auto-follow back
- **Message Automation**: Auto-accept message requests and follow requests
- **Professional Logging**: Comprehensive logging with multiple levels
- **Database Integration**: MongoDB for persistent data storage
- **Error Recovery**: Automatic reconnection and error handling
- **Admin Controls**: Secure admin-only commands and controls

## 📦 Installation

1. Clone the repository:
```bash
git clone https://github.com/your-username/hyper-insta.git
cd hyper-insta
```

2. Install dependencies:
```bash
npm install
```

3. Configure your settings in `config.js`:
```javascript
export const config = {
  instagram: {
    username: 'your_instagram_username',
    password: 'your_instagram_password', // Optional if using cookies
  },
  telegram: {
    botToken: 'your_telegram_bot_token',
    chatId: 'your_telegram_chat_id',
    enabled: true
  },
  mongo: {
    uri: 'your_mongodb_connection_string',
    dbName: 'hyper_insta'
  }
};
```

4. Start the bot:
```bash
npm start
```

## 🔧 Configuration

### Environment Variables

You can use environment variables instead of hardcoding values:

```bash
INSTAGRAM_USERNAME=your_username
INSTAGRAM_PASSWORD=your_password
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
MONGODB_URI=your_mongodb_uri
LOG_LEVEL=info
NODE_ENV=production
```

### Instagram Authentication

The bot supports multiple authentication methods:
1. **Session files** (recommended for production)
2. **Cookie files** (good for development)
3. **Username/Password** (fallback method)

## 📱 Commands

### Core Commands
- `.ping` - Test bot responsiveness
- `.status` - Show bot status and statistics
- `.server` - Display server information
- `.help` - Show all available commands

### Followers Management
- `.followers` - Show follower statistics
- `.following` - Show following list
- `.follow <username>` - Follow a user
- `.unfollow <username>` - Unfollow a user
- `.autofollow [on|off]` - Toggle auto follow back
- `.autorequests [on|off]` - Toggle auto accept requests
- `.automessage [on|off]` - Toggle auto message new followers
- `.requests` - Show pending follow requests
- `.msgrequests` - Show pending message requests

## 🔌 Modules

### Core Module
Provides essential bot functionality and system commands.

### Followers Module
Advanced follower management with automation features:
- Automatic follow back
- Auto-accept follow requests
- Auto-accept message requests
- Welcome messages for new followers
- Rate limiting and delays
- Comprehensive follower tracking

### Help Module
Dynamic help system that automatically generates help content based on loaded modules.

## 🌉 Telegram Bridge

The Telegram bridge provides seamless integration between Instagram and Telegram:

### Features
- **Bidirectional messaging**: Send and receive messages between platforms
- **Media support**: Photos, videos, documents, and stickers
- **Forum topics**: Automatic topic creation for organized chats
- **User mapping**: Intelligent user identification and mapping
- **Error handling**: Robust error recovery and reporting

### Setup
1. Create a Telegram bot via [@BotFather](https://t.me/botfather)
2. Get your bot token and chat ID
3. Configure in `config.js`
4. Enable forum mode for organized conversations (optional)

## 🗄️ Database

Uses MongoDB for persistent storage:
- Chat mappings between Instagram and Telegram
- Follower tracking and statistics
- Module-specific data storage
- Configuration persistence

## 🛡️ Security

- Admin-only commands with username verification
- Rate limiting for follow actions
- Secure session management
- Error logging without sensitive data exposure
- Environment variable support for credentials

## 📊 Monitoring

- Real-time status monitoring
- Comprehensive logging system
- Performance metrics
- Connection health checks
- Automatic error recovery

## 🚀 Deployment

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
CMD ["npm", "start"]
```

### Production Considerations
- Use environment variables for all sensitive data
- Enable MongoDB authentication
- Set up proper logging aggregation
- Configure process managers (PM2, systemd)
- Set up monitoring and alerting

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This bot is for educational and personal use only. Make sure to comply with Instagram's Terms of Service and use responsibly. The authors are not responsible for any misuse or violations.

## 🆘 Support

- Create an issue for bug reports
- Join our community discussions
- Check the documentation for common questions

## 🔄 Changelog

### Version 2.0.0
- Complete rewrite with professional architecture
- Added Telegram bridge functionality
- Implemented modular system
- Added followers automation module
- Enhanced error handling and logging
- Added MongoDB integration
- Improved security and admin controls