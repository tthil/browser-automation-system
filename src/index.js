const { startClientService } = require('./client/index');
const { startWorkerService } = require('./worker/index');
require('dotenv').config();

/**
 * Main Application Entry Point
 * Can start either Client Service, Worker Service, or both
 */

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || process.env.SERVICE_MODE || 'both';

  console.log('🚀 Starting Browser Automation System...');
  console.log(`📋 Mode: ${mode}`);

  try {
    switch (mode.toLowerCase()) {
      case 'client':
        console.log('🔧 Starting Client Service only...');
        await startClientService();
        break;
        
      case 'worker':
        console.log('🔧 Starting Worker Service only...');
        await startWorkerService();
        break;
        
      case 'both':
      default:
        console.log('🔧 Starting both Client and Worker Services...');
        
        // Start both services in parallel
        await Promise.all([
          startClientService(),
          startWorkerService()
        ]);
        
        console.log('✅ Both services started successfully');
        break;
    }
    
    console.log('🎉 Browser Automation System is running!');
    
  } catch (error) {
    console.error('❌ Failed to start Browser Automation System:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down...');
  process.exit(0);
});

// Start the application
if (require.main === module) {
  main();
}

module.exports = { main };
