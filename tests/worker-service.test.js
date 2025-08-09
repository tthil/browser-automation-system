const { WorkerService } = require('../src/worker/worker-service');

// Mock puppeteer
jest.mock('puppeteer', () => ({
  launch: jest.fn(() => ({
    newPage: jest.fn(() => ({
      setViewport: jest.fn(),
      setUserAgent: jest.fn(),
      setDefaultTimeout: jest.fn(),
      setDefaultNavigationTimeout: jest.fn(),
      goto: jest.fn(),
      waitForSelector: jest.fn(),
      $: jest.fn(),
      $$: jest.fn(),
      evaluate: jest.fn(),
      waitForTimeout: jest.fn(),
      close: jest.fn()
    })),
    close: jest.fn(),
    isConnected: jest.fn(() => true)
  }))
}));

describe('Worker Service', () => {
  let workerService;
  let mockRabbitmq;

  beforeEach(() => {
    mockRabbitmq = {
      setupRPCConsumer: jest.fn()
    };
    
    workerService = new WorkerService(mockRabbitmq);
  });

  describe('Task Validation', () => {
    test('should validate required task fields', () => {
      const invalidTask = {
        correlation_id: 'test-id',
        country: 'us'
        // Missing required fields
      };
      
      expect(() => workerService.validateTaskData(invalidTask))
        .toThrow('Missing required field: device');
    });

    test('should validate navigations array', () => {
      const invalidTask = {
        correlation_id: 'test-id',
        country: 'us',
        device: 'mobile',
        os: 'iOS',
        main_page_url: 'https://example.com',
        navigations: 'invalid'
      };
      
      expect(() => workerService.validateTaskData(invalidTask))
        .toThrow('Navigations must be an array');
    });

    test('should accept valid task data', () => {
      const validTask = {
        correlation_id: 'test-id',
        country: 'us',
        device: 'mobile',
        os: 'iOS',
        main_page_url: 'https://example.com',
        navigations: [
          { css: '.test', action: 'click_first' }
        ]
      };
      
      expect(() => workerService.validateTaskData(validTask))
        .not.toThrow();
    });
  });

  describe('User Agent Generation', () => {
    test('should return correct user agent for mobile iOS', () => {
      const userAgent = workerService.getUserAgent('mobile', 'iOS');
      expect(userAgent).toContain('iPhone');
      expect(userAgent).toContain('Safari');
    });

    test('should return correct user agent for desktop Windows', () => {
      const userAgent = workerService.getUserAgent('desktop', 'Windows');
      expect(userAgent).toContain('Windows NT');
      expect(userAgent).toContain('Chrome');
    });

    test('should return default user agent for unknown combination', () => {
      const userAgent = workerService.getUserAgent('unknown', 'unknown');
      expect(userAgent).toContain('Windows NT'); // Default fallback
    });
  });

  describe('Configuration', () => {
    test('should load configuration from environment', () => {
      expect(workerService.config.tasksQueue).toBe('tasks');
      expect(workerService.config.navigationTimeout).toBe(30000);
      expect(workerService.config.elementWaitTimeout).toBe(10000);
    });

    test('should handle VNC configuration', () => {
      process.env.ENABLE_VNC = 'true';
      process.env.DEBUG_MODE = 'true';
      
      const vncWorker = new WorkerService(mockRabbitmq);
      
      expect(vncWorker.config.enableVnc).toBe(true);
      expect(vncWorker.config.debugMode).toBe(true);
      
      // Clean up
      delete process.env.ENABLE_VNC;
      delete process.env.DEBUG_MODE;
    });
  });

  describe('Health Check', () => {
    test('should return health status', async () => {
      const health = await workerService.healthCheck();
      
      expect(health).toMatchObject({
        status: expect.any(String),
        activeTasks: expect.any(Number),
        browserConnected: expect.any(Boolean),
        vncEnabled: expect.any(Boolean),
        debugMode: expect.any(Boolean),
        timestamp: expect.any(String)
      });
    });
  });

  describe('Task Processing', () => {
    test('should handle task message format', async () => {
      const taskData = {
        correlation_id: 'test-correlation-id',
        country: 'us',
        device: 'mobile',
        os: 'iOS',
        main_page_url: 'https://example.com',
        navigations: [
          { css: '.test-element', action: 'click_first' }
        ]
      };

      // Mock browser initialization
      await workerService.initializeBrowser();
      
      // The actual task execution would require more complex mocking
      // This tests the basic structure
      expect(() => workerService.validateTaskData(taskData)).not.toThrow();
    });
  });

  describe('Fingerprinting Integration', () => {
    test('should initialize fingerprint manager', () => {
      expect(workerService.fingerprintManager).toBeDefined();
      expect(workerService.config.useFingerprinting).toBe(true);
      expect(workerService.config.fingerprintProfile).toBe('random');
    });

    test('should get fingerprint profile for task', () => {
      const taskData = {
        device: 'mobile',
        os: 'iOS'
      };

      const profile = workerService.getFingerprintProfile(taskData);
      expect(profile).toBeDefined();
      expect(profile.key).toBeDefined();
      expect(profile.device).toBeDefined();
      expect(profile.os).toBeDefined();
    });

    test('should find matching profile by device/OS', () => {
      const profileKey = workerService.findMatchingProfile('mobile', 'iOS');
      expect(profileKey).toBeDefined();
      expect(profileKey).toContain('mobile_ios');
    });

    test('should handle profile rotation', () => {
      // Set config to rotate
      workerService.config.fingerprintProfile = 'rotate';
      
      const profile1 = workerService.getFingerprintProfile({});
      const profile2 = workerService.getFingerprintProfile({});
      
      expect(profile1).toBeDefined();
      expect(profile2).toBeDefined();
    });

    test('should include fingerprinting in health check', async () => {
      const health = await workerService.healthCheck();
      
      expect(health.useFingerprinting).toBe(true);
      expect(health.fingerprintProfile).toBe('random');
      expect(health.fingerprintManager).toBeDefined();
      expect(health.fingerprintManager.total).toBeGreaterThan(0);
    });
  });
});
