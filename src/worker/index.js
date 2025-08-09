const { WorkerService } = require('./worker-service');
const { rabbitmq } = require('../../messaging/rabbitmq-setup');
require('dotenv').config();

/**
 * Worker Service Entry Point
 * Handles browser automation task execution
 */

async function startWorkerService() {
  console.log('🚀 Starting Browser Automation Worker Service...');
  
  try {
    // Initialize RabbitMQ connection
    console.log('📨 Initializing RabbitMQ connection...');
    await rabbitmq.initialize();
    
    // Create and start worker service
    const workerService = new WorkerService(rabbitmq);
    await workerService.start();
    
    console.log('✅ Worker Service started successfully');
    console.log(`🔧 Listening for tasks on queue: ${process.env.TASKS_QUEUE || 'tasks'}`);
    console.log(`🌐 VNC enabled: ${process.env.ENABLE_VNC || 'false'}`);
    console.log(`🐛 Debug mode: ${process.env.DEBUG_MODE || 'false'}`);
    
    // Graceful shutdown handling
    process.on('SIGINT', async () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      await workerService.stop();
      await rabbitmq.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      await workerService.stop();
      await rabbitmq.close();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start Worker Service:', error);
    process.exit(1);
  }
}

// Start the service
if (require.main === module) {
  startWorkerService();
}

module.exports = { startWorkerService };
