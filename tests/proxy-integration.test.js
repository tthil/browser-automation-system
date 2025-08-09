const { DataImpulseClient } = require('../src/proxy/dataimpulse-client');
const { ProxyManager } = require('../src/proxy/proxy-manager');

// Mock axios for testing
jest.mock('axios');
const axios = require('axios');

// Mock database connection
jest.mock('../database/connection', () => ({
  db: {
    query: jest.fn().mockResolvedValue({ rows: [{ total_requests: 10, successful_requests: 8, failed_requests: 2, success_rate: 0.8, last_request: new Date() }] })
  }
}));

describe('DataImpulse Proxy Integration', () => {
  let dataimpulseClient;
  let proxyManager;

  beforeEach(() => {
    // Set up environment variables
    process.env.DATAIMPULSE_API_KEY = 'test_api_key';
    process.env.DATAIMPULSE_BASE_URL = 'https://api.test.com';
    process.env.DATAIMPULSE_TIMEOUT = '30000';
    process.env.DATAIMPULSE_MAX_RETRIES = '3';

    dataimpulseClient = new DataImpulseClient();
    proxyManager = new ProxyManager();

    // Reset axios mock
    axios.create.mockReturnValue({
      post: jest.fn(),
      get: jest.fn()
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('DataImpulse Client', () => {
    test('should initialize with correct configuration', () => {
      expect(dataimpulseClient.apiKey).toBe('test_api_key');
      expect(dataimpulseClient.baseUrl).toBe('https://api.test.com');
      expect(dataimpulseClient.timeout).toBe(30000);
      expect(dataimpulseClient.maxRetries).toBe(3);
    });

    test('should validate configuration correctly', () => {
      expect(() => dataimpulseClient.validateConfig()).not.toThrow();
      
      // Test missing API key
      dataimpulseClient.apiKey = null;
      expect(() => dataimpulseClient.validateConfig()).toThrow('DATAIMPULSE_API_KEY environment variable is required');
    });

    test('should map country codes correctly', () => {
      expect(dataimpulseClient.countryMapping['ca']).toBe('canada');
      expect(dataimpulseClient.countryMapping['de']).toBe('germany');
      expect(dataimpulseClient.countryMapping['ch']).toBe('switzerland');
      expect(dataimpulseClient.countryMapping['sg']).toBe('singapore');
      expect(dataimpulseClient.countryMapping['hk']).toBe('hong_kong');
    });

    test('should get proxy for valid country', async () => {
      const mockResponse = {
        data: {
          id: 'proxy_123',
          proxy: {
            host: '1.2.3.4',
            port: '8080',
            username: 'user',
            password: 'pass',
            protocol: 'http'
          }
        }
      };

      dataimpulseClient.axiosInstance.post.mockResolvedValue(mockResponse);

      const proxy = await dataimpulseClient.getProxy('CA');

      expect(proxy).toMatchObject({
        host: '1.2.3.4',
        port: 8080,
        username: 'user',
        password: 'pass',
        country: 'CA',
        protocol: 'http'
      });
    });

    test('should handle both uppercase and lowercase country codes', async () => {
      const mockResponse = {
        data: {
          id: 'proxy_123',
          proxy: {
            host: '1.2.3.4',
            port: '8080',
            username: 'user',
            password: 'pass',
            protocol: 'http'
          }
        }
      };

      dataimpulseClient.axiosInstance.post.mockResolvedValue(mockResponse);

      // Test uppercase
      const proxyUpper = await dataimpulseClient.getProxy('CA');
      expect(proxyUpper.country).toBe('CA');

      // Test lowercase
      const proxyLower = await dataimpulseClient.getProxy('ca');
      expect(proxyLower.country).toBe('ca');

      // Both should work with the same underlying country mapping
      expect(dataimpulseClient.axiosInstance.post).toHaveBeenCalledTimes(2);
    });

    test('should handle proxy request failure with retry', async () => {
      dataimpulseClient.axiosInstance.post
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue({
          data: {
            id: 'proxy_123',
            proxy: {
              host: '1.2.3.4',
              port: '8080',
              username: 'user',
              password: 'pass'
            }
          }
        });

      const proxy = await dataimpulseClient.getProxy('CA');
      expect(proxy.host).toBe('1.2.3.4');
      expect(dataimpulseClient.axiosInstance.post).toHaveBeenCalledTimes(3);
    });

    test('should fail after max retries', async () => {
      dataimpulseClient.axiosInstance.post.mockRejectedValue(new Error('Network error'));

      await expect(dataimpulseClient.getProxy('CA')).rejects.toThrow('Failed to get proxy for CA after 4 attempts');
      expect(dataimpulseClient.axiosInstance.post).toHaveBeenCalledTimes(4);
    });

    test('should parse proxy response correctly', () => {
      const responseData = {
        id: 'proxy_123',
        proxy: {
          host: '1.2.3.4',
          port: '8080',
          username: 'user',
          password: 'pass',
          protocol: 'http',
          type: 'datacenter',
          location: 'canada'
        }
      };

      const parsed = dataimpulseClient.parseProxyResponse(responseData, 'CA');

      expect(parsed).toMatchObject({
        id: 'proxy_123',
        host: '1.2.3.4',
        port: 8080,
        username: 'user',
        password: 'pass',
        country: 'CA',
        protocol: 'http',
        type: 'datacenter',
        location: 'canada'
      });
      expect(parsed.acquired).toBeInstanceOf(Date);
      expect(parsed.expires).toBeInstanceOf(Date);
    });

    test('should get proxy statistics', async () => {
      const stats = await dataimpulseClient.getProxyStats('CA');

      expect(stats).toMatchObject({
        country: 'CA',
        totalRequests: 10,
        successfulRequests: 8,
        failedRequests: 2,
        successRate: 0.8
      });
    });

    test('should perform health check', async () => {
      dataimpulseClient.axiosInstance.get.mockResolvedValue({
        headers: { 'x-response-time': '100ms' }
      });

      const health = await dataimpulseClient.healthCheck();

      expect(health).toMatchObject({
        status: 'healthy',
        apiKey: 'configured',
        baseUrl: 'https://api.test.com',
        responseTime: '100ms'
      });
    });
  });

  describe('Proxy Manager', () => {
    test('should initialize proxy manager', () => {
      expect(proxyManager.dataimpulse).toBeInstanceOf(DataImpulseClient);
      expect(proxyManager.activeProxies).toBeInstanceOf(Map);
      expect(proxyManager.proxyPool).toBeInstanceOf(Map);
    });

    test('should generate Puppeteer proxy configuration', () => {
      const proxyConfig = {
        protocol: 'http',
        host: '1.2.3.4',
        port: 8080,
        username: 'user',
        password: 'pass'
      };

      const puppeteerConfig = proxyManager.getPuppeteerProxyConfig(proxyConfig);

      expect(puppeteerConfig).toEqual({
        server: 'http://1.2.3.4:8080',
        username: 'user',
        password: 'pass'
      });
    });

    test('should generate proxy arguments for Chrome', () => {
      const proxyConfig = {
        protocol: 'http',
        host: '1.2.3.4',
        port: 8080
      };

      const args = proxyManager.getProxyArgs(proxyConfig);

      expect(args).toContain('--proxy-server=http://1.2.3.4:8080');
      expect(args).toContain('--proxy-bypass-list=<-loopback>');
      expect(args).toContain('--disable-web-security');
    });

    test('should validate proxy expiration', () => {
      const validProxy = {
        expires: new Date(Date.now() + 3600000) // 1 hour from now
      };

      const expiredProxy = {
        expires: new Date(Date.now() - 3600000) // 1 hour ago
      };

      expect(proxyManager.isProxyValid(validProxy)).toBe(true);
      expect(proxyManager.isProxyValid(expiredProxy)).toBe(false);
      expect(proxyManager.isProxyValid(null)).toBe(false);
      expect(proxyManager.isProxyValid({})).toBe(false);
    });

    test('should manage proxy pool correctly', () => {
      const proxy1 = { host: '1.2.3.4', port: 8080, expires: new Date(Date.now() + 3600000) };
      const proxy2 = { host: '5.6.7.8', port: 8080, expires: new Date(Date.now() + 3600000) };

      // Add proxies to pool
      proxyManager.addToPool('CA', proxy1);
      proxyManager.addToPool('CA', proxy2);

      expect(proxyManager.proxyPool.get('CA')).toHaveLength(2);

      // Get proxy from pool
      const retrieved = proxyManager.getFromPool('CA');
      expect(retrieved).toMatchObject(proxy1);
      expect(proxyManager.proxyPool.get('CA')).toHaveLength(1);
    });

    test('should perform health check', async () => {
      // Mock dataimpulse health check
      jest.spyOn(proxyManager.dataimpulse, 'healthCheck').mockResolvedValue({
        status: 'healthy',
        apiKey: 'configured'
      });

      const health = await proxyManager.healthCheck();

      expect(health).toMatchObject({
        status: 'healthy',
        dataimpulse: {
          status: 'healthy',
          apiKey: 'configured'
        },
        activeProxies: 0,
        pooledProxies: 0,
        rotationActive: false
      });
    });
  });

  describe('Integration Tests', () => {
    test('should handle full proxy workflow', async () => {
      // Mock successful proxy request
      const mockProxy = {
        id: 'proxy_123',
        host: '1.2.3.4',
        port: 8080,
        username: 'user',
        password: 'pass',
        country: 'CA',
        protocol: 'http',
        expires: new Date(Date.now() + 3600000)
      };

      jest.spyOn(proxyManager.dataimpulse, 'getProxy').mockResolvedValue(mockProxy);
      jest.spyOn(proxyManager.dataimpulse, 'validateProxy').mockResolvedValue(true);

      // Get proxy for country
      const proxy = await proxyManager.getProxyForCountry('CA');

      expect(proxy).toMatchObject(mockProxy);
      expect(proxyManager.activeProxies.has('CA')).toBe(true);

      // Generate Puppeteer config
      const puppeteerConfig = proxyManager.getPuppeteerProxyConfig(proxy);
      expect(puppeteerConfig.server).toBe('http://1.2.3.4:8080');

      // Rotate proxy - clear the proxy pool first to force new proxy fetch
      proxyManager.proxyPool.delete('CA');
      jest.spyOn(proxyManager.dataimpulse, 'releaseProxy').mockResolvedValue();
      const newProxy = { ...mockProxy, host: '9.10.11.12' };
      
      // Clear the existing mock and set up new one for rotation
      proxyManager.dataimpulse.getProxy.mockClear();
      proxyManager.dataimpulse.getProxy.mockResolvedValue(newProxy);
      proxyManager.dataimpulse.validateProxy.mockResolvedValue(true);

      const rotatedProxy = await proxyManager.rotateProxy('CA');
      expect(rotatedProxy.host).toBe('9.10.11.12');
    });

    test('should handle proxy failures gracefully', async () => {
      jest.spyOn(proxyManager.dataimpulse, 'getProxy').mockRejectedValue(new Error('API Error'));

      await expect(proxyManager.getProxyForCountry('CA')).rejects.toThrow('API Error');
      expect(proxyManager.activeProxies.has('CA')).toBe(false);
    });
  });
});
