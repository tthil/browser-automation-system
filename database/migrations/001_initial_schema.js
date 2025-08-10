const fs = require('fs');
const path = require('path');

/**
 * Migration: Initial Database Schema
 * Creates all tables, indexes, and initial data for Browser Automation System
 */

exports.up = async function(client) {
  // Check if tables already exist
  try {
    const result = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'sessions'
      );
    `);
    
    const tablesExist = result.rows[0].exists;
    
    if (tablesExist) {
      console.log('✅ Database schema already exists - skipping migration');
      return;
    }
  } catch (error) {
    console.log('🔄 Unable to check existing tables, proceeding with migration...');
  }
  
  // Read and execute the schema SQL file
  const schemaPath = path.join(__dirname, '..', 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  
  // Execute the entire schema as one statement to handle functions properly
  console.log('🔄 Executing complete database schema via migration...');
  
  try {
    await client.query(schemaSql);
    console.log('✅ Initial schema migration completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
};

exports.down = async function(knex) {
  // Drop all tables in reverse order of dependencies
  await knex.raw('DROP VIEW IF EXISTS task_performance CASCADE');
  await knex.raw('DROP VIEW IF EXISTS session_summary CASCADE');
  
  await knex.raw('DROP TABLE IF EXISTS proxy_usage CASCADE');
  await knex.raw('DROP TABLE IF EXISTS rate_management CASCADE');
  await knex.raw('DROP TABLE IF EXISTS statistics CASCADE');
  await knex.raw('DROP TABLE IF EXISTS task_responses CASCADE');
  await knex.raw('DROP TABLE IF EXISTS tasks CASCADE');
  await knex.raw('DROP TABLE IF EXISTS sessions CASCADE');
  
  await knex.raw('DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE');
  await knex.raw('DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE');
  
  console.log('✅ Schema rollback completed');
};
