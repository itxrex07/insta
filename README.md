# Instagram UserBot

A powerful Instagram UserBot with Telegram integration and plugin system for automating Instagram message handling.

## 🚀 Features

- **Instagram Integration**: Login and monitor Instagram messages
- **Telegram Bridge**: Forward messages and media to Telegram
- **Plugin System**: Extensible architecture with built-in plugins
- **Session Management**: Persistent Instagram login sessions
- **Media Sync**: Download and forward photos/videos
- **Auto-Reply**: Respond to messages automatically
- **Message Filtering**: Block spam and unwanted messages
- **Message Logging**: Keep track of all messages

## 📁 Project Structure

```
instagram-userbot/
├── index.js              # Main application entry point
├── config.js             # Configuration settings
├── utils.js              # Utility functions
├── core/
│   └── InstagramBot.js   # Instagram API wrapper
├── bridge/
│   └── TelegramBridge.js # Telegram integration
└── plugins/
    ├── PluginManager.js      # Plugin system manager
    ├── AutoReplyPlugin.js    # Auto-reply functionality
    ├── MessageFilterPlugin.js # Message filtering
    └── MessageLoggerPlugin.js # Message logging
```

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd instagram-userbot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your credentials:
   ```env
   INSTAGRAM_USERNAME=your_instagram_username
   INSTAGRAM_PASSWORD=your_instagram_password
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   TELEGRAM_CHAT_ID=your_telegram_chat_id
   ```

4. **Start the bot**
   ```bash
   npm start
   ```

## 🔌 Plugins

### AutoReplyPlugin
- Automatically responds to greeting messages
- Configurable greetings and responses
- Prevents duplicate replies

### MessageFilterPlugin
- Blocks messages from specific users
- Filters spam based on keywords
- Configurable block lists

### MessageLoggerPlugin
- Logs all messages to JSON file
- Searchable message history
- Configurable log size limits

## 📱 Telegram Setup

1. Create a new bot with [@BotFather](https://t.me/botfather)
2. Get your bot token
3. Get your chat ID by messaging [@userinfobot](https://t.me/userinfobot)
4. Add both to your `.env` file

## ⚙️ Configuration

All configuration is handled in `config.js` and can be overridden with environment variables:

- `INSTAGRAM_USERNAME` - Your Instagram username
- `INSTAGRAM_PASSWORD` - Your Instagram password
- `TELEGRAM_BOT_TOKEN` - Your Telegram bot token
- `TELEGRAM_CHAT_ID` - Your Telegram chat ID
- `AUTO_REPLY_ENABLED` - Enable/disable auto-reply (default: false)
- `MESSAGE_FILTER_ENABLED` - Enable/disable message filtering (default: true)
- `MESSAGE_LOGGER_ENABLED` - Enable/disable message logging (default: true)

## 🚨 Important Notes

- **Use responsibly**: Comply with Instagram's Terms of Service
- **Rate limiting**: The bot includes built-in delays to avoid rate limits
- **Session management**: Instagram sessions are saved locally for persistence
- **Security**: Never share your credentials or session files

## 📝 License

MIT License - see LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## ⚠️ Disclaimer

This bot is for educational purposes only. Use at your own risk and ensure compliance with Instagram's Terms of Service.