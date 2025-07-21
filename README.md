# Hyper Insta

🚀 **Hyper Insta** - Advanced Instagram Bot with Telegram integration and modular system for automating Instagram message handling.

## 🚀 Features

- **Instagram Integration**: Login and monitor Instagram messages  
- **Bidirectional Telegram Bridge**: Forward messages and reply back from Telegram
- **Modular System**: Auto-loading extensible architecture with built-in modules
- **Session Management**: Persistent Instagram login sessions
- **Media Sync**: Download and forward photos/videos
- **Auto-Reply**: Respond to messages automatically
- **Message Filtering**: Block spam and unwanted messages
- **Message Logging**: Keep track of all messages
- **Command System**: Built-in commands with `.` prefix support
- **Core Commands**: ping, status, uptime, logs, info, stats, restart
- **Help System**: Comprehensive help and command listing
- **Admin Commands**: Restricted commands for bot administrators
- **User Statistics**: Track user activity and engagement
- **Clean UI**: Simplified message formatting with user display names

## 📁 Project Structure

```
hyper-insta/
├── index.js              # Main application entry point
├── config.js             # Configuration settings
├── utils.js              # Utility functions
├── core/
│   └── InstagramBot.js   # Instagram API wrapper
├── bridge/
│   └── TelegramBridge.js # Bidirectional Telegram integration
└── modules/
    ├── ModuleManager.js      # Auto-loading module system manager
    ├── CoreModule.js         # Core bot commands
    ├── HelpModule.js         # Help and command listing
    ├── AutoReplyModule.js    # Auto-reply functionality
    ├── MessageFilterModule.js # Message filtering
    ├── MessageLoggerModule.js # Message logging
    ├── TelegramModule.js     # Telegram control commands
    └── UserStatsModule.js    # User activity statistics
```

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd hyper-insta
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

## 🔌 Modules

The module system auto-loads all modules from the `modules/` directory:

### AutoReplyModule
- Automatically responds to greeting messages
- Configurable greetings and responses
- Prevents duplicate replies
- Commands: `.autoreply`

### MessageFilterModule
- Blocks messages from specific users
- Filters spam based on keywords
- Configurable block lists
- Commands: `.block`, `.unblock`, `.blocked`, `.filter`

### MessageLoggerModule
- Logs all messages to JSON file
- Searchable message history
- Configurable log size limits
- Commands: `.search`, `.recent`, `.logger`

### TelegramModule
- Control Telegram forwarding
- Send notifications to Telegram
- Commands: `.telegram`, `.notify`

### UserStatsModule
- Track user message statistics
- Show most active users
- Personal statistics
- Commands: `.userstats`, `.topusers`, `.mystats`

## 📱 Telegram Setup

1. Create a new bot with [@BotFather](https://t.me/botfather)
2. Get your bot token
3. Get your chat ID by messaging [@userinfobot](https://t.me/userinfobot)
4. Add both to your `.env` file
5. **Bidirectional Feature**: Reply to any forwarded message in Telegram to send it back to the original Instagram user!

## ⚙️ Configuration

All configuration is handled in `config.js` and can be overridden with environment variables:

- `INSTAGRAM_USERNAME` - Your Instagram username
- `INSTAGRAM_PASSWORD` - Your Instagram password
- `TELEGRAM_BOT_TOKEN` - Your Telegram bot token
- `TELEGRAM_CHAT_ID` - Your Telegram chat ID
- `AUTO_REPLY_ENABLED` - Enable/disable auto-reply (default: false)
- `MESSAGE_FILTER_ENABLED` - Enable/disable message filtering (default: true)
- `MESSAGE_LOGGER_ENABLED` - Enable/disable message logging (default: true)
- `ADMIN_USERS` - Comma-separated list of admin usernames

## 🎯 Commands (Prefix: `.`)

Hyper Insta supports commands with the `.` prefix. Here are the available commands:

### Core Commands
- `.ping` - Check if Hyper Insta is responsive
- `.status` - Show detailed bot status and system information
- `.uptime` - Show how long Hyper Insta has been running
- `.logs [count]` - Show recent bot logs (default: 10)
- `.info` - Show Hyper Insta information
- `.stats` - Show bot statistics
- `.restart` - Restart Hyper Insta (admin only)

### Help Commands
- `.help` - Show general help information
- `.help <command>` - Show specific command help
- `.commands` - List all available commands
- `.modules` - List all loaded modules

### Module Commands
- `.autoreply [on|off]` - Toggle auto-reply
- `.block <username>` - Block a user
- `.unblock <username>` - Unblock a user
- `.search <query>` - Search message logs
- `.telegram [on|off]` - Toggle Telegram forwarding
- `.userstats [username]` - Show user statistics
- `.mystats` - Show your statistics

### Usage Examples
```
.ping
.status
.logs 20
.help ping
.help CoreModule
.block spammer123
.search "hello"
.mystats
```

## 🔄 Bidirectional Bridge

Hyper Insta features a bidirectional Telegram bridge:
1. **Instagram → Telegram**: Messages are automatically forwarded with clean formatting
2. **Telegram → Instagram**: Reply to any forwarded message in Telegram to send it back to the original Instagram user
3. **Clean UI**: Messages show display name and username in a clean format

## 🚨 Important Notes

- **Use responsibly**: Comply with Instagram's Terms of Service  
- **Rate limiting**: The bot includes built-in delays to avoid rate limits
- **Session management**: Instagram sessions are saved locally for persistence
- **Security**: Never share your credentials or session files
- **Auto-loading**: Modules are automatically loaded from the `modules/` directory

## 📝 License

MIT License - see LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## ⚠️ Disclaimer

Hyper Insta is for educational purposes only. Use at your own risk and ensure compliance with Instagram's Terms of Service.