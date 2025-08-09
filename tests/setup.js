require('dotenv').config();

// Global test setup
beforeAll(async () => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.DB_NAME = 'browser_automation'; // Use existing database
  
  // Increase timeout for integration tests
  jest.setTimeout(30000);
});

afterAll(async () => {
  // Clean up any global resources
  await new Promise(resolve => setTimeout(resolve, 1000));
});
