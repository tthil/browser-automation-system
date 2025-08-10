/**
 * Navigation Engine - Core browser automation navigation system
 * Handles CSS selector operations, element waiting, and action execution
 */
class NavigationEngine {
  constructor(config = {}) {
    this.config = {
      elementWaitTimeout: config.elementWaitTimeout || 10000,
      betweenNavigationDelay: config.betweenNavigationDelay || 7500,
      debugMode: config.debugMode || false,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 1000
    };
    
    console.log('🧭 Navigation Engine initialized');
  }

  /**
   * Execute navigation sequence with error recovery
   * @param {Object} page - Puppeteer page instance
   * @param {Array} navigations - Array of navigation steps
   * @returns {Promise<Array>} Results of navigation steps
   */
  async executeNavigations(page, navigations) {
    const results = [];
    
    // Handle empty navigations array
    if (!navigations || navigations.length === 0) {
      console.log('📄 No navigations to execute - main page visit only');
      return [];
    }
    
    for (let i = 0; i < navigations.length; i++) {
      const navigation = navigations[i];
      
      try {
        console.log(`🧭 Navigation ${i + 1}/${navigations.length}: ${navigation.action} on "${navigation.css}"`);
        
        if (this.config.debugMode) {
          console.log(`[DEBUG] Waiting for element: ${navigation.css}`);
        }
        
        // Wait for element with retry logic
        const element = await this.waitForElement(page, navigation.css);
        
        // Execute action based on type
        let result;
        switch (navigation.action) {
          case 'click_first':
            result = await this.clickFirst(page, navigation.css, element);
            break;
          case 'random_click':
            result = await this.randomClick(page, navigation.css);
            break;
          case 'type_text':
            result = await this.typeText(page, navigation.css, navigation.text || '', element);
            break;
          case 'select_option':
            result = await this.selectOption(page, navigation.css, navigation.value || '', element);
            break;
          case 'hover':
            result = await this.hoverElement(page, navigation.css, element);
            break;
          case 'scroll_to':
            result = await this.scrollToElement(page, navigation.css, element);
            break;
          default:
            throw new Error(`Unknown action type: ${navigation.action}`);
        }
        
        // Wait between navigations
        if (i < navigations.length - 1) {
          console.log(`⏳ Waiting ${this.config.betweenNavigationDelay}ms before next navigation...`);
          await page.waitForTimeout(this.config.betweenNavigationDelay);
        }
        
        results.push({
          step: i + 1,
          css: navigation.css,
          action: navigation.action,
          status: 'success',
          ...result
        });
        
      } catch (error) {
        console.error(`❌ Navigation ${i + 1} failed:`, error.message);
        
        // Attempt error recovery
        const recoveryResult = await this.attemptErrorRecovery(page, navigation, error);
        
        results.push({
          step: i + 1,
          css: navigation.css,
          action: navigation.action,
          status: 'failed',
          error: error.message,
          recovery: recoveryResult
        });
        
        // Continue with next navigation unless it's a critical error
        if (!this.isCriticalError(error)) {
          continue;
        } else {
          throw error;
        }
      }
    }
    
    return results;
  }

  /**
   * Wait for element with enhanced error handling and retry logic
   * @param {Object} page - Puppeteer page instance
   * @param {string} selector - CSS selector
   * @returns {Promise<Object>} Element handle
   */
  async waitForElement(page, selector) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        if (this.config.debugMode && attempt > 1) {
          console.log(`[DEBUG] Retry attempt ${attempt}/${this.config.retryAttempts} for selector: ${selector}`);
        }
        
        const element = await page.waitForSelector(selector, {
          timeout: this.config.elementWaitTimeout,
          visible: true
        });
        
        if (!element) {
          throw new Error(`Element not found: ${selector}`);
        }
        
        // Verify element is interactable
        const isVisible = await element.isIntersectingViewport();
        if (!isVisible) {
          await element.scrollIntoView();
          await page.waitForTimeout(500); // Allow scroll to complete
        }
        
        return element;
        
      } catch (error) {
        lastError = error;
        
        if (attempt < this.config.retryAttempts) {
          console.warn(`⚠️ Element wait failed (attempt ${attempt}), retrying in ${this.config.retryDelay}ms...`);
          await page.waitForTimeout(this.config.retryDelay);
        }
      }
    }
    
    throw new Error(`Failed to find element after ${this.config.retryAttempts} attempts: ${selector}. Last error: ${lastError.message}`);
  }

  /**
   * Click first matching element
   * @param {Object} page - Puppeteer page instance
   * @param {string} selector - CSS selector
   * @param {Object} element - Pre-found element (optional)
   * @returns {Promise<Object>} Click result
   */
  async clickFirst(page, selector, element = null) {
    try {
      const targetElement = element || await this.waitForElement(page, selector);
      
      // Ensure element is clickable
      await this.ensureElementClickable(page, targetElement);
      
      if (this.config.debugMode) {
        await this.highlightElement(page, targetElement);
      }
      
      await targetElement.click();
      
      // Wait for potential page navigation or loading
      await page.waitForTimeout(1000);
      
      return {
        clickedElement: selector,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      throw new Error(`Click failed on ${selector}: ${error.message}`);
    }
  }

  /**
   * Click random element from matching elements
   * @param {Object} page - Puppeteer page instance
   * @param {string} selector - CSS selector
   * @returns {Promise<Object>} Click result
   */
  async randomClick(page, selector) {
    try {
      await this.waitForElement(page, selector);
      const elements = await page.$$(selector);
      
      if (elements.length === 0) {
        throw new Error(`No elements found for selector: ${selector}`);
      }
      
      // Filter for visible and clickable elements
      const clickableElements = [];
      for (const element of elements) {
        const isVisible = await element.isIntersectingViewport();
        if (isVisible) {
          clickableElements.push(element);
        }
      }
      
      if (clickableElements.length === 0) {
        throw new Error(`No visible elements found for selector: ${selector}`);
      }
      
      // Select random element
      const randomIndex = Math.floor(Math.random() * clickableElements.length);
      const targetElement = clickableElements[randomIndex];
      
      await this.ensureElementClickable(page, targetElement);
      
      if (this.config.debugMode) {
        await this.highlightElement(page, targetElement);
      }
      
      await targetElement.click();
      await page.waitForTimeout(1000);
      
      return {
        clickedElement: selector,
        selectedIndex: randomIndex,
        totalElements: clickableElements.length,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      throw new Error(`Random click failed on ${selector}: ${error.message}`);
    }
  }

  /**
   * Type text into input element
   * @param {Object} page - Puppeteer page instance
   * @param {string} selector - CSS selector
   * @param {string} text - Text to type
   * @param {Object} element - Pre-found element (optional)
   * @returns {Promise<Object>} Type result
   */
  async typeText(page, selector, text, element = null) {
    try {
      const targetElement = element || await this.waitForElement(page, selector);
      
      // Clear existing text
      await targetElement.click({ clickCount: 3 });
      await targetElement.press('Backspace');
      
      if (this.config.debugMode) {
        await this.highlightElement(page, targetElement);
      }
      
      // Type text with realistic delay
      await targetElement.type(text, { delay: 100 });
      
      return {
        selector,
        text,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      throw new Error(`Type text failed on ${selector}: ${error.message}`);
    }
  }

  /**
   * Select option from dropdown
   * @param {Object} page - Puppeteer page instance
   * @param {string} selector - CSS selector
   * @param {string} value - Option value to select
   * @param {Object} element - Pre-found element (optional)
   * @returns {Promise<Object>} Select result
   */
  async selectOption(page, selector, value, element = null) {
    try {
      const targetElement = element || await this.waitForElement(page, selector);
      
      if (this.config.debugMode) {
        await this.highlightElement(page, targetElement);
      }
      
      await targetElement.select(value);
      
      return {
        selector,
        selectedValue: value,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      throw new Error(`Select option failed on ${selector}: ${error.message}`);
    }
  }

  /**
   * Hover over element
   * @param {Object} page - Puppeteer page instance
   * @param {string} selector - CSS selector
   * @param {Object} element - Pre-found element (optional)
   * @returns {Promise<Object>} Hover result
   */
  async hoverElement(page, selector, element = null) {
    try {
      const targetElement = element || await this.waitForElement(page, selector);
      
      if (this.config.debugMode) {
        await this.highlightElement(page, targetElement);
      }
      
      await targetElement.hover();
      await page.waitForTimeout(500); // Allow hover effects to trigger
      
      return {
        selector,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      throw new Error(`Hover failed on ${selector}: ${error.message}`);
    }
  }

  /**
   * Scroll element into view
   * @param {Object} page - Puppeteer page instance
   * @param {string} selector - CSS selector
   * @param {Object} element - Pre-found element (optional)
   * @returns {Promise<Object>} Scroll result
   */
  async scrollToElement(page, selector, element = null) {
    try {
      const targetElement = element || await this.waitForElement(page, selector);
      
      await targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await page.waitForTimeout(1000); // Allow scroll to complete
      
      if (this.config.debugMode) {
        await this.highlightElement(page, targetElement);
      }
      
      return {
        selector,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      throw new Error(`Scroll to element failed on ${selector}: ${error.message}`);
    }
  }

  /**
   * Ensure element is clickable
   * @param {Object} page - Puppeteer page instance
   * @param {Object} element - Element handle
   */
  async ensureElementClickable(page, element) {
    // Scroll element into view if needed
    const isVisible = await element.isIntersectingViewport();
    if (!isVisible) {
      await element.scrollIntoView();
      await page.waitForTimeout(500);
    }
    
    // Check if element is enabled
    const isEnabled = await element.evaluate(el => !el.disabled);
    if (!isEnabled) {
      throw new Error('Element is disabled');
    }
  }

  /**
   * Highlight element for debugging
   * @param {Object} page - Puppeteer page instance
   * @param {Object} element - Element handle
   */
  async highlightElement(page, element) {
    try {
      await element.evaluate(el => {
        el.style.border = '3px solid red';
        el.style.backgroundColor = 'yellow';
        setTimeout(() => {
          el.style.border = '';
          el.style.backgroundColor = '';
        }, 2000);
      });
      
      await page.waitForTimeout(500); // Show highlight briefly
    } catch (error) {
      // Ignore highlight errors
      console.warn('⚠️ Could not highlight element:', error.message);
    }
  }

  /**
   * Attempt error recovery for failed navigation
   * @param {Object} page - Puppeteer page instance
   * @param {Object} navigation - Navigation step that failed
   * @param {Error} error - Original error
   * @returns {Promise<Object>} Recovery result
   */
  async attemptErrorRecovery(page, navigation, error) {
    try {
      console.log(`🔄 Attempting error recovery for: ${navigation.css}`);
      
      // Try refreshing the page if it's a stale element error
      if (error.message.includes('stale') || error.message.includes('detached')) {
        await page.reload({ waitUntil: 'networkidle2' });
        await page.waitForTimeout(2000);
        return { strategy: 'page_reload', success: true };
      }
      
      // Try scrolling if element is not visible
      if (error.message.includes('not visible') || error.message.includes('viewport')) {
        await page.evaluate(() => window.scrollBy(0, 300));
        await page.waitForTimeout(1000);
        return { strategy: 'scroll_page', success: true };
      }
      
      // Try waiting longer for dynamic content
      if (error.message.includes('timeout') || error.message.includes('not found')) {
        await page.waitForTimeout(3000);
        return { strategy: 'extended_wait', success: true };
      }
      
      return { strategy: 'none', success: false };
      
    } catch (recoveryError) {
      console.error('❌ Error recovery failed:', recoveryError.message);
      return { strategy: 'failed', success: false, error: recoveryError.message };
    }
  }

  /**
   * Check if error is critical and should stop navigation
   * @param {Error} error - Error to check
   * @returns {boolean} True if error is critical
   */
  isCriticalError(error) {
    const criticalErrors = [
      'page crashed',
      'browser disconnected',
      'navigation timeout',
      'security error'
    ];
    
    return criticalErrors.some(criticalError => 
      error.message.toLowerCase().includes(criticalError)
    );
  }

  /**
   * Get navigation statistics
   * @returns {Object} Navigation statistics
   */
  getStatistics() {
    return {
      config: this.config,
      supportedActions: [
        'click_first',
        'random_click', 
        'type_text',
        'select_option',
        'hover',
        'scroll_to'
      ],
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = { NavigationEngine };
