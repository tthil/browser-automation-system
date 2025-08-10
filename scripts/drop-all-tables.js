#!/usr/bin/env node

/**
 * Drop All Tables Script
 * Drops all tables in the database for testing auto-setup functionality
 */

require('dotenv').config();
const { DatabaseConnection } = require('../database/connection');

async function dropAllTables() {
  console.log('🗑️ Dropping all database tables...');
  
  const db = new DatabaseConnection();
  
  try {
    await db.initialize();
    
    // Get all table names
    const result = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      AND table_name != 'migrations'
      ORDER BY table_name
    `);
    
    if (result.rows.length === 0) {
      console.log('📋 No tables to drop');
      return;
    }
    
    console.log(`📋 Found ${result.rows.length} tables to drop:`);
    result.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
    // Drop all tables in a transaction
    await db.transaction(async (client) => {
      // Drop views first
      console.log('🔄 Dropping views...');
      await client.query('DROP VIEW IF EXISTS session_summary CASCADE');
      await client.query('DROP VIEW IF EXISTS task_performance CASCADE');
      
      // Drop tables with CASCADE to handle foreign keys
      console.log('🔄 Dropping tables...');
      for (const row of result.rows) {
        await client.query(`DROP TABLE IF EXISTS ${row.table_name} CASCADE`);
        console.log(`   ✓ Dropped ${row.table_name}`);
      }
      
      // Drop functions
      console.log('🔄 Dropping functions...');
      await client.query('DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE');
    });
    
    console.log('✅ All tables dropped successfully');
    console.log('');
    console.log('🧪 Now you can test: npm run dev');
    console.log('   It should automatically recreate all tables!');
    
  } catch (error) {
    console.error('❌ Failed to drop tables:', error.message);
    process.exit(1);
  } finally {
    if (db.pool) {
      await db.pool.end();
      console.log('🧹 Database connection pool closed');
    }
  }
}

dropAllTables().catch(console.error);
