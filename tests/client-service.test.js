const { ClientService } = require('../src/client/client-service');
const { db } = require('../database/connection');
const { rabbitmq } = require('../messaging/rabbitmq-setup');

// Mock dependencies for testing
jest.mock('../database/connection');
jest.mock('../messaging/rabbitmq-setup');

describe('Client Service', () => {
  let clientService;
  let mockDb;
  let mockRabbitmq;

  beforeEach(() => {
    mockDb = {
      query: jest.fn(),
      transaction: jest.fn()
    };
    
    mockRabbitmq = {
      setupConsumer: jest.fn(),
      sendRPCRequest: jest.fn(),
      generateCorrelationId: jest.fn(() => 'test-correlation-id')
    };
    
    clientService = new ClientService(mockDb, mockRabbitmq);
  });

  describe('Session Validation', () => {
    test('should validate required session fields', () => {
      const invalidSession = {
        tasks_24h: 100,
        countries: ['us']
        // Missing main_page_url and navigations
      };
      
      expect(() => clientService.validateSessionData(invalidSession))
        .toThrow('Missing required field: main_page_url');
    });

    test('should validate session data types', () => {
      const invalidSession = {
        tasks_24h: 'invalid',
        countries: ['us'],
        main_page_url: 'https://example.com',
        navigations: [{ css: '.test', action: 'click_first' }]
      };
      
      expect(() => clientService.validateSessionData(invalidSession))
        .toThrow('tasks_24h must be a positive number');
    });

    test('should accept valid session data', () => {
      const validSession = {
        tasks_24h: 100,
        countries: ['us', 'ca'],
        main_page_url: 'https://example.com',
        navigations: [
          { css: '.test', action: 'click_first' }
        ]
      };
      
      expect(() => clientService.validateSessionData(validSession))
        .not.toThrow();
    });

    test('should accept empty navigations for main page only visits', () => {
      const validSessionWithEmptyNavigations = {
        tasks_24h: 100,
        countries: ['us', 'ca'],
        main_page_url: 'https://example.com',
        navigations: [] // Empty array should be allowed
      };
      
      expect(() => clientService.validateSessionData(validSessionWithEmptyNavigations))
        .not.toThrow();
    });
  });

  describe('Task Distribution', () => {
    test('should calculate task distribution correctly', () => {
      const session = {
        tasks_24h: 1000,
        countries: ['us', 'ca'],
        mobile_desktop_distribution: '60:40',
        mobile_os_distribution: '1:1',
        desktop_os_distribution: '1:1'
      };
      
      const distribution = clientService.calculateTaskDistribution(session);
      
      expect(distribution).toHaveLength(2);
      expect(distribution[0].country).toBe('us');
      expect(distribution[1].country).toBe('ca');
      
      // Each country should get 500 tasks
      const totalTasks = distribution[0].tasks.reduce((sum, task) => sum + task.count, 0);
      expect(totalTasks).toBe(500);
    });

    test('should handle uneven distribution', () => {
      const session = {
        tasks_24h: 100,
        countries: ['us', 'ca', 'uk'],
        mobile_desktop_distribution: '70:30',
        mobile_os_distribution: '2:1',
        desktop_os_distribution: '1:2'
      };
      
      const distribution = clientService.calculateTaskDistribution(session);
      
      expect(distribution).toHaveLength(3);
      
      // Verify mobile/desktop split (approximately 70:30)
      const usTasks = distribution[0].tasks;
      const mobileCount = usTasks.filter(t => t.device === 'mobile').reduce((sum, t) => sum + t.count, 0);
      const desktopCount = usTasks.filter(t => t.device === 'desktop').reduce((sum, t) => sum + t.count, 0);
      
      expect(mobileCount).toBeGreaterThan(desktopCount);
    });
  });

  describe('Task Generation', () => {
    test('should generate tasks with correct structure', async () => {
      const session = {
        session_id: 'test-session',
        main_page_url: 'https://example.com',
        navigations: JSON.stringify([{ css: '.test', action: 'click_first' }])
      };
      
      const distribution = [
        {
          country: 'us',
          tasks: [
            { device: 'mobile', os: 'iOS', count: 2 }
          ]
        }
      ];
      
      const tasks = await clientService.generateTasks(session, distribution);
      
      expect(tasks).toHaveLength(2);
      expect(tasks[0]).toMatchObject({
        sessionId: 'test-session',
        country: 'us',
        device: 'mobile',
        os: 'iOS',
        mainPageUrl: 'https://example.com'
      });
      expect(tasks[0].id).toBeDefined();
      expect(tasks[0].correlationId).toBeDefined();
    });
  });

  describe('Health Check', () => {
    test('should return health status', async () => {
      const health = await clientService.healthCheck();
      
      expect(health).toMatchObject({
        status: expect.any(String),
        activeSessions: expect.any(Number),
        rateManager: expect.any(Object),
        timestamp: expect.any(String)
      });
    });
  });
});
