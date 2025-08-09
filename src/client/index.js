const { ClientService } = require('./client-service');
const { db } = require('../../database/connection');
const { rabbitmq } = require('../../messaging/rabbitmq-setup');
require('dotenv').config();

/**
 * Client Service Entry Point
 * Handles session processing and task distribution
 */

async function startClientService() {
  console.log('🚀 Starting Browser Automation Client Service...');
  
  try {
    // Initialize database connection
    console.log('📊 Initializing database connection...');
    await db.initialize();
    
    // Initialize RabbitMQ connection
    console.log('📨 Initializing RabbitMQ connection...');
    await rabbitmq.initialize();
    
    // Create and start client service
    const clientService = new ClientService(db, rabbitmq);
    await clientService.start();
    
    console.log('✅ Client Service started successfully');
    console.log(`📋 Listening for sessions on queue: ${process.env.SESSIONS_QUEUE || 'sessions'}`);
    
    // Graceful shutdown handling
    process.on('SIGINT', async () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      await clientService.stop();
      await db.close();
      await rabbitmq.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      await clientService.stop();
      await db.close();
      await rabbitmq.close();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start Client Service:', error);
    process.exit(1);
  }
}

// Start the service
if (require.main === module) {
  startClientService();
}

module.exports = { startClientService };
