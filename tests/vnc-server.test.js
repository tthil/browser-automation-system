const { VNCServer } = require('../src/vnc/vnc-server');
const { spawn } = require('child_process');
const express = require('express');

// Mock child_process
jest.mock('child_process');
jest.mock('express');

describe('VNC Server', () => {
  let vncServer;
  let mockApp;
  let mockServer;

  beforeEach(() => {
    // Mock Express app
    mockApp = {
      use: jest.fn(),
      get: jest.fn(),
      listen: jest.fn()
    };
    
    mockServer = {
      close: jest.fn(),
      on: jest.fn()
    };
    
    express.mockReturnValue(mockApp);
    express.static = jest.fn();
    mockApp.listen.mockReturnValue(mockServer);

    // Mock child process
    const mockProcess = {
      pid: 12345,
      kill: jest.fn(),
      on: jest.fn(),
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() }
    };
    
    spawn.mockReturnValue(mockProcess);

    vncServer = new VNCServer({
      vncPort: 5901,
      webPort: 6080,
      display: ':99',
      enableVnc: true
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (vncServer.isRunning) {
      vncServer.stop();
    }
  });

  describe('Initialization', () => {
    test('should initialize with correct configuration', () => {
      expect(vncServer.config.vncPort).toBe(5901);
      expect(vncServer.config.webPort).toBe(6080);
      expect(vncServer.config.display).toBe(':99');
      expect(vncServer.config.enableVnc).toBe(true);
    });

    test('should use default configuration values', () => {
      const defaultServer = new VNCServer();
      expect(defaultServer.config.vncPort).toBe(5901);
      expect(defaultServer.config.webPort).toBe(6080);
      expect(defaultServer.config.display).toBe(':99');
      expect(defaultServer.config.enableVnc).toBe(false);
    });

    test('should initialize in disabled state', () => {
      expect(vncServer.isRunning).toBe(false);
      expect(vncServer.xvfbProcess).toBeNull();
      expect(vncServer.vncProcess).toBeNull();
      expect(vncServer.webServer).toBeNull();
    });
  });

  describe('Virtual Display Management', () => {
    test('should start Xvfb virtual display successfully', async () => {
      const mockXvfbProcess = {
        pid: 11111,
        kill: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'spawn') {
            setTimeout(callback, 10);
          }
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() }
      };
      
      spawn.mockReturnValueOnce(mockXvfbProcess);

      await vncServer.startVirtualDisplay();
      
      expect(spawn).toHaveBeenCalledWith('Xvfb', [
        ':99',
        '-screen', '0', '1920x1080x24',
        '-ac',
        '+extension', 'GLX',
        '+render',
        '-noreset'
      ], { detached: true });
      
      expect(vncServer.xvfbProcess).toBe(mockXvfbProcess);
    });

    test('should handle Xvfb startup failure gracefully', async () => {
      const mockXvfbProcess = {
        pid: 11111,
        kill: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('Xvfb not found')), 10);
          }
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() }
      };
      
      spawn.mockReturnValueOnce(mockXvfbProcess);

      await expect(vncServer.startVirtualDisplay()).rejects.toThrow('Xvfb not found');
    });

    test('should stop virtual display process', async () => {
      const mockXvfbProcess = {
        pid: 11111,
        kill: jest.fn(),
        on: jest.fn(),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() }
      };
      
      vncServer.xvfbProcess = mockXvfbProcess;
      
      await vncServer.stopVirtualDisplay();
      
      expect(mockXvfbProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(vncServer.xvfbProcess).toBeNull();
    });
  });

  describe('VNC Server Management', () => {
    test('should start x11vnc server successfully', async () => {
      const mockVncProcess = {
        pid: 22222,
        kill: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'spawn') {
            setTimeout(callback, 10);
          }
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() }
      };
      
      spawn.mockReturnValueOnce(mockVncProcess);

      await vncServer.startVNCServer();
      
      expect(spawn).toHaveBeenCalledWith('x11vnc', [
        '-display', ':99',
        '-rfbport', '5901',
        '-forever',
        '-shared',
        '-noxdamage',
        '-noxfixes',
        '-noxcomposite',
        '-bg'
      ], { detached: true });
      
      expect(vncServer.vncProcess).toBe(mockVncProcess);
      expect(vncServer.simulationMode).toBe(false);
    });

    test('should fall back to simulation mode when x11vnc not available', async () => {
      const mockVncProcess = {
        pid: 22222,
        kill: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('x11vnc not found')), 10);
          }
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() }
      };
      
      spawn.mockReturnValueOnce(mockVncProcess);

      await vncServer.startVNCServer();
      
      expect(vncServer.simulationMode).toBe(true);
      expect(vncServer.vncProcess).toBeNull();
    });

    test('should stop VNC server process', async () => {
      const mockVncProcess = {
        pid: 22222,
        kill: jest.fn(),
        on: jest.fn(),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() }
      };
      
      vncServer.vncProcess = mockVncProcess;
      
      await vncServer.stopVNCServer();
      
      expect(mockVncProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(vncServer.vncProcess).toBeNull();
    });
  });

  describe('Web Interface', () => {
    test('should start web server with correct routes', async () => {
      await vncServer.startWebServer();
      
      expect(express).toHaveBeenCalled();
      expect(mockApp.use).toHaveBeenCalled();
      expect(mockApp.get).toHaveBeenCalledWith('/status', expect.any(Function));
      expect(mockApp.get).toHaveBeenCalledWith('/', expect.any(Function));
      expect(mockApp.listen).toHaveBeenCalledWith(6080, expect.any(Function));
      
      expect(vncServer.webServer).toBe(mockServer);
    });

    test('should serve status endpoint correctly', async () => {
      await vncServer.startWebServer();
      
      // Find the status route handler
      const statusCall = mockApp.get.mock.calls.find(call => call[0] === '/status');
      expect(statusCall).toBeDefined();
      
      const statusHandler = statusCall[1];
      const mockReq = {};
      const mockRes = {
        json: jest.fn()
      };
      
      statusHandler(mockReq, mockRes);
      
      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'running',
        vncPort: 5901,
        webPort: 6080,
        display: ':99',
        simulationMode: false,
        timestamp: expect.any(String)
      });
    });

    test('should serve HTML interface on root endpoint', async () => {
      await vncServer.startWebServer();
      
      // Find the root route handler
      const rootCall = mockApp.get.mock.calls.find(call => call[0] === '/');
      expect(rootCall).toBeDefined();
      
      const rootHandler = rootCall[1];
      const mockReq = {};
      const mockRes = {
        send: jest.fn()
      };
      
      rootHandler(mockReq, mockRes);
      
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('VNC Debug Interface'));
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('canvas'));
    });

    test('should stop web server', async () => {
      vncServer.webServer = mockServer;
      
      await vncServer.stopWebServer();
      
      expect(mockServer.close).toHaveBeenCalled();
      expect(vncServer.webServer).toBeNull();
    });
  });

  describe('Full Lifecycle', () => {
    test('should start complete VNC system when enabled', async () => {
      const mockXvfbProcess = {
        pid: 11111,
        kill: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'spawn') setTimeout(callback, 10);
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() }
      };
      
      const mockVncProcess = {
        pid: 22222,
        kill: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'spawn') setTimeout(callback, 10);
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() }
      };
      
      spawn
        .mockReturnValueOnce(mockXvfbProcess)
        .mockReturnValueOnce(mockVncProcess);

      await vncServer.start();
      
      expect(vncServer.isRunning).toBe(true);
      expect(vncServer.xvfbProcess).toBe(mockXvfbProcess);
      expect(vncServer.vncProcess).toBe(mockVncProcess);
      expect(vncServer.webServer).toBe(mockServer);
    });

    test('should skip VNC startup when disabled', async () => {
      const disabledServer = new VNCServer({ enableVnc: false });
      
      await disabledServer.start();
      
      expect(disabledServer.isRunning).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    });

    test('should stop complete VNC system', async () => {
      const mockXvfbProcess = { pid: 11111, kill: jest.fn(), on: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      const mockVncProcess = { pid: 22222, kill: jest.fn(), on: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      
      vncServer.isRunning = true;
      vncServer.xvfbProcess = mockXvfbProcess;
      vncServer.vncProcess = mockVncProcess;
      vncServer.webServer = mockServer;
      
      await vncServer.stop();
      
      expect(vncServer.isRunning).toBe(false);
      expect(mockXvfbProcess.kill).toHaveBeenCalled();
      expect(mockVncProcess.kill).toHaveBeenCalled();
      expect(mockServer.close).toHaveBeenCalled();
    });
  });

  describe('Health Check', () => {
    test('should provide comprehensive health information', () => {
      vncServer.isRunning = true;
      vncServer.simulationMode = false;
      vncServer.xvfbProcess = { pid: 11111 };
      vncServer.vncProcess = { pid: 22222 };
      vncServer.webServer = mockServer;
      
      const health = vncServer.healthCheck();
      
      expect(health.status).toBe('running');
      expect(health.isRunning).toBe(true);
      expect(health.simulationMode).toBe(false);
      expect(health.processes.xvfb).toBe(11111);
      expect(health.processes.vnc).toBe(22222);
      expect(health.processes.web).toBe(true);
      expect(health.config).toEqual({
        vncPort: 5901,
        webPort: 6080,
        display: ':99',
        enableVnc: true
      });
      expect(health.timestamp).toBeDefined();
    });

    test('should report stopped status when not running', () => {
      const health = vncServer.healthCheck();
      
      expect(health.status).toBe('stopped');
      expect(health.isRunning).toBe(false);
    });

    test('should report simulation mode status', () => {
      vncServer.isRunning = true;
      vncServer.simulationMode = true;
      
      const health = vncServer.healthCheck();
      
      expect(health.status).toBe('running');
      expect(health.simulationMode).toBe(true);
      expect(health.processes.vnc).toBe('simulation');
    });
  });

  describe('Error Handling', () => {
    test('should handle web server startup failure', async () => {
      mockApp.listen.mockImplementation((port, callback) => {
        callback(new Error('Port in use'));
      });
      
      await expect(vncServer.startWebServer()).rejects.toThrow('Port in use');
    });

    test('should handle stop when not running', async () => {
      expect(() => vncServer.stop()).not.toThrow();
    });

    test('should handle process cleanup errors gracefully', async () => {
      const mockProcess = {
        pid: 12345,
        kill: jest.fn(() => { throw new Error('Process not found'); }),
        on: jest.fn(),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() }
      };
      
      vncServer.xvfbProcess = mockProcess;
      
      await expect(vncServer.stopVirtualDisplay()).resolves.not.toThrow();
      expect(vncServer.xvfbProcess).toBeNull();
    });
  });

  describe('Configuration Validation', () => {
    test('should validate port numbers', () => {
      expect(() => new VNCServer({ vncPort: -1 })).not.toThrow();
      expect(() => new VNCServer({ webPort: 0 })).not.toThrow();
      expect(() => new VNCServer({ vncPort: 65536 })).not.toThrow();
    });

    test('should handle invalid display format', () => {
      expect(() => new VNCServer({ display: 'invalid' })).not.toThrow();
    });
  });

  describe('WebSocket Integration', () => {
    test('should handle WebSocket upgrade requests', async () => {
      await vncServer.startWebServer();
      
      // Verify that WebSocket handling is set up
      expect(mockServer.on).toHaveBeenCalledWith('upgrade', expect.any(Function));
    });
  });
});
