// core/bridge/db.js
import { config } from '../config.js'; // Adjust path as needed
import { MongoClient } from 'mongodb';
// import { logger } from '../../utils/logger.js'; // Adjust path or use console

// Fallback logger if utils logger isn't available
const logger = {
  info: (...args) => console.log('[INFO] [DB]', ...args),
  error: (...args) => console.error('[ERROR] [DB]', ...args),
  debug: (...args) => console.log('[DEBUG] [DB]', ...args),
};

const MONGO_URI = config.mongo.uri;
const DB_NAME = config.mongo.dbName;

const client = new MongoClient(MONGO_URI);
let isConnected = false;
let dbInstance = null; // Cache the DB instance

/**
 * Connects to MongoDB and returns the database instance.
 * Ensures only one connection is established.
 * @returns {Promise<import('mongodb').Db>}
 */
async function connectDb() {
  try {
    // Check if already connected using the official way
    if (!client.topology || !client.topology.isConnected()) {
      if (!isConnected) { // Double-check our flag before logging/connecting
        logger.info('🔄 Connecting to MongoDB...');
        await client.connect();
        isConnected = true;
        dbInstance = client.db(DB_NAME); // Cache the DB instance
        logger.info('✅ MongoDB connected successfully');
      }
      // If isConnected was true but topology says not connected,
      // it might be an edge case, but let's trust the topology check
      // and reconnect if needed, resetting our flag.
      // The check above should cover the main cases.
    } else if (!dbInstance) {
         // If connected but dbInstance not cached (shouldn't happen usually)
         dbInstance = client.db(DB_NAME);
    }
    // Return the cached instance if already connected and cached
    return dbInstance;
  } catch (error) {
    isConnected = false; // Reset flag on error
    dbInstance = null;
    logger.error('❌ MongoDB connection failed:', error.message);
    // Consider re-throwing or handling based on your app's needs
    throw error;
  }
}

/**
 * Gets a specific collection from the database.
 * Ensures database connection first.
 * @param {string} collectionName - The name of the collection.
 * @returns {Promise<import('mongodb').Collection>}
 */
async function getCollection(collectionName) {
  const db = await connectDb();
  return db.collection(collectionName);
}

// Collections the bridge will use
const COLLECTIONS = {
  THREAD_MAPPINGS: 'thread_mappings', // IG Thread ID <-> TG Group ID
  USER_PROFILES: 'user_profiles',     // Cache user details?
  // Add more collection names as needed
};

export { connectDb, getCollection, COLLECTIONS };
