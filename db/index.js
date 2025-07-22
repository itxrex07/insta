@@ .. @@
 async function connectDb() {
   try {
     if (!client.topology?.isConnected()) {
       await client.connect();
+      logger.info('✅ MongoDB connected');
     }
     return client.db(DB_NAME);
   } catch (error) {