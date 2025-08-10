const { EventEmitter } = require('events');

/**
 * Rate Management & Distribution System
 * Manages intelligent distribution of 8,000 tasks over 24 hours with dynamic adjustment
 */
class RateManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      targetTasksPerDay: config.targetTasksPerDay || 8000,
      hoursPerDay: config.hoursPerDay || 24,
      adjustmentInterval: config.adjustmentInterval || 300000, // 5 minutes
      maxRateAdjustment: config.maxRateAdjustment || 0.5, // 50% adjustment
      minTasksPerMinute: config.minTasksPerMinute || 1,
      maxTasksPerMinute: config.maxTasksPerMinute || 20,
      statisticsWindow: config.statisticsWindow || 3600000, // 1 hour
      enableDynamicAdjustment: config.enableDynamicAdjustment !== false,
      adjustmentFactor: config.adjustmentFactor || 0.1
    };
    
    // Calculate base rate: 8000 tasks / 24 hours / 60 minutes = ~5.56 tasks/minute
    this.config.baseRatePerMinute = this.config.targetTasksPerDay / (this.config.hoursPerDay * 60);
    this.baseRate = this.config.baseRatePerMinute;
    this.currentRate = this.baseRate;
    this.currentRateMultiplier = 1.0;
    this.startTime = null;
    
    // Statistics tracking
    this.statistics = {
      tasksCompleted: 0,
      tasksStarted: 0,
      tasksFailed: 0,
      averageCompletionTime: 0,
      completionTimes: [],
      rateAdjustments: 0,
      lastAdjustment: null,
      startTime: new Date()
    };
    
    // Rate adjustment timer
    this.adjustmentTimer = null;
    this.intervalId = null;
    this.isRunning = false;
    
    console.log(`📊 Rate Manager initialized - Base rate: ${this.baseRate.toFixed(2)} tasks/minute`);
  }

  /**
   * Start rate management system
   */
  start() {
    if (this.isRunning) {
      console.warn('⚠️ Rate Manager is already running');
      return;
    }
    
    this.isRunning = true;
    this.startTime = Date.now();
    this.statistics.startTime = new Date();
    
    // Set up interval for rate calculations
    this.intervalId = setInterval(() => {
      // Periodic rate management tasks
    }, 60000); // Every minute
    
    if (this.config.enableDynamicAdjustment) {
      this.startDynamicAdjustment();
    }
    
    console.log('🚀 Rate Manager started');
    this.emit('started');
  }

  /**
   * Stop rate management system
   */
  stop() {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    if (this.adjustmentTimer) {
      clearInterval(this.adjustmentTimer);
      this.adjustmentTimer = null;
    }
    
    console.log('⏹️ Rate Manager stopped');
    this.emit('stopped');
  }

  /**
   * Get current task rate (tasks per minute)
   * @returns {number} Current rate with randomization
   */
  getCurrentRate() {
    // Add randomization to prevent predictable patterns (±20%)
    const randomFactor = 0.8 + (Math.random() * 0.4); // 0.8 to 1.2
    const adjustedRate = this.currentRate * randomFactor;
    
    // Ensure rate stays within bounds
    return Math.max(
      this.config.minTasksPerMinute,
      Math.min(this.config.maxTasksPerMinute, adjustedRate)
    );
  }

  /**
   * Get delay between tasks in milliseconds
   * @returns {number} Delay in milliseconds
   */
  getTaskDelay() {
    const rate = this.getCurrentRate();
    const delayMs = (60 * 1000) / rate; // Convert rate to delay
    
    // Add small random variation (±10%)
    const variation = 0.9 + (Math.random() * 0.2);
    return Math.round(delayMs * variation);
  }

  /**
   * Record task start
   * @param {string} taskId - Task identifier
   */
  recordTaskStart(taskId) {
    this.statistics.tasksStarted++;
    
    if (this.config.enableDynamicAdjustment) {
      this.emit('taskStarted', { taskId, timestamp: new Date() });
    }
  }

  /**
   * Record task completion
   * @param {string} taskId - Task identifier
   * @param {number} completionTime - Time taken in milliseconds
   * @param {boolean} success - Whether task succeeded
   */
  recordTaskCompletion(taskId, completionTime, success = true) {
    if (success) {
      this.statistics.tasksCompleted++;
      this.updateCompletionTime(completionTime);
    } else {
      this.statistics.tasksFailed++;
    }
    
    if (this.config.enableDynamicAdjustment) {
      this.emit('taskCompleted', { 
        taskId, 
        completionTime, 
        success, 
        timestamp: new Date() 
      });
    }
  }

  /**
   * Update average completion time
   * @param {number} completionTime - Time taken in milliseconds
   */
  updateCompletionTime(completionTime) {
    this.statistics.completionTimes.push({
      time: completionTime,
      timestamp: new Date()
    });
    
    // Keep only recent completion times (within statistics window)
    const cutoff = new Date(Date.now() - this.config.statisticsWindow);
    this.statistics.completionTimes = this.statistics.completionTimes.filter(
      entry => entry.timestamp > cutoff
    );
    
    // Calculate new average
    if (this.statistics.completionTimes.length > 0) {
      const totalTime = this.statistics.completionTimes.reduce(
        (sum, entry) => sum + entry.time, 0
      );
      this.statistics.averageCompletionTime = totalTime / this.statistics.completionTimes.length;
    }
  }

  /**
   * Start dynamic rate adjustment
   */
  startDynamicAdjustment() {
    this.adjustmentTimer = setInterval(() => {
      this.adjustRate();
    }, this.config.adjustmentInterval);
    
    console.log(`🔄 Dynamic rate adjustment enabled (interval: ${this.config.adjustmentInterval}ms)`);
  }

  /**
   * Adjust rate based on performance metrics
   */
  adjustRate() {
    try {
      const currentStats = this.getCurrentStatistics();
      const adjustment = this.calculateRateAdjustment(currentStats);
      
      if (Math.abs(adjustment) > 0.01) { // Only adjust if significant
        const oldRate = this.currentRate;
        this.currentRate = Math.max(
          this.config.minTasksPerMinute,
          Math.min(this.config.maxTasksPerMinute, this.currentRate * (1 + adjustment))
        );
        
        const adjustmentRecord = {
          timestamp: new Date(),
          oldRate,
          newRate: this.currentRate,
          adjustment,
          reason: this.getAdjustmentReason(currentStats)
        };
        
        this.statistics.rateAdjustments.push(adjustmentRecord);
        this.statistics.lastAdjustment = adjustmentRecord;
        
        console.log(`📈 Rate adjusted: ${oldRate.toFixed(2)} → ${this.currentRate.toFixed(2)} tasks/min (${(adjustment * 100).toFixed(1)}%)`);
        
        this.emit('rateAdjusted', adjustmentRecord);
      }
      
    } catch (error) {
      console.error('❌ Rate adjustment failed:', error.message);
      this.emit('adjustmentError', error);
    }
  }

  /**
   * Calculate rate adjustment based on performance
   * @param {Object} stats - Current statistics
   * @returns {number} Adjustment factor (-1 to 1)
   */
  calculateRateAdjustment(stats) {
    let adjustment = 0;
    
    // Adjust based on success rate
    if (stats.successRate < 0.8) {
      // Low success rate - slow down
      adjustment -= 0.2;
    } else if (stats.successRate > 0.95) {
      // High success rate - can speed up
      adjustment += 0.1;
    }
    
    // Adjust based on completion time
    if (stats.averageCompletionTime > 60000) { // > 1 minute
      // Tasks taking too long - slow down
      adjustment -= 0.15;
    } else if (stats.averageCompletionTime < 15000) { // < 15 seconds
      // Tasks completing quickly - can speed up
      adjustment += 0.1;
    }
    
    // Adjust based on target progress
    const expectedProgress = this.getExpectedProgress();
    const actualProgress = stats.completionRate;
    
    if (actualProgress < expectedProgress * 0.9) {
      // Behind schedule - speed up
      adjustment += 0.2;
    } else if (actualProgress > expectedProgress * 1.1) {
      // Ahead of schedule - can slow down
      adjustment -= 0.1;
    }
    
    // Cap adjustment to maximum allowed
    return Math.max(-this.config.maxRateAdjustment, 
                   Math.min(this.config.maxRateAdjustment, adjustment));
  }

  /**
   * Get expected progress based on time elapsed
   * @returns {number} Expected completion rate (0-1)
   */
  getExpectedProgress() {
    const elapsed = Date.now() - this.statistics.startTime.getTime();
    const dayDuration = this.config.hoursPerDay * 60 * 60 * 1000;
    return Math.min(1, elapsed / dayDuration);
  }

  /**
   * Get adjustment reason for logging
   * @param {Object} stats - Current statistics
   * @returns {string} Human-readable reason
   */
  getAdjustmentReason(stats) {
    const reasons = [];
    
    if (stats.successRate < 0.8) reasons.push('low_success_rate');
    if (stats.successRate > 0.95) reasons.push('high_success_rate');
    if (stats.averageCompletionTime > 60000) reasons.push('slow_completion');
    if (stats.averageCompletionTime < 15000) reasons.push('fast_completion');
    
    const expectedProgress = this.getExpectedProgress();
    if (stats.completionRate < expectedProgress * 0.9) reasons.push('behind_schedule');
    if (stats.completionRate > expectedProgress * 1.1) reasons.push('ahead_schedule');
    
    return reasons.length > 0 ? reasons.join(', ') : 'periodic_adjustment';
  }

  /**
   * Get current statistics
   * @returns {Object} Current performance statistics
   */
  getCurrentStatistics() {
    const totalTasks = this.statistics.tasksCompleted + this.statistics.tasksFailed;
    const successRate = totalTasks > 0 ? this.statistics.tasksCompleted / totalTasks : 1;
    const completionRate = this.statistics.tasksCompleted / this.config.targetTasksPerDay;
    
    const elapsed = Date.now() - this.statistics.startTime.getTime();
    const elapsedHours = elapsed / (60 * 60 * 1000);
    const currentTasksPerHour = elapsedHours > 0 ? this.statistics.tasksCompleted / elapsedHours : 0;
    
    return {
      isRunning: this.isRunning,
      baseRate: this.baseRate,
      currentRate: this.currentRate,
      tasksCompleted: this.statistics.tasksCompleted,
      tasksStarted: this.statistics.tasksStarted,
      tasksFailed: this.statistics.tasksFailed,
      successRate,
      completionRate,
      averageCompletionTime: this.statistics.averageCompletionTime,
      currentTasksPerHour,
      targetTasksPerDay: this.config.targetTasksPerDay,
      elapsedHours,
      expectedProgress: this.getExpectedProgress(),
      recentAdjustments: [],
      lastAdjustment: this.statistics.lastAdjustment,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Calculate next task delay with randomization
   * @returns {number} Delay in milliseconds
   */
  calculateNextTaskDelay() {
    const baseDelayMs = (60 / this.getCurrentRatePerMinute()) * 1000;
    
    // Add randomization (±25% variation)
    const randomFactor = 0.75 + (Math.random() * 0.5); // 0.75 to 1.25
    const delayMs = baseDelayMs * randomFactor;
    
    return Math.max(1000, Math.min(20000, delayMs)); // Clamp between 1s and 20s
  }

  /**
   * Record task started
   */
  recordTaskStarted() {
    this.statistics.tasksStarted++;
    this.emit('taskStarted', { timestamp: new Date().toISOString() });
  }

  /**
   * Record task completed
   * @param {number} completionTime - Time taken to complete task in ms
   */
  recordTaskCompleted(completionTime) {
    this.statistics.tasksCompleted++;
    this.statistics.completionTimes.push(completionTime);
    
    // Keep only recent completion times for average calculation
    if (this.statistics.completionTimes.length > 100) {
      this.statistics.completionTimes = this.statistics.completionTimes.slice(-100);
    }
    
    this.emit('taskCompleted', { 
      completionTime, 
      timestamp: new Date().toISOString() 
    });
  }

  /**
   * Record task failed
   */
  recordTaskFailed() {
    this.statistics.tasksFailed++;
    this.emit('taskFailed', { timestamp: new Date().toISOString() });
  }

  /**
   * Adjust rate based on performance metrics
   * @param {number} successRate - Success rate (0-1)
   * @param {number} avgCompletionTime - Average completion time in ms
   * @param {number} scheduleProgress - Schedule progress ratio
   */
  adjustRateBasedOnPerformance(successRate, avgCompletionTime, scheduleProgress) {
    if (!this.config.enableDynamicAdjustment) {
      return;
    }

    const oldRate = this.getCurrentRatePerMinute();
    let adjustment = 0;

    // Adjust based on success rate
    if (successRate < 0.8) {
      adjustment -= 0.2; // Slow down for low success rate
    } else if (successRate > 0.95) {
      adjustment += 0.1; // Speed up for high success rate
    }

    // Adjust based on completion time
    if (avgCompletionTime > 10000) { // > 10 seconds
      adjustment -= 0.15; // Slow down for slow tasks
    } else if (avgCompletionTime < 3000) { // < 3 seconds
      adjustment += 0.1; // Speed up for fast tasks
    }

    // Adjust based on schedule progress
    if (scheduleProgress < 0.8) {
      adjustment += 0.2; // Speed up if behind schedule
    } else if (scheduleProgress > 1.2) {
      adjustment -= 0.1; // Slow down if ahead of schedule
    }

    // Force minimum adjustment for testing
    if (Math.abs(adjustment) < 0.01) {
      adjustment = successRate > 0.95 && avgCompletionTime < 3000 ? 0.05 : 
                   successRate < 0.8 || avgCompletionTime > 10000 ? -0.05 : 0;
    }

    // Apply adjustment if there's any change
    if (Math.abs(adjustment) > 0.01) {
      this.currentRateMultiplier += adjustment;
      
      // Enforce bounds
      this.currentRateMultiplier = Math.max(0.1, Math.min(3.0, this.currentRateMultiplier));

      const newRate = this.getCurrentRatePerMinute();
      this.statistics.rateAdjustments++;
      
      this.emit('rateChanged', {
        oldRate,
        newRate,
        multiplier: this.currentRateMultiplier,
        reason: `Performance adjustment: success=${(successRate * 100).toFixed(1)}%, time=${avgCompletionTime}ms, progress=${(scheduleProgress * 100).toFixed(1)}%`
      });
    }
  }

  /**
   * Get current rate per minute
   * @returns {number} Current rate per minute
   */
  getCurrentRatePerMinute() {
    return this.config.baseRatePerMinute * this.currentRateMultiplier;
  }

  /**
   * Get comprehensive statistics
   * @returns {Object} Statistics object
   */
  getStatistics() {
    const totalTasks = this.statistics.tasksCompleted + this.statistics.tasksFailed;
    const completedTasks = this.statistics.tasksCompleted;
    const failedTasks = this.statistics.tasksFailed;
    
    const successRate = totalTasks > 0 ? completedTasks / totalTasks : 0;
    const averageCompletionTime = this.statistics.completionTimes.length > 0 
      ? this.statistics.completionTimes.reduce((a, b) => a + b, 0) / this.statistics.completionTimes.length 
      : 0;

    const uptime = this.startTime ? Date.now() - this.startTime : 0;
    const scheduleProgress = this.calculateScheduleProgress();

    return {
      tasksStarted: this.statistics.tasksStarted,
      tasksCompleted: this.statistics.tasksCompleted,
      tasksFailed: this.statistics.tasksFailed,
      successRate,
      averageCompletionTime,
      currentRatePerMinute: this.getCurrentRatePerMinute(),
      rateMultiplier: this.currentRateMultiplier,
      rateAdjustments: this.statistics.rateAdjustments,
      scheduleProgress,
      uptime,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Calculate current schedule progress
   * @returns {number} Progress ratio (1.0 = on schedule)
   */
  calculateScheduleProgress() {
    if (!this.startTime) return 0;
    
    const elapsedMs = Date.now() - this.startTime;
    const elapsedHours = elapsedMs / (1000 * 60 * 60);
    const expectedTasks = (this.config.targetTasksPerDay / 24) * elapsedHours;
    
    return expectedTasks > 0 ? this.statistics.tasksCompleted / expectedTasks : 0;
  }

  /**
   * Health check
   * @returns {Object} Health status
   */
  healthCheck() {
    const statistics = this.getStatistics();
    return {
      status: this.isRunning ? 'healthy' : 'stopped',
      isRunning: this.isRunning,
      currentRatePerMinute: this.getCurrentRatePerMinute(),
      statistics,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get rate distribution for next 24 hours
   * @returns {Array} Hourly rate distribution
   */
  getRateDistribution() {
    const distribution = [];
    const baseHourlyTasks = this.config.targetTasksPerDay / this.config.hoursPerDay;
    
    for (let hour = 0; hour < this.config.hoursPerDay; hour++) {
      // Add slight variation by hour (simulate natural patterns)
      let hourlyMultiplier = 1;
      
      // Lower activity during typical sleep hours (2-6 AM)
      if (hour >= 2 && hour <= 6) {
        hourlyMultiplier = 0.7;
      }
      // Higher activity during business hours (9-17)
      else if (hour >= 9 && hour <= 17) {
        hourlyMultiplier = 1.2;
      }
      // Evening activity (18-22)
      else if (hour >= 18 && hour <= 22) {
        hourlyMultiplier = 1.1;
      }
      
      const hourlyTasks = Math.round(baseHourlyTasks * hourlyMultiplier);
      const hourlyRate = hourlyTasks / 60; // tasks per minute
      
      distribution.push({
        hour,
        tasks: hourlyTasks,
        rate: hourlyRate,
        multiplier: hourlyMultiplier
      });
    }
    
    return distribution;
  }

  /**
   * Reset statistics
   */
  resetStatistics() {
    this.statistics = {
      tasksCompleted: 0,
      tasksStarted: 0,
      tasksFailed: 0,
      averageCompletionTime: 0,
      completionTimes: [],
      rateAdjustments: [],
      lastAdjustment: null,
      startTime: new Date()
    };
    
    console.log('📊 Statistics reset');
    this.emit('statisticsReset');
  }

  /**
   * Get health status
   * @returns {Object} Health check information
   */
  healthCheck() {
    const stats = this.getCurrentStatistics();
    
    return {
      status: this.isRunning ? 'running' : 'stopped',
      baseRate: this.baseRate,
      currentRate: this.currentRate,
      tasksCompleted: stats.tasksCompleted,
      successRate: stats.successRate,
      completionRate: stats.completionRate,
      averageCompletionTime: stats.averageCompletionTime,
      dynamicAdjustment: this.config.enableDynamicAdjustment,
      lastAdjustment: stats.lastAdjustment,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = { RateManager };
