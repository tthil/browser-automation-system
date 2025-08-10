const { startClientService } = require('./client/index');
const { startWorkerService } = require('./worker/index');
const { DatabaseConnection } = require('../database/connection');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Check and setup database schema if needed
 */
async function ensureDatabaseSchema() {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  if (!isDevelopment) {
    return; // Skip auto-setup in production
  }
  
  console.log('🔍 Checking database schema...');
  
  const db = new DatabaseConnection();
  
  try {
    await db.initialize();
    
    // Check if sessions table exists
    const result = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'sessions'
      );
    `);
    
    const tablesExist = result.rows[0].exists;
    
    if (!tablesExist) {
      console.log('📋 Database tables not found - setting up schema...');
      
      // Read and execute schema
      const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      
      await db.transaction(async (client) => {
        await client.query(schemaSql);
      });
      
      console.log('✅ Database schema created successfully');
    } else {
      console.log('✅ Database schema already exists');
    }
    
  } catch (error) {
    console.warn('⚠️ Database schema check failed:', error.message);
    console.warn('⚠️ Continuing startup - you may need to run: npm run db:setup');
  } finally {
    if (db.pool) {
      await db.pool.end();
    }
  }
}

/**
 * Main Application Entry Point
 * Can start either Client Service, Worker Service, or both
 */

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || process.env.MODE || process.env.SERVICE_MODE || 'both';

  console.log('🚀 Starting Browser Automation System...');
  console.log(`📋 Mode: ${mode}`);

  try {
    // Ensure database schema exists (development only)
    await ensureDatabaseSchema();
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
