const { db } = require('./connection');
const fs = require('fs');
const path = require('path');

/**
 * Database Migration Runner
 * Handles running and rolling back database migrations
 */

class MigrationRunner {
  constructor() {
    this.migrationsPath = path.join(__dirname, 'migrations');
  }

  /**
   * Run all pending migrations
   */
  async runMigrations() {
    try {
      await db.initialize();
      
      // Create migrations table if it doesn't exist
      await this.createMigrationsTable();
      
      // Get list of migration files
      const migrationFiles = fs.readdirSync(this.migrationsPath)
        .filter(file => file.endsWith('.js'))
        .sort();
      
      console.log(`📋 Found ${migrationFiles.length} migration files`);
      
      // Check which migrations have already been run
      const completedMigrations = await this.getCompletedMigrations();
      
      for (const file of migrationFiles) {
        const migrationName = path.basename(file, '.js');
        
        if (completedMigrations.includes(migrationName)) {
          console.log(`⏭️  Skipping already completed migration: ${migrationName}`);
          continue;
        }
        
        console.log(`🚀 Running migration: ${migrationName}`);
        
        const migrationPath = path.join(this.migrationsPath, file);
        const migration = require(migrationPath);
        
        await db.transaction(async (client) => {
          // Run the migration
          await migration.up({ 
            raw: (sql) => client.query(sql),
            query: (sql, params) => client.query(sql, params)
          });
          
          // Record that this migration was completed
          await client.query(
            'INSERT INTO migrations (name, executed_at) VALUES ($1, NOW())',
            [migrationName]
          );
        });
        
        console.log(`✅ Completed migration: ${migrationName}`);
      }
      
      console.log('🎉 All migrations completed successfully');
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  /**
   * Rollback the last migration
   */
  async rollbackMigration() {
    try {
      await db.initialize();
      
      // Get the last completed migration
      const result = await db.query(
        'SELECT name FROM migrations ORDER BY executed_at DESC LIMIT 1'
      );
      
      if (result.rows.length === 0) {
        console.log('ℹ️  No migrations to rollback');
        return;
      }
      
      const migrationName = result.rows[0].name;
      console.log(`🔄 Rolling back migration: ${migrationName}`);
      
      const migrationPath = path.join(this.migrationsPath, `${migrationName}.js`);
      const migration = require(migrationPath);
      
      await db.transaction(async (client) => {
        // Run the rollback
        await migration.down({
          raw: (sql) => client.query(sql),
          query: (sql, params) => client.query(sql, params)
        });
        
        // Remove the migration record
        await client.query('DELETE FROM migrations WHERE name = $1', [migrationName]);
      });
      
      console.log(`✅ Rolled back migration: ${migrationName}`);
      
    } catch (error) {
      console.error('❌ Rollback failed:', error);
      throw error;
    }
  }

  /**
   * Create migrations tracking table
   */
  async createMigrationsTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
  }

  /**
   * Get list of completed migrations
   */
  async getCompletedMigrations() {
    const result = await db.query('SELECT name FROM migrations ORDER BY executed_at');
    return result.rows.map(row => row.name);
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const runner = new MigrationRunner();
  
  try {
    if (args.includes('--rollback')) {
      await runner.rollbackMigration();
    } else {
      await runner.runMigrations();
    }
  } catch (error) {
    console.error('❌ Migration runner failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { MigrationRunner };
