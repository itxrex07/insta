import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { connectDb } from '../utils/db.js';

export class FollowersModule {
  constructor(instagramBot) {
    this.instagramBot = instagramBot;
    this.name = 'followers';
    this.description = 'Manage followers, auto-follow, and follow requests';
    
    this.db = null;
    this.collection = null;
    this.followersCache = new Map();
    this.followingCache = new Map();
    this.followQueue = [];
    this.isProcessingQueue = false;
    this.followCount = 0;
    this.followResetTime = Date.now() + 3600000; // Reset every hour
    
    this.commands = {};
    this.setupCommands();
    this.initializeDatabase();
    this.startMonitoring();
  }

  async initializeDatabase() {
    try {
      this.db = await connectDb();
      this.collection = this.db.collection('followers_data');
      await this.loadFollowersCache();
    } catch (error) {
      logger.error('Failed to initialize followers database:', error.message);
    }
  }

  async loadFollowersCache() {
    try {
      const followers = await this.instagramBot.getFollowers();
      const following = await this.instagramBot.getFollowing();
      
      followers.forEach(user => {
        this.followersCache.set(user.pk.toString(), {
          username: user.username,
          fullName: user.full_name,
          isPrivate: user.is_private,
          followedAt: new Date()
        });
      });

      following.forEach(user => {
        this.followingCache.set(user.pk.toString(), {
          username: user.username,
          fullName: user.full_name,
          followedAt: new Date()
        });
      });

      logger.info(`Loaded ${followers.length} followers and ${following.length} following`);
    } catch (error) {
      logger.error('Error loading followers cache:', error.message);
    }
  }

  setupCommands() {
    this.commands['followers'] = {
      handler: this.handleFollowersCommand.bind(this),
      description: 'Show followers statistics',
      usage: '.followers',
      adminOnly: false
    };

    this.commands['following'] = {
      handler: this.handleFollowingCommand.bind(this),
      description: 'Show following statistics',
      usage: '.following',
      adminOnly: false
    };

    this.commands['follow'] = {
      handler: this.handleFollowCommand.bind(this),
      description: 'Follow a user by username',
      usage: '.follow <username>',
      adminOnly: true
    };

    this.commands['unfollow'] = {
      handler: this.handleUnfollowCommand.bind(this),
      description: 'Unfollow a user by username',
      usage: '.unfollow <username>',
      adminOnly: true
    };

    this.commands['autofollow'] = {
      handler: this.handleAutoFollowCommand.bind(this),
      description: 'Toggle auto follow back',
      usage: '.autofollow [on|off]',
      adminOnly: true
    };

    this.commands['autorequests'] = {
      handler: this.handleAutoRequestsCommand.bind(this),
      description: 'Toggle auto accept follow requests',
      usage: '.autorequests [on|off]',
      adminOnly: true
    };

    this.commands['automessage'] = {
      handler: this.handleAutoMessageCommand.bind(this),
      description: 'Toggle auto message new followers',
      usage: '.automessage [on|off]',
      adminOnly: true
    };

    this.commands['requests'] = {
      handler: this.handleRequestsCommand.bind(this),
      description: 'Show pending follow requests',
      usage: '.requests',
      adminOnly: true
    };

    this.commands['msgrequests'] = {
      handler: this.handleMessageRequestsCommand.bind(this),
      description: 'Show pending message requests',
      usage: '.msgrequests',
      adminOnly: true
    };
  }

  getCommands() {
    return this.commands;
  }

  async process(message) {
    return message;
  }

  async handleFollowersCommand(args, message) {
    const followersCount = this.followersCache.size;
    const followingCount = this.followingCache.size;
    
    const stats = `👥 **Followers Statistics**\n\n` +
      `👤 Followers: ${followersCount}\n` +
      `➡️ Following: ${followingCount}\n` +
      `🔄 Auto Follow Back: ${config.followers.autoFollowBack ? 'ON' : 'OFF'}\n` +
      `✅ Auto Accept Requests: ${config.followers.autoAcceptRequests ? 'ON' : 'OFF'}\n` +
      `💬 Auto Message: ${config.followers.autoMessageNewFollowers ? 'ON' : 'OFF'}`;

    await this.sendReply(message, stats);
  }

  async handleFollowingCommand(args, message) {
    const following = Array.from(this.followingCache.values())
      .slice(0, 10)
      .map(user => `• @${user.username}`)
      .join('\n');

    const response = `➡️ **Following (${this.followingCache.size} total)**\n\n` +
      `${following || 'No one followed yet'}\n\n` +
      `${this.followingCache.size > 10 ? '...and more' : ''}`;

    await this.sendReply(message, response);
  }

  async handleFollowCommand(args, message) {
    if (!args[0]) {
      await this.sendReply(message, '❌ Please provide a username');
      return;
    }

    const username = args[0].replace('@', '');
    
    try {
      const user = await this.instagramBot.ig.user.searchExact(username);
      if (!user) {
        await this.sendReply(message, `❌ User @${username} not found`);
        return;
      }

      if (this.followingCache.has(user.pk.toString())) {
        await this.sendReply(message, `ℹ️ Already following @${username}`);
        return;
      }

      const success = await this.followUser(user.pk);
      if (success) {
        await this.sendReply(message, `✅ Successfully followed @${username}`);
      } else {
        await this.sendReply(message, `❌ Failed to follow @${username}`);
      }
    } catch (error) {
      await this.sendReply(message, `❌ Error: ${error.message}`);
    }
  }

  async handleUnfollowCommand(args, message) {
    if (!args[0]) {
      await this.sendReply(message, '❌ Please provide a username');
      return;
    }

    const username = args[0].replace('@', '');
    
    try {
      const user = await this.instagramBot.ig.user.searchExact(username);
      if (!user) {
        await this.sendReply(message, `❌ User @${username} not found`);
        return;
      }

      if (!this.followingCache.has(user.pk.toString())) {
        await this.sendReply(message, `ℹ️ Not following @${username}`);
        return;
      }

      const success = await this.instagramBot.unfollowUser(user.pk);
      if (success) {
        this.followingCache.delete(user.pk.toString());
        await this.sendReply(message, `✅ Successfully unfollowed @${username}`);
      } else {
        await this.sendReply(message, `❌ Failed to unfollow @${username}`);
      }
    } catch (error) {
      await this.sendReply(message, `❌ Error: ${error.message}`);
    }
  }

  async handleAutoFollowCommand(args, message) {
    const action = args[0]?.toLowerCase();
    
    if (action === 'on') {
      config.followers.autoFollowBack = true;
      await this.sendReply(message, '✅ Auto follow back enabled');
    } else if (action === 'off') {
      config.followers.autoFollowBack = false;
      await this.sendReply(message, '❌ Auto follow back disabled');
    } else {
      const status = config.followers.autoFollowBack ? 'ON' : 'OFF';
      await this.sendReply(message, `🔄 Auto follow back is currently: ${status}`);
    }
  }

  async handleAutoRequestsCommand(args, message) {
    const action = args[0]?.toLowerCase();
    
    if (action === 'on') {
      config.followers.autoAcceptRequests = true;
      await this.sendReply(message, '✅ Auto accept requests enabled');
    } else if (action === 'off') {
      config.followers.autoAcceptRequests = false;
      await this.sendReply(message, '❌ Auto accept requests disabled');
    } else {
      const status = config.followers.autoAcceptRequests ? 'ON' : 'OFF';
      await this.sendReply(message, `✅ Auto accept requests is currently: ${status}`);
    }
  }

  async handleAutoMessageCommand(args, message) {
    const action = args[0]?.toLowerCase();
    
    if (action === 'on') {
      config.followers.autoMessageNewFollowers = true;
      await this.sendReply(message, '✅ Auto message new followers enabled');
    } else if (action === 'off') {
      config.followers.autoMessageNewFollowers = false;
      await this.sendReply(message, '❌ Auto message new followers disabled');
    } else {
      const status = config.followers.autoMessageNewFollowers ? 'ON' : 'OFF';
      await this.sendReply(message, `💬 Auto message new followers is currently: ${status}`);
    }
  }

  async handleRequestsCommand(args, message) {
    try {
      const requests = await this.instagramBot.getPendingFollowRequests();
      
      if (requests.length === 0) {
        await this.sendReply(message, '📭 No pending follow requests');
        return;
      }

      const requestsList = requests.slice(0, 10)
        .map(user => `• @${user.username} (${user.full_name || 'No name'})`)
        .join('\n');

      const response = `📬 **Pending Follow Requests (${requests.length})**\n\n` +
        `${requestsList}\n\n` +
        `${requests.length > 10 ? '...and more\n\n' : ''}` +
        `Use .autorequests on to auto-accept`;

      await this.sendReply(message, response);
    } catch (error) {
      await this.sendReply(message, `❌ Error getting requests: ${error.message}`);
    }
  }

  async handleMessageRequestsCommand(args, message) {
    try {
      const requests = await this.instagramBot.getMessageRequests();
      
      if (requests.length === 0) {
        await this.sendReply(message, '📭 No pending message requests');
        return;
      }

      const requestsList = requests.slice(0, 10)
        .map(thread => {
          const user = thread.users?.[0];
          return `• @${user?.username || 'Unknown'} - "${thread.last_permanent_item?.text || 'Media message'}"`;
        })
        .join('\n');

      const response = `📬 **Pending Message Requests (${requests.length})**\n\n` +
        `${requestsList}\n\n` +
        `${requests.length > 10 ? '...and more' : ''}`;

      await this.sendReply(message, response);
    } catch (error) {
      await this.sendReply(message, `❌ Error getting message requests: ${error.message}`);
    }
  }

  async startMonitoring() {
    setInterval(async () => {
      await this.checkNewFollowers();
      await this.processFollowRequests();
      await this.processMessageRequests();
      await this.processFollowQueue();
    }, config.followers.checkInterval);

    logger.info('Followers monitoring started');
  }

  async checkNewFollowers() {
    try {
      const currentFollowers = await this.instagramBot.getFollowers();
      const newFollowers = [];

      for (const follower of currentFollowers) {
        const userId = follower.pk.toString();
        if (!this.followersCache.has(userId)) {
          newFollowers.push(follower);
          this.followersCache.set(userId, {
            username: follower.username,
            fullName: follower.full_name,
            isPrivate: follower.is_private,
            followedAt: new Date()
          });
        }
      }

      for (const newFollower of newFollowers) {
        await this.handleNewFollower(newFollower);
      }

    } catch (error) {
      logger.error('Error checking new followers:', error.message);
    }
  }

  async handleNewFollower(follower) {
    logger.info(`New follower detected: @${follower.username}`);

    // Auto follow back
    if (config.followers.autoFollowBack && !this.followingCache.has(follower.pk.toString())) {
      await this.queueFollow(follower.pk, follower.username);
    }

    // Auto message new follower
    if (config.followers.autoMessageNewFollowers) {
      try {
        const thread = await this.instagramBot.ig.entity.directThread([follower.pk.toString()]);
        await this.instagramBot.sendMessage(thread.thread_id, config.followers.welcomeMessage);
        logger.info(`Sent welcome message to @${follower.username}`);
      } catch (error) {
        logger.error(`Failed to send welcome message to @${follower.username}:`, error.message);
      }
    }

    // Save to database
    if (this.collection) {
      try {
        await this.collection.insertOne({
          type: 'new_follower',
          userId: follower.pk.toString(),
          username: follower.username,
          fullName: follower.full_name,
          timestamp: new Date()
        });
      } catch (error) {
        logger.error('Error saving new follower to database:', error.message);
      }
    }
  }

  async processFollowRequests() {
    if (!config.followers.autoAcceptRequests) return;

    try {
      const requests = await this.instagramBot.getPendingFollowRequests();
      
      for (const request of requests) {
        const success = await this.instagramBot.approveFollowRequest(request.pk);
        if (success) {
          logger.info(`Auto-approved follow request from @${request.username}`);
        }
        
        // Small delay to avoid rate limiting
        await this.delay(2000);
      }
    } catch (error) {
      logger.error('Error processing follow requests:', error.message);
    }
  }

  async processMessageRequests() {
    try {
      const requests = await this.instagramBot.getMessageRequests();
      
      for (const request of requests) {
        const success = await this.instagramBot.approveMessageRequest(request.thread_id);
        if (success) {
          const user = request.users?.[0];
          logger.info(`Auto-approved message request from @${user?.username || 'Unknown'}`);
        }
        
        // Small delay to avoid rate limiting
        await this.delay(2000);
      }
    } catch (error) {
      logger.error('Error processing message requests:', error.message);
    }
  }

  async queueFollow(userId, username) {
    this.followQueue.push({ userId, username, timestamp: Date.now() });
    logger.debug(`Queued follow for @${username}`);
  }

  async processFollowQueue() {
    if (this.isProcessingQueue || this.followQueue.length === 0) return;
    
    // Reset follow count every hour
    if (Date.now() > this.followResetTime) {
      this.followCount = 0;
      this.followResetTime = Date.now() + 3600000;
    }

    // Check rate limit
    if (this.followCount >= config.followers.maxFollowsPerHour) {
      logger.debug('Follow rate limit reached, waiting...');
      return;
    }

    this.isProcessingQueue = true;

    try {
      const followItem = this.followQueue.shift();
      if (followItem) {
        const success = await this.followUser(followItem.userId);
        if (success) {
          this.followCount++;
          logger.info(`Auto-followed @${followItem.username} (${this.followCount}/${config.followers.maxFollowsPerHour})`);
        }

        // Random delay between follows
        const delay = Math.random() * (config.followers.followDelay.max - config.followers.followDelay.min) + config.followers.followDelay.min;
        await this.delay(delay);
      }
    } catch (error) {
      logger.error('Error processing follow queue:', error.message);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  async followUser(userId) {
    try {
      const success = await this.instagramBot.followUser(userId);
      if (success) {
        // Add to following cache
        const user = await this.instagramBot.ig.user.info(userId);
        this.followingCache.set(userId.toString(), {
          username: user.username,
          fullName: user.full_name,
          followedAt: new Date()
        });
      }
      return success;
    } catch (error) {
      logger.error(`Error following user ${userId}:`, error.message);
      return false;
    }
  }

  async sendReply(message, text) {
    return await this.instagramBot.sendMessage(message.threadId, text);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup() {
    logger.info('Cleaning up followers module...');
    this.followQueue = [];
    this.followersCache.clear();
    this.followingCache.clear();
  }
}