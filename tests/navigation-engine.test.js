const { NavigationEngine } = require('../src/navigation/navigation-engine');

describe('Navigation Engine', () => {
  let navigationEngine;
  let mockPage;

  beforeEach(() => {
    navigationEngine = new NavigationEngine({
      elementWaitTimeout: 5000,
      betweenNavigationDelay: 1000,
      debugMode: true,
      retryAttempts: 2
    });

    // Mock Puppeteer page
    mockPage = {
      waitForSelector: jest.fn(),
      $: jest.fn(),
      $$: jest.fn(),
      waitForTimeout: jest.fn(),
      evaluate: jest.fn(),
      reload: jest.fn()
    };

    // Mock element
    const mockElement = {
      click: jest.fn(),
      type: jest.fn(),
      select: jest.fn(),
      hover: jest.fn(),
      scrollIntoView: jest.fn(),
      isIntersectingViewport: jest.fn().mockResolvedValue(true),
      evaluate: jest.fn(),
      press: jest.fn()
    };

    mockPage.waitForSelector.mockResolvedValue(mockElement);
    mockPage.$.mockResolvedValue(mockElement);
    mockPage.$$.mockResolvedValue([mockElement, mockElement]);
  });

  describe('Initialization', () => {
    test('should initialize with correct configuration', () => {
      expect(navigationEngine.config.elementWaitTimeout).toBe(5000);
      expect(navigationEngine.config.betweenNavigationDelay).toBe(1000);
      expect(navigationEngine.config.debugMode).toBe(true);
      expect(navigationEngine.config.retryAttempts).toBe(2);
    });

    test('should use default configuration values', () => {
      const defaultEngine = new NavigationEngine();
      expect(defaultEngine.config.elementWaitTimeout).toBe(10000);
      expect(defaultEngine.config.betweenNavigationDelay).toBe(7500);
      expect(defaultEngine.config.debugMode).toBe(false);
    });
  });

  describe('Element Waiting', () => {
    test('should wait for element successfully', async () => {
      const element = await navigationEngine.waitForElement(mockPage, '.test-selector');
      
      expect(mockPage.waitForSelector).toHaveBeenCalledWith('.test-selector', {
        timeout: 5000,
        visible: true
      });
      expect(element).toBeDefined();
    });

    test('should retry element waiting on failure', async () => {
      mockPage.waitForSelector
        .mockRejectedValueOnce(new Error('Element not found'))
        .mockResolvedValueOnce({ isIntersectingViewport: () => true });

      const element = await navigationEngine.waitForElement(mockPage, '.retry-selector');
      
      expect(mockPage.waitForSelector).toHaveBeenCalledTimes(2);
      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(1000);
      expect(element).toBeDefined();
    });

    test('should fail after max retry attempts', async () => {
      mockPage.waitForSelector.mockRejectedValue(new Error('Element not found'));

      await expect(navigationEngine.waitForElement(mockPage, '.fail-selector'))
        .rejects.toThrow('Failed to find element after 2 attempts');
    });
  });

  describe('Click Actions', () => {
    test('should click first element successfully', async () => {
      const result = await navigationEngine.clickFirst(mockPage, '.click-selector');
      
      expect(mockPage.waitForSelector).toHaveBeenCalled();
      expect(result.clickedElement).toBe('.click-selector');
      expect(result.timestamp).toBeDefined();
    });

    test('should perform random click on multiple elements', async () => {
      const result = await navigationEngine.randomClick(mockPage, '.random-selector');
      
      expect(mockPage.$$).toHaveBeenCalledWith('.random-selector');
      expect(result.clickedElement).toBe('.random-selector');
      expect(result.selectedIndex).toBeGreaterThanOrEqual(0);
      expect(result.totalElements).toBe(2);
    });

    test('should handle no elements found for random click', async () => {
      mockPage.$$.mockResolvedValue([]);
      
      await expect(navigationEngine.randomClick(mockPage, '.empty-selector'))
        .rejects.toThrow('No elements found for selector');
    });
  });

  describe('Text Input Actions', () => {
    test('should type text into input field', async () => {
      const mockElement = {
        click: jest.fn(),
        press: jest.fn(),
        type: jest.fn(),
        isIntersectingViewport: jest.fn().mockResolvedValue(true),
        evaluate: jest.fn()
      };
      
      mockPage.waitForSelector.mockResolvedValue(mockElement);
      
      const result = await navigationEngine.typeText(mockPage, '.input-selector', 'test text');
      
      expect(mockElement.click).toHaveBeenCalledWith({ clickCount: 3 });
      expect(mockElement.press).toHaveBeenCalledWith('Backspace');
      expect(mockElement.type).toHaveBeenCalledWith('test text', { delay: 100 });
      expect(result.text).toBe('test text');
    });
  });

  describe('Select Actions', () => {
    test('should select option from dropdown', async () => {
      const mockElement = {
        select: jest.fn(),
        isIntersectingViewport: jest.fn().mockResolvedValue(true),
        evaluate: jest.fn()
      };
      
      mockPage.waitForSelector.mockResolvedValue(mockElement);
      
      const result = await navigationEngine.selectOption(mockPage, '.select-selector', 'option1');
      
      expect(mockElement.select).toHaveBeenCalledWith('option1');
      expect(result.selectedValue).toBe('option1');
    });
  });

  describe('Hover Actions', () => {
    test('should hover over element', async () => {
      const mockElement = {
        hover: jest.fn(),
        isIntersectingViewport: jest.fn().mockResolvedValue(true),
        evaluate: jest.fn()
      };
      
      mockPage.waitForSelector.mockResolvedValue(mockElement);
      
      const result = await navigationEngine.hoverElement(mockPage, '.hover-selector');
      
      expect(mockElement.hover).toHaveBeenCalled();
      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(500);
      expect(result.selector).toBe('.hover-selector');
    });
  });

  describe('Scroll Actions', () => {
    test('should scroll element into view', async () => {
      const mockElement = {
        scrollIntoView: jest.fn(),
        isIntersectingViewport: jest.fn().mockResolvedValue(true),
        evaluate: jest.fn()
      };
      
      mockPage.waitForSelector.mockResolvedValue(mockElement);
      
      const result = await navigationEngine.scrollToElement(mockPage, '.scroll-selector');
      
      expect(mockElement.scrollIntoView).toHaveBeenCalledWith({ 
        behavior: 'smooth', 
        block: 'center' 
      });
      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(1000);
      expect(result.selector).toBe('.scroll-selector');
    });
  });

  describe('Navigation Sequence Execution', () => {
    test('should execute complete navigation sequence', async () => {
      const navigations = [
        { action: 'click_first', css: '.first-button' },
        { action: 'type_text', css: '.text-input', text: 'hello' },
        { action: 'select_option', css: '.dropdown', value: 'option1' }
      ];

      const results = await navigationEngine.executeNavigations(mockPage, navigations);
      
      expect(results).toHaveLength(3);
      expect(results[0].action).toBe('click_first');
      expect(results[1].action).toBe('type_text');
      expect(results[2].action).toBe('select_option');
      expect(results.every(r => r.status === 'success')).toBe(true);
    });

    test('should handle navigation failures with recovery', async () => {
      const navigations = [
        { action: 'click_first', css: '.working-button' },
        { action: 'click_first', css: '.failing-button' }
      ];

      // First navigation succeeds, second fails
      mockPage.waitForSelector
        .mockResolvedValueOnce({ 
          click: jest.fn(), 
          isIntersectingViewport: () => true,
          evaluate: jest.fn()
        })
        .mockRejectedValueOnce(new Error('Element not found'));

      const results = await navigationEngine.executeNavigations(mockPage, navigations);
      
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('success');
      expect(results[1].status).toBe('failed');
      expect(results[1].recovery).toBeDefined();
    });

    test('should stop on critical errors', async () => {
      const navigations = [
        { action: 'click_first', css: '.button1' },
        { action: 'click_first', css: '.button2' }
      ];

      mockPage.waitForSelector
        .mockResolvedValueOnce({ 
          click: jest.fn(), 
          isIntersectingViewport: () => true,
          evaluate: jest.fn()
        })
        .mockRejectedValueOnce(new Error('page crashed'));

      await expect(navigationEngine.executeNavigations(mockPage, navigations))
        .rejects.toThrow('page crashed');
    });
  });

  describe('Error Recovery', () => {
    test('should attempt page reload for stale element error', async () => {
      const error = new Error('stale element reference');
      const navigation = { action: 'click_first', css: '.stale-element' };

      const recovery = await navigationEngine.attemptErrorRecovery(mockPage, navigation, error);
      
      expect(mockPage.reload).toHaveBeenCalledWith({ waitUntil: 'networkidle2' });
      expect(recovery.strategy).toBe('page_reload');
      expect(recovery.success).toBe(true);
    });

    test('should attempt scrolling for visibility errors', async () => {
      const error = new Error('element not visible');
      const navigation = { action: 'click_first', css: '.hidden-element' };

      mockPage.evaluate.mockResolvedValue();

      const recovery = await navigationEngine.attemptErrorRecovery(mockPage, navigation, error);
      
      expect(mockPage.evaluate).toHaveBeenCalled();
      expect(recovery.strategy).toBe('scroll_page');
    });

    test('should identify critical errors correctly', () => {
      expect(navigationEngine.isCriticalError(new Error('page crashed'))).toBe(true);
      expect(navigationEngine.isCriticalError(new Error('browser disconnected'))).toBe(true);
      expect(navigationEngine.isCriticalError(new Error('element not found'))).toBe(false);
    });
  });

  describe('Statistics and Configuration', () => {
    test('should provide navigation statistics', () => {
      const stats = navigationEngine.getStatistics();
      
      expect(stats.config).toBeDefined();
      expect(stats.supportedActions).toContain('click_first');
      expect(stats.supportedActions).toContain('random_click');
      expect(stats.supportedActions).toContain('type_text');
      expect(stats.timestamp).toBeDefined();
    });

    test('should support all required action types', () => {
      const stats = navigationEngine.getStatistics();
      const expectedActions = [
        'click_first',
        'random_click',
        'type_text',
        'select_option',
        'hover',
        'scroll_to'
      ];
      
      expectedActions.forEach(action => {
        expect(stats.supportedActions).toContain(action);
      });
    });
  });
});
