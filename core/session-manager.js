import { logger, fileUtils } from './utils.js';
import { config } from '../config.js';
import fs from 'fs';
import tough from 'tough-cookie';
import { connectDb } from '../db/index.js';

export class SessionManager {
  constructor(ig) {
    this.ig = ig;
    this.sessionPath = './session/session.json';
    this.cookiesPath = './session/cookies.json';
    this.db = null;
  }

  async login() {
    try {
      const username = config.instagram.username;
      if (!username) {
        throw new Error('Instagram username is missing from config');
      }

      this.ig.state.generateDevice(username);

      // Try to load session first
      const sessionLoaded = await this.loadSession();
      
      if (sessionLoaded) {
        try {
          await this.ig.account.currentUser();
          logger.info('✅ Logged in using saved session');
          return true;
        } catch (err) {
          logger.warn('⚠️ Saved session is invalid, clearing...');
          await this.clearSession();
        }
      }

      // Try cookie login
      await this.loadCookiesFromJson();

      try {
        await this.ig.account.currentUser();
        logger.info('✅ Logged in using cookies');
        await this.saveSession();
        return true;
      } catch (err) {
        logger.error('❌ Cookie login failed:', err.message);
        throw new Error('Please provide valid Instagram credentials or session');
      }

    } catch (error) {
      logger.error('❌ Failed to login:', error.message);
      throw error;
    }
  }

  async loadSession() {
    try {
      if (config.instagram.useMongoSession) {
        return await this.loadSessionFromMongo();
      } else {
        return await this.loadSessionFromFile();
      }
    } catch (error) {
      return false;
    }
  }

  async loadSessionFromFile() {
    try {
      if (await fileUtils.pathExists(this.sessionPath)) {
        const sessionData = await fileUtils.readJson(this.sessionPath);
        if (sessionData && sessionData.cookies) {
          await this.ig.state.deserialize(sessionData);
          return true;
        }
      }
    } catch (error) {
      // Silent fail
    }
    return false;
  }

  async loadSessionFromMongo() {
    try {
      if (!this.db) {
        this.db = await connectDb();
      }
      
      const sessions = this.db.collection('sessions');
      const sessionDoc = await sessions.findOne({ username: config.instagram.username });
      
      if (sessionDoc && sessionDoc.sessionData) {
        await this.ig.state.deserialize(sessionDoc.sessionData);
        return true;
      }
    } catch (error) {
      // Silent fail
    }
    return false;
  }

  async saveSession() {
    try {
      const serialized = await this.ig.state.serialize();
      delete serialized.constants;
      
      if (config.instagram.useMongoSession) {
        await this.saveSessionToMongo(serialized);
      } else {
        await this.saveSessionToFile(serialized);
      }
    } catch (error) {
      // Silent fail
    }
  }

  async saveSessionToFile(sessionData) {
    await fileUtils.ensureDir('./session');
    await fileUtils.writeJson(this.sessionPath, sessionData);
  }

  async saveSessionToMongo(sessionData) {
    try {
      if (!this.db) {
        this.db = await connectDb();
      }
      
      const sessions = this.db.collection('sessions');
      await sessions.replaceOne(
        { username: config.instagram.username },
        {
          username: config.instagram.username,
          sessionData: sessionData,
          updatedAt: new Date()
        },
        { upsert: true }
      );
    } catch (error) {
      // Silent fail
    }
  }

  async clearSession() {
    try {
      if (config.instagram.useMongoSession) {
        if (!this.db) {
          this.db = await connectDb();
        }
        const sessions = this.db.collection('sessions');
        await sessions.deleteOne({ username: config.instagram.username });
      } else {
        if (await fileUtils.pathExists(this.sessionPath)) {
          await fs.promises.unlink(this.sessionPath);
        }
      }
    } catch (error) {
      // Silent fail
    }
  }

  async loadCookiesFromJson() {
    try {
      const raw = fs.readFileSync(this.cookiesPath, 'utf-8');
      const cookies = JSON.parse(raw);

      for (const cookie of cookies) {
        const toughCookie = new tough.Cookie({
          key: cookie.name,
          value: cookie.value,
          domain: cookie.domain.replace(/^\./, ''),
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
        });

        await this.ig.state.cookieJar.setCookie(
          toughCookie.toString(),
          `https://${cookie.domain}${cookie.path}`
        );
      }
    } catch (error) {
      throw error;
    }
  }
}