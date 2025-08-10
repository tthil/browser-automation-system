const { Pool } = require('pg');
const path = require('path');

/**
 * PostgreSQL Connection Pool Configuration
 * Handles database connections with connection pooling and error handling
 */

class DatabaseConnection {
  constructor() {
    this.pool = null;
    this.isConnected = false;
  }

  /**
   * Initialize database connection pool
   */
  async initialize() {
    try {
      const isDevelopment = process.env.NODE_ENV !== 'production';
      
      const config = {
        user: process.env.DB_USER || 'automation_user',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'browser_automation',
        password: process.env.DB_PASSWORD || 'automation_password',
        port: parseInt(process.env.DB_PORT) || 5432,
        
        // Connection pool settings - more lenient for development
        max: parseInt(process.env.DB_POOL_MAX) || (isDevelopment ? 10 : 20),
        min: parseInt(process.env.DB_POOL_MIN) || (isDevelopment ? 2 : 5),
        idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || (isDevelopment ? 60000 : 30000),
        connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || (isDevelopment ? 30000 : 10000),
        
        // Query timeout - longer for development debugging
        query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT) || (isDevelopment ? 60000 : 30000),
        statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT) || (isDevelopment ? 60000 : 30000),
        
        // Keep alive settings for stable connections
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
        
        // SSL configuration for production
        ssl: process.env.NODE_ENV === 'production' ? {
          rejectUnauthorized: false
        } : false
      };

      this.pool = new Pool(config);

      // Test connection with retry logic
      await this.testConnectionWithRetry(3, 5000);

      this.isConnected = true;
      console.log('✅ Database connection pool initialized successfully');
      
      // Handle pool errors
      this.pool.on('error', (err) => {
        console.error('❌ Unexpected database pool error:', err);
        this.isConnected = false;
      });

      return this.pool;
    } catch (error) {
      console.error('❌ Failed to initialize database connection:', error);
      throw error;
    }
  }

  /**
   * Test database connection with retry logic
   */
  async testConnectionWithRetry(maxRetries = 3, delayMs = 5000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Testing database connection (attempt ${attempt}/${maxRetries})...`);
        
        const client = await this.pool.connect();
        await client.query('SELECT NOW()');
        client.release();
        
        console.log(`✅ Database connection test successful on attempt ${attempt}`);
        return;
      } catch (error) {
        console.error(`❌ Database connection test failed (attempt ${attempt}/${maxRetries}):`, error.message);
        
        if (attempt === maxRetries) {
          throw new Error(`Database connection failed after ${maxRetries} attempts: ${error.message}`);
        }
        
        console.log(`⏳ Waiting ${delayMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Get database connection pool
   */
  getPool() {
    if (!this.pool || !this.isConnected) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.pool;
  }

  /**
   * Execute a query with automatic connection handling and timeout protection
   */
  async query(text, params = []) {
    const start = Date.now();
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const queryTimeout = isDevelopment ? 60000 : 30000; // 60s for dev, 30s for prod
    
    try {
      const pool = this.getPool();
      
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Query timeout after ${queryTimeout}ms`));
        }, queryTimeout);
      });
      
      // Race between query and timeout
      const queryPromise = pool.query(text, params);
      const result = await Promise.race([queryPromise, timeoutPromise]);
      
      const duration = Date.now() - start;
      
      if (isDevelopment) {
        console.log(`🔍 Query executed in ${duration}ms:`, text.substring(0, 100));
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      console.error(`❌ Database query error after ${duration}ms:`, error.message);
      console.error('Query:', text.substring(0, 200));
      console.error('Params:', params);
      
      // For debugging, provide more context
      if (isDevelopment) {
        console.error('Full error details:', error);
      }
      
      throw error;
    }
  }

  /**
   * Execute a transaction
   */
  async transaction(callback) {
    const pool = this.getPool();
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const result = await this.query('SELECT NOW() as current_time, version() as version');
      return {
        status: 'healthy',
        timestamp: result.rows[0].current_time,
        version: result.rows[0].version,
        poolSize: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        waitingClients: this.pool.waitingCount
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * Close all connections
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      console.log('✅ Database connections closed');
    }
  }
}

// Export singleton instance
const dbConnection = new DatabaseConnection();

module.exports = {
  DatabaseConnection,
  db: dbConnection
};
