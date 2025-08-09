const fs = require('fs');
const path = require('path');

/**
 * Migration: Initial Database Schema
 * Creates all tables, indexes, and initial data for Browser Automation System
 */

exports.up = async function(knex) {
  // Read and execute the schema SQL file
  const schemaPath = path.join(__dirname, '..', 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  
  // Split by semicolon and execute each statement
  const statements = schemaSql
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
  
  for (const statement of statements) {
    if (statement.trim()) {
      await knex.raw(statement);
    }
  }
  
  console.log('✅ Initial schema migration completed successfully');
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
