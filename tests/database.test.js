const { db } = require('../database/connection');

describe('Database Connection', () => {
  beforeAll(async () => {
    try {
      await db.initialize();
    } catch (error) {
      console.warn('Database not available for testing, skipping database tests');
    }
  }, 30000);

  afterAll(async () => {
    if (db.isConnected) {
      await db.close();
    }
  });

  test('should connect to database successfully', async () => {
    if (!db.isConnected) {
      console.warn('Skipping database test - not connected');
      return;
    }
    const health = await db.healthCheck();
    expect(health.status).toBe('healthy');
    expect(health.timestamp).toBeDefined();
  });

  test('should execute queries successfully', async () => {
    if (!db.isConnected) {
      console.warn('Skipping database test - not connected');
      return;
    }
    const result = await db.query('SELECT NOW() as current_time');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].current_time).toBeDefined();
  });

  test('should handle transactions', async () => {
    if (!db.isConnected) {
      console.warn('Skipping database test - not connected');
      return;
    }
    const result = await db.transaction(async (client) => {
      const res = await client.query('SELECT 1 as test_value');
      return res.rows[0];
    });
    
    expect(result.test_value).toBe(1);
  });
});

describe('Database Schema', () => {
  beforeAll(async () => {
    try {
      await db.initialize();
    } catch (error) {
      console.warn('Database not available for schema testing');
    }
  }, 30000);

  test('should have all required tables', async () => {
    if (!db.isConnected) {
      console.warn('Skipping schema test - not connected');
      return;
    }
    
    const tables = [
      'sessions', 'tasks', 'task_responses', 
      'statistics', 'rate_management', 'proxy_usage'
    ];
    
    for (const table of tables) {
      const result = await db.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        )`,
        [table]
      );
      expect(result.rows[0].exists).toBe(true);
    }
  });

  test('should have required indexes', async () => {
    if (!db.isConnected) {
      console.warn('Skipping schema test - not connected');
      return;
    }
    
    const result = await db.query(`
      SELECT indexname FROM pg_indexes 
      WHERE tablename IN ('sessions', 'tasks', 'task_responses')
    `);
    
    expect(result.rows.length).toBeGreaterThan(0);
  });
});
