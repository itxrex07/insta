import { logger, fileUtils } from '../utils/utils.js';
import { config } from '../config.js';
import fs from 'fs';
import tough from 'tough-cookie';
import { connectDb } from '../utils/db.js';

export class SessionManager {
  constructor(ig) {
    this.ig = ig;
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

      // Try to load cookies from DB first, then from file
      const cookiesLoaded = await this.loadCookies();
      
      if (cookiesLoaded) {
        try {
          await this.ig.account.currentUser();
          logger.info('✅ Logged in using cookies');
          return true;
        } catch (err) {
          logger.warn('⚠️ Cookies are invalid, clearing...');
          await this.clearCookies();
          throw new Error('Invalid cookies - please upload new cookies');
        }
      } else {
        throw new Error('No cookies found - please upload cookies via Telegram bot');
      }

    } catch (error) {
      logger.error('❌ Failed to login:', error.message);
      throw error;
    }
  }

  async loadCookies() {
    try {
      // Try loading from DB first
      if (await this.loadCookiesFromDb()) {
        return true;
      }
      
      // Fallback to file
      if (await this.loadCookiesFromFile()) {
        // Save to DB for future use
        await this.saveCookiesToDb();
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Error loading cookies:', error.message);
      return false;
    }
  }

  async loadCookiesFromDb() {
    try {
      if (!this.db) {
        this.db = await connectDb();
      }
      
      const cookies = this.db.collection('cookies');
      const cookieDoc = await cookies.findOne({ username: config.instagram.username });
      
      if (cookieDoc && cookieDoc.cookieData) {
        await this.applyCookies(cookieDoc.cookieData);
        logger.info('✅ Loaded cookies from database');
        return true;
      }
    } catch (error) {
      logger.error('Error loading cookies from DB:', error.message);
    }
    return false;
  }

  async loadCookiesFromFile() {
    try {
      if (await fileUtils.pathExists(this.cookiesPath)) {
        const cookieData = JSON.parse(fs.readFileSync(this.cookiesPath, 'utf-8'));
        await this.applyCookies(cookieData);
        logger.info('✅ Loaded cookies from file');
        return true;
      }
    } catch (error) {
      logger.error('Error loading cookies from file:', error.message);
    }
    return false;
  }

  async applyCookies(cookieData) {
    for (const cookie of cookieData) {
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
  }

  async saveCookiesToDb() {
    try {
      if (!this.db) {
        this.db = await connectDb();
      }

      // Read cookies from file
      if (await fileUtils.pathExists(this.cookiesPath)) {
        const cookieData = JSON.parse(fs.readFileSync(this.cookiesPath, 'utf-8'));
        
        const cookies = this.db.collection('cookies');
        await cookies.replaceOne(
          { username: config.instagram.username },
          {
            username: config.instagram.username,
            cookieData: cookieData,
            updatedAt: new Date()
          },
          { upsert: true }
        );
        
        logger.info('✅ Cookies saved to database');
      }
    } catch (error) {
      logger.error('Error saving cookies to DB:', error.message);
    }
  }

  async uploadCookies(cookieData) {
    try {
      // Ensure session directory exists
      await fileUtils.ensureDir('./session');
      
      // Save to file
      fs.writeFileSync(this.cookiesPath, JSON.stringify(cookieData, null, 2));
      
      // Save to database
      await this.saveCookiesToDb();
      
      logger.info('✅ Cookies uploaded and saved');
      return true;
    } catch (error) {
      logger.error('Error uploading cookies:', error.message);
      return false;
    }
  }

  async clearCookies() {
    try {
      // Clear from database
      if (!this.db) {
        this.db = await connectDb();
      }
      const cookies = this.db.collection('cookies');
      await cookies.deleteOne({ username: config.instagram.username });
      
      // Clear from file
      if (await fileUtils.pathExists(this.cookiesPath)) {
        await fs.promises.unlink(this.cookiesPath);
      }
      
      logger.info('✅ Cookies cleared');
    } catch (error) {
      logger.error('Error clearing cookies:', error.message);
    }
  }

  async hasCookies() {
    try {
      // Check DB first
      if (!this.db) {
        this.db = await connectDb();
      }
      const cookies = this.db.collection('cookies');
      const cookieDoc = await cookies.findOne({ username: config.instagram.username });
      
      if (cookieDoc && cookieDoc.cookieData) {
        return true;
      }
      
      // Check file
      return await fileUtils.pathExists(this.cookiesPath);
    } catch (error) {
      return false;
    }
  }
}
