const { RateManager } = require('../src/rate-management/rate-manager');

describe('Rate Manager', () => {
  let rateManager;

  beforeEach(() => {
    rateManager = new RateManager({
      targetTasksPerDay: 8000,
      enableDynamicAdjustment: true
    });
  });

  afterEach(() => {
    if (rateManager.isRunning) {
      rateManager.stop();
    }
  });

  describe('Initialization', () => {
    test('should initialize with correct configuration', () => {
      expect(rateManager.config.targetTasksPerDay).toBe(8000);
      expect(rateManager.config.enableDynamicAdjustment).toBe(true);
      expect(rateManager.config.baseRatePerMinute).toBeCloseTo(5.56, 2);
    });

    test('should use default configuration values', () => {
      const defaultManager = new RateManager();
      expect(defaultManager.config.targetTasksPerDay).toBe(8000);
      expect(defaultManager.config.enableDynamicAdjustment).toBe(true);
      expect(defaultManager.config.adjustmentFactor).toBe(0.1);
    });

    test('should calculate correct base rate', () => {
      const customManager = new RateManager({ targetTasksPerDay: 1440 });
      expect(customManager.config.baseRatePerMinute).toBe(1); // 1440 / 24 / 60 = 1
    });
  });

  describe('Rate Management', () => {
    test('should start and stop rate management', () => {
      expect(rateManager.isRunning).toBe(false);
      
      rateManager.start();
      expect(rateManager.isRunning).toBe(true);
      expect(rateManager.intervalId).toBeDefined();
      
      rateManager.stop();
      expect(rateManager.isRunning).toBe(false);
      expect(rateManager.intervalId).toBeNull();
    });

    test('should not start if already running', () => {
      rateManager.start();
      const firstIntervalId = rateManager.intervalId;
      
      rateManager.start(); // Second start should be ignored
      expect(rateManager.intervalId).toBe(firstIntervalId);
    });

    test('should calculate next task delay with randomization', () => {
      const delay = rateManager.calculateNextTaskDelay();
      
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThan(20000); // Should be reasonable
      
      // Test multiple calculations for randomization
      const delays = Array.from({ length: 10 }, () => rateManager.calculateNextTaskDelay());
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1); // Should have variation
    });

    test('should get current rate per minute', () => {
      const rate = rateManager.getCurrentRatePerMinute();
      expect(rate).toBeCloseTo(5.56, 1);
    });
  });

  describe('Dynamic Rate Adjustment', () => {
    test('should adjust rate based on success rate', () => {
      const initialRate = rateManager.getCurrentRatePerMinute();
      
      // Simulate low success rate (should decrease rate)
      rateManager.adjustRateBasedOnPerformance(0.5, 5000, 0.8);
      expect(rateManager.getCurrentRatePerMinute()).toBeLessThan(initialRate);
      
      // Reset and simulate high success rate (should increase rate)
      rateManager.currentRateMultiplier = 1.0;
      rateManager.adjustRateBasedOnPerformance(0.95, 3000, 1.2);
      expect(rateManager.getCurrentRatePerMinute()).toBeGreaterThan(initialRate);
    });

    test('should adjust rate based on completion time', () => {
      const initialRate = rateManager.getCurrentRatePerMinute();
      
      // Simulate slow completion times (should decrease rate)
      rateManager.adjustRateBasedOnPerformance(0.9, 15000, 1.0);
      expect(rateManager.getCurrentRatePerMinute()).toBeLessThan(initialRate);
      
      // Reset and simulate fast completion times (should increase rate)
      rateManager.currentRateMultiplier = 1.0;
      rateManager.adjustRateBasedOnPerformance(0.9, 2000, 1.0);
      expect(rateManager.getCurrentRatePerMinute()).toBeGreaterThan(initialRate);
    });

    test('should adjust rate based on schedule progress', () => {
      const initialRate = rateManager.getCurrentRatePerMinute();
      
      // Simulate behind schedule (should increase rate)
      rateManager.adjustRateBasedOnPerformance(0.9, 5000, 0.7);
      expect(rateManager.getCurrentRatePerMinute()).toBeGreaterThan(initialRate);
      
      // Reset and simulate ahead of schedule (should decrease rate)
      rateManager.currentRateMultiplier = 1.0;
      rateManager.adjustRateBasedOnPerformance(0.9, 5000, 1.3);
      expect(rateManager.getCurrentRatePerMinute()).toBeLessThan(initialRate);
    });

    test('should respect rate multiplier bounds', () => {
      // Test minimum bound
      rateManager.adjustRateBasedOnPerformance(0.1, 20000, 0.1);
      expect(rateManager.currentRateMultiplier).toBeGreaterThanOrEqual(0.1);
      
      // Test maximum bound
      rateManager.currentRateMultiplier = 1.0;
      rateManager.adjustRateBasedOnPerformance(1.0, 1000, 0.1);
      expect(rateManager.currentRateMultiplier).toBeLessThanOrEqual(3.0);
    });

    test('should disable dynamic adjustment when configured', () => {
      const staticManager = new RateManager({ enableDynamicAdjustment: false });
      const initialRate = staticManager.getCurrentRatePerMinute();
      
      staticManager.adjustRateBasedOnPerformance(0.1, 20000, 0.1);
      expect(staticManager.getCurrentRatePerMinute()).toBe(initialRate);
    });
  });

  describe('Statistics Tracking', () => {
    test('should track task lifecycle events', () => {
      rateManager.recordTaskStarted();
      rateManager.recordTaskCompleted(5000);
      rateManager.recordTaskFailed();
      
      const stats = rateManager.getStatistics();
      expect(stats.tasksStarted).toBe(1);
      expect(stats.tasksCompleted).toBe(1);
      expect(stats.tasksFailed).toBe(1);
      expect(stats.averageCompletionTime).toBe(5000);
    });

    test('should calculate success rate correctly', () => {
      rateManager.recordTaskCompleted(3000);
      rateManager.recordTaskCompleted(4000);
      rateManager.recordTaskFailed();
      
      const stats = rateManager.getStatistics();
      expect(stats.successRate).toBeCloseTo(0.67, 2);
    });

    test('should track average completion time', () => {
      rateManager.recordTaskCompleted(2000);
      rateManager.recordTaskCompleted(4000);
      rateManager.recordTaskCompleted(6000);
      
      const stats = rateManager.getStatistics();
      expect(stats.averageCompletionTime).toBe(4000);
    });

    test('should track rate adjustments', () => {
      rateManager.adjustRateBasedOnPerformance(0.5, 10000, 0.8);
      rateManager.adjustRateBasedOnPerformance(0.9, 3000, 1.1);
      
      const stats = rateManager.getStatistics();
      expect(stats.rateAdjustments).toBe(2);
    });

    test('should provide comprehensive statistics', () => {
      const stats = rateManager.getStatistics();
      
      expect(stats).toHaveProperty('tasksStarted');
      expect(stats).toHaveProperty('tasksCompleted');
      expect(stats).toHaveProperty('tasksFailed');
      expect(stats).toHaveProperty('successRate');
      expect(stats).toHaveProperty('averageCompletionTime');
      expect(stats).toHaveProperty('currentRatePerMinute');
      expect(stats).toHaveProperty('rateMultiplier');
      expect(stats).toHaveProperty('rateAdjustments');
      expect(stats).toHaveProperty('uptime');
      expect(stats).toHaveProperty('timestamp');
    });
  });

  describe('Event Emission', () => {
    test('should emit rate change events', (done) => {
      rateManager.on('rateChanged', (data) => {
        expect(data.oldRate).toBeDefined();
        expect(data.newRate).toBeDefined();
        expect(data.multiplier).toBeDefined();
        expect(data.reason).toBeDefined();
        done();
      });
      
      rateManager.adjustRateBasedOnPerformance(0.5, 10000, 0.8);
    });

    test('should emit task lifecycle events', (done) => {
      let eventCount = 0;
      const expectedEvents = ['taskStarted', 'taskCompleted', 'taskFailed'];
      
      expectedEvents.forEach(event => {
        rateManager.on(event, (data) => {
          expect(data.timestamp).toBeDefined();
          eventCount++;
          if (eventCount === expectedEvents.length) {
            done();
          }
        });
      });
      
      rateManager.recordTaskStarted();
      rateManager.recordTaskCompleted(5000);
      rateManager.recordTaskFailed();
    });
  });

  describe('Health Check', () => {
    test('should provide health check information', () => {
      rateManager.start();
      rateManager.recordTaskCompleted(3000);
      rateManager.recordTaskFailed();
      
      const health = rateManager.healthCheck();
      
      expect(health.status).toBe('healthy');
      expect(health.isRunning).toBe(true);
      expect(health.currentRatePerMinute).toBeDefined();
      expect(health.statistics).toBeDefined();
      expect(health.timestamp).toBeDefined();
    });

    test('should report stopped status when not running', () => {
      const health = rateManager.healthCheck();
      expect(health.status).toBe('stopped');
      expect(health.isRunning).toBe(false);
    });
  });

  describe('Schedule Progress Calculation', () => {
    test('should calculate schedule progress correctly', () => {
      // Mock current time to be 12 hours into the day (50% through)
      const mockDate = new Date();
      mockDate.setHours(12, 0, 0, 0);
      jest.spyOn(Date, 'now').mockReturnValue(mockDate.getTime());
      
      // Simulate 4000 tasks completed (50% of 8000)
      for (let i = 0; i < 4000; i++) {
        rateManager.recordTaskCompleted(3000);
      }
      
      const stats = rateManager.getStatistics();
      expect(stats.scheduleProgress).toBeCloseTo(1.0, 1); // On schedule
      
      Date.now.mockRestore();
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid performance metrics gracefully', () => {
      expect(() => {
        rateManager.adjustRateBasedOnPerformance(-1, 5000, 1.0);
      }).not.toThrow();
      
      expect(() => {
        rateManager.adjustRateBasedOnPerformance(1.5, -1000, 1.0);
      }).not.toThrow();
    });

    test('should handle stop when not running', () => {
      expect(() => {
        rateManager.stop();
      }).not.toThrow();
    });
  });
});
