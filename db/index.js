import { config } from '../config.js';
import { MongoClient } from 'mongodb';
import { logger } from '../core/utils.js';

const MONGO_URI = config.mongo.uri;
const DB_NAME = config.mongo.dbName;
const OPTIONS = config.mongo.options;

const client = new MongoClient(MONGO_URI, OPTIONS);
let isConnected = false;

async function connectDb() {
  try {
    if (!client.topology?.isConnected()) {
      await client.connect();
      if (!isConnected) {
        logger.info('✅ MongoDB connected');
        isConnected = true;
      }
    }
    return client.db(DB_NAME);
  } catch (error) {
    logger.error('❌ MongoDB connection failed:', error.message);
    throw error;
  }
}

export { connectDb };