# Product Requirements Document
## Browser Automation Testing System

**Version:** 1.0  
**Date:** August 2025  
**Status:** Draft

## 14. VNC Debugging Guide

### 14.1 Overview
The Worker service includes VNC (Virtual Network Computing) support for visual debugging of browser automation. This allows developers to see exactly what's happening in the browser during task execution.

### 14.2 Operating Modes

#### Production Mode (Default)
- `ENABLE_VNC=false`
- `DEBUG_MODE=false`
- `HEADLESS=true`
- Maximum performance, no visual output
- Suitable for production workloads

#### Debug Mode
- `ENABLE_VNC=true`
- `DEBUG_MODE=true`
- `HEADLESS=false`
- Visual indicators (red borders, mouse cursor)
- Additional delays for observation
- Enhanced logging of all actions

#### Local Mode
- Same as Debug Mode but optimized for local development
- Single worker instance
- Direct VNC access on localhost

### 14.3 Connecting to VNC

#### Local Development

##### Using VNC Viewer
1. Install a VNC client (recommended clients):
   - **macOS**: RealVNC Viewer, TigerVNC
   - **Windows**: TightVNC, UltraVNC
   - **Linux**: Remmina, TigerVNC

2. Connect to VNC:
   ```
   VNC Server: localhost:5901
   Password: (no password required in development)
   ```

3. Worker will log on startup:
   ```
   VNC server started on port 5901
   Connect using VNC viewer to: localhost:5901
   ```

##### Using NoVNC (Web Browser)
1. Open browser and navigate to:
   ```
   http://localhost:6080
   ```

2. NoVNC will auto-connect to the VNC server

3. You'll see the browser window in your web browser

#### Production Debugging

##### Enable Debug Mode
1. Update the worker deployment:
   ```bash
   kubectl set env deployment/automation-worker \
     ENABLE_VNC=true \
     DEBUG_MODE=true \
     HEADLESS=false
   ```

2. Wait for pods to restart:
   ```bash
   kubectl rollout status deployment/automation-worker
   ```

##### Access VNC via NodePort
```bash
# Get node IP
kubectl get nodes -o wide

# Access VNC on NodePort
# VNC: <node-ip>:30901
# NoVNC: http://<node-ip>:30080
```

##### Access VNC via Port Forwarding
```bash
# Forward VNC port
kubectl port-forward deployment/automation-worker 5901:5901

# Or forward NoVNC web interface
kubectl port-forward deployment/automation-novnc 6080:6080
```

### 14.4 Debug Mode Features

#### Visual Indicators
1. **Element Highlighting**: Before clicking, elements are highlighted with:
   - Red border (3px solid)
   - Light red background overlay
   - 2-second display duration

2. **Mouse Cursor Visualization**: 
   - Red circular cursor shows mouse position
   - Visible during mouse movements
   - Helps track click locations

3. **Action Delays**:
   - 2 seconds before each click (observe target)
   - 3 seconds after each click (see result)
   - Configurable via environment variables

#### Enhanced Logging
When `DEBUG_MODE=true`, the worker logs:
- Every Puppeteer action with timestamp
- Element details (tag, text, position)
- CSS selector attempts
- Network requests and responses
- Navigation events
- Error details with stack traces

Example debug log output:
```
[DEBUG] Navigation attempt: {
  selector: '.products',
  action: 'random_click',
  timestamp: '2025-08-10T22:45:00Z'
}
[DEBUG] Element found: {
  tagName: 'DIV',
  text: 'Product Gallery',
  visible: true,
  position: { x: 100, y: 200, width: 800, height: 400 }
}
[DEBUG] Network request: https://example.com/api/products
[DEBUG] Network response: 200 https://example.com/api/products
```

### 14.5 Troubleshooting VNC

#### VNC Server Won't Start
1. Check Xvfb is running:
   ```bash
   docker exec automation-worker ps aux | grep Xvfb
   ```

2. Verify DISPLAY environment:
   ```bash
   docker exec automation-worker echo $DISPLAY
   # Should output: :99
   ```

3. Check VNC server logs:
   ```bash
   docker logs automation-worker | grep VNC
   ```

#### Can't Connect to VNC
1. Verify port is exposed:
   ```bash
   docker ps | grep 5901
   ```

2. Check firewall rules (production):
   ```bash
   kubectl get svc automation-worker-vnc
   ```

3. Test local connection:
   ```bash
   telnet localhost 5901
   ```

#### Black Screen in VNC
1. Ensure browser is running:
   - Check if task is being processed
   - Verify Puppeteer launched successfully

2. Check display configuration:
   - Verify XVFB_WHD is set correctly
   - Ensure resolution matches viewport

#### Performance Issues with VNC
1. VNC adds overhead, expect:
   - 10-15% CPU increase
   - 100-200MB additional memory
   - Slight network latency

2. Optimization tips:
   - Use local VNC viewer instead of NoVNC
   - Reduce color depth if needed
   - Disable VNC when not debugging

### 14.6 Best Practices

1. **Development**: Always use VNC for new navigation sequences
2. **Testing**: Enable DEBUG_MODE to verify selectors
3. **Production**: Keep VNC disabled unless investigating issues
4. **Security**: In production, use port-forwarding instead of NodePort when possible
5. **Resource Management**: Remember to disable VNC after debugging to free resources

### 14.7 Quick Reference

#### Enable Debugging Locally
```bash
# In docker-compose.yml or .env
ENABLE_VNC=true
DEBUG_MODE=true
HEADLESS=false

# Start services
docker-compose up worker novnc

# Connect
# VNC: localhost:5901
# NoVNC: http://localhost:6080
```

#### Enable Debugging in Production
```bash
# Quick enable
kubectl set env deployment/automation-worker \
  ENABLE_VNC=true DEBUG_MODE=true HEADLESS=false

# Port forward
kubectl port-forward deployment/automation-worker 5901:5901

# Connect VNC client to localhost:5901

# Disable when done
kubectl set env deployment/automation-worker \
  ENABLE_VNC=false DEBUG_MODE=false HEADLESS=true
```

---

## 1. Executive Summary

### 1.1 Purpose
This document outlines the requirements for a distributed browser automation testing system that simulates user navigation patterns from various global locations. The system tests web page functionality by executing predefined navigation sequences through different devices, operating systems, and geographical locations using proxy servers.

### 1.2 Scope
The system consists of two primary microservices:
- **Client Service**: Manages session processing, task distribution, and response tracking
- **Worker Service**: Executes browser automation tasks using Puppeteer with proxy servers

### 1.3 Goals
- Test web page navigation from multiple global locations
- Simulate realistic user behavior across different devices and operating systems
- Distribute testing load evenly over 24-hour periods
- Track success rates and failures for navigation sequences

---

## 2. System Architecture

### 2.1 High-Level Architecture
```
[Session Queue] → [Client Service] → [RabbitMQ RPC] → [Worker Service(s)]
                         ↓                                      ↓
                   [PostgreSQL]                          [DataImpulse API]
                                                               ↓
                                                          [Puppeteer]
```

### 2.2 Technology Stack
- **Message Broker**: RabbitMQ (with RPC pattern)
- **Runtime**: Node.js
- **Database**: PostgreSQL
- **Browser Automation**: Puppeteer
- **Fingerprinting**: fingerprint-injector npm package
- **Proxy Service**: DataImpulse API
- **Container**: Docker
- **Orchestration**: Kubernetes (production)
- **Deployment**: DigitalOcean
- **RabbitMQ Library**: amqplib

### 2.3 Service Communication
- Client and Worker communicate using RabbitMQ RPC pattern
- Client sends tasks to "tasks" queue
- Worker responds with results via reply queue
- All queues are durable/persistent

---

## 3. Client Service Specifications

### 3.1 Core Responsibilities
1. Listen to "sessions" queue for new session messages
2. Parse session configuration and generate tasks
3. Distribute tasks evenly over 24 hours
4. Send tasks to Workers via RPC
5. Track task responses and adjust sending rate
6. Persist state in PostgreSQL
7. Calculate and store statistics

### 3.2 Session Message Format
```json
{
  "tasks_24h": 8000,
  "countries": ["ca", "de", "ch", "sg", "hk"],
  "main_page_url": "https://example.com",
  "navigations": [
    {
      "css": "header > div > h2 > a",
      "action": "click_first"
    },
    {
      "css": ".e-n-tab-title",
      "action": "random_click"
    },
    {
      "css": ".products",
      "action": "random_click"
    }
  ],
  "mobile_desktop_distribution": "65:35",
  "mobile_os_distribution": "1:2",
  "desktop_os_distribution": "1:2"
}
```

### 3.3 Task Generation Logic

#### 3.3.1 Distribution Calculations
- **Countries**: Equal distribution (8000 tasks ÷ 5 countries = 1600 per country)
- **Devices**: 65% mobile (5200 tasks), 35% desktop (2800 tasks)
- **Mobile OS**: 33% iOS (1716 tasks), 67% Android (3484 tasks)
- **Desktop OS**: 33% Windows (924 tasks), 67% macOS (1876 tasks)

#### 3.3.2 Task Message Format
```json
{
  "correlation_id": "uuid-v4",
  "session_id": "session-uuid",
  "country": "ca",
  "device": "mobile",
  "os": "iOS",
  "main_page_url": "https://example.com",
  "navigations": [...],
  "timestamp": "2025-08-10T22:45:00Z"
}
```

### 3.4 Rate Management

#### 3.4.1 Initial Rate Calculation
- Base rate: 8000 tasks ÷ 24 hours = ~5.56 tasks/minute
- Implementation: Send 5-6 tasks per minute with randomization (±10-20 seconds)

#### 3.4.2 Dynamic Rate Adjustment
- Monitor average task completion time
- If completion faster than expected: Increase interval between sends
- If timeouts/failures occur: Decrease interval to ensure 8000 attempts in 24 hours
- Adjustment formula: `new_rate = (remaining_tasks / remaining_time) * adjustment_factor`

### 3.5 Error Handling
- Retry failed tasks up to 5 times
- Track retry count in database
- Implement exponential backoff for retries
- RPC timeout: 60 seconds per task
- Dead letter queue for permanently failed tasks

### 3.6 State Persistence
- Save all task states to PostgreSQL
- Recover from crashes using database state
- Maintain queue position for session processing

---

## 4. Worker Service Specifications

### 4.1 Core Responsibilities
1. Listen to "tasks" queue for RPC requests
2. Request proxy from DataImpulse API
3. Configure browser with fingerprint
4. Execute navigation sequence
5. Return results via RPC reply queue
6. **[VNC Mode]** Start VNC server for visual debugging
7. **[Debug Mode]** Provide visual indicators and enhanced logging

### 4.2 Processing Flow
```
1. Receive task message
2. Parse device/OS/country parameters
3. Request proxy from DataImpulse API
4. [VNC Mode] Start VNC server if enabled
5. Configure Puppeteer with proxy and fingerprint
6. Navigate to main_page_url
7. [Debug Mode] Add visual indicators and delays
8. Execute navigation sequence
9. Close browser
10. Send response via RPC
```

### 4.3 Proxy Management

#### 4.3.1 Proxy Request
```bash
curl -u '{deviceTypeUsername}:{deviceTypePassword}' \
  --location 'https://gw.dataimpulse.com:777/api/list?countries={countryCode}'
```

#### 4.3.2 Proxy Retry Logic
- Retry failed proxy requests up to 3 times
- On 3rd failure, fetch account stats:
```bash
curl -u '{deviceTypeUsername}:{deviceTypePassword}' \
  --location 'https://gw.dataimpulse.com:777/api/stats'
```
- Return proxy failure with stats to client

### 4.4 Browser Configuration

#### 4.4.1 Fingerprint Generation
- Use fingerprint-injector library
- Generate unique fingerprint per task based on:
  - Device type (mobile/desktop)
  - Operating system
  - Never reuse fingerprints

#### 4.4.2 Puppeteer Settings
```javascript
// Base configuration
const browserConfig = {
  headless: process.env.HEADLESS === 'true',
  args: [
    '--proxy-server=http://proxy-url',
    '--no-sandbox',
    '--disable-setuid-sandbox'
  ]
};

// Add display configuration for VNC mode
if (process.env.ENABLE_VNC === 'true') {
  browserConfig.headless = false;
  browserConfig.defaultViewport = {
    width: 1920,
    height: 1080
  };
  browserConfig.args.push('--display=:99');
}
```

#### 4.4.3 Debug Mode Visual Indicators
When `DEBUG_MODE=true`, the Worker implements visual debugging features:

```javascript
// Highlight element before clicking
async function highlightElement(page, selector) {
  await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (element) {
      element.style.border = '3px solid red';
      element.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
    }
  }, selector);
}

// Show mouse movement
async function moveMouseWithVisual(page, x, y) {
  // Create visual cursor if in debug mode
  if (process.env.DEBUG_MODE === 'true') {
    await page.evaluate((x, y) => {
      const cursor = document.createElement('div');
      cursor.style.position = 'fixed';
      cursor.style.width = '20px';
      cursor.style.height = '20px';
      cursor.style.borderRadius = '50%';
      cursor.style.backgroundColor = 'red';
      cursor.style.zIndex = '999999';
      cursor.style.left = x + 'px';
      cursor.style.top = y + 'px';
      cursor.style.pointerEvents = 'none';
      cursor.id = 'debug-cursor';
      
      // Remove old cursor if exists
      const oldCursor = document.getElementById('debug-cursor');
      if (oldCursor) oldCursor.remove();
      
      document.body.appendChild(cursor);
      
      // Remove after 2 seconds
      setTimeout(() => cursor.remove(), 2000);
    }, x, y);
  }
  
  await page.mouse.move(x, y);
}
```

### 4.5 Navigation Execution

#### 4.5.1 Action Types
- **click_first**: Click first element matching CSS selector
- **random_click**: Randomly select and click one matching element

#### 4.5.2 Navigation Flow
1. Wait for current navigation target element to be present
2. **[Debug Mode]** Highlight element with red border for 2 seconds
3. **[Debug Mode]** Show mouse movement to element
4. **[Debug Mode]** Wait 2 seconds before clicking
5. Execute action (click)
6. **[Debug Mode]** Wait 3 seconds after clicking
7. Wait for navigation event
8. If not last navigation, wait for next target element
9. Add 5-10 second delay between navigations
10. Continue until all navigations complete

##### Debug Mode Delays
When `DEBUG_MODE=true`:
- Pre-click delay: 2 seconds (for observation)
- Post-click delay: 3 seconds (to see result)
- Element highlight duration: 2 seconds
- Mouse cursor visual: 2 seconds

##### Enhanced Logging in Debug Mode
```javascript
if (process.env.DEBUG_MODE === 'true') {
  console.log('[DEBUG] Navigation attempt:', {
    selector: navigation.css,
    action: navigation.action,
    timestamp: new Date().toISOString()
  });
  
  // Log element details
  const elementInfo = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? {
      tagName: el.tagName,
      text: el.innerText?.substring(0, 50),
      visible: el.offsetParent !== null,
      position: el.getBoundingClientRect()
    } : null;
  }, navigation.css);
  
  console.log('[DEBUG] Element found:', elementInfo);
  
  // Log network activity
  page.on('request', request => {
    console.log('[DEBUG] Network request:', request.url());
  });
  
  page.on('response', response => {
    console.log('[DEBUG] Network response:', response.status(), response.url());
  });
}
```

#### 4.5.3 Success Criteria
- All navigation actions executed successfully
- Page changes detected after each action
- No timeouts or element not found errors

### 4.6 Response Formats

#### 4.6.1 Success Response
```json
{
  "status": "successful",
  "country": "ca",
  "device": "mobile",
  "os": "iOS",
  "timestamp": "2025-08-10T22:45:00Z"
}
```

#### 4.6.2 Navigation Failure Response
```json
{
  "status": "failure",
  "country": "ca",
  "device": "mobile",
  "os": "iOS",
  "timestamp": "2025-08-10T22:45:00Z",
  "navigation_failed": {
    "css": ".e-n-tab-title",
    "action": "random_click"
  }
}
```

#### 4.6.3 Proxy Failure Response
```json
{
  "status": "proxy_failure",
  "country": "ca",
  "device": "mobile",
  "os": "iOS",
  "timestamp": "2025-08-10T22:45:00Z",
  "proxy_error": "Proxy error: proxy server not available",
  "account_stats": {...}
}
```

---

## 5. Database Schema

### 5.1 Sessions Table
```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tasks_24h INTEGER NOT NULL,
  countries TEXT[] NOT NULL,
  main_page_url TEXT NOT NULL,
  navigations JSONB NOT NULL,
  mobile_desktop_distribution VARCHAR(10) NOT NULL,
  mobile_os_distribution VARCHAR(10) NOT NULL,
  desktop_os_distribution VARCHAR(10) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'pending'
);
```

### 5.2 Tasks Table
```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  correlation_id UUID NOT NULL UNIQUE,
  country VARCHAR(2) NOT NULL,
  device VARCHAR(10) NOT NULL,
  os VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  sent_at TIMESTAMP,
  completed_at TIMESTAMP,
  request JSONB,
  response JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tasks_session_id ON tasks(session_id);
CREATE INDEX idx_tasks_correlation_id ON tasks(correlation_id);
CREATE INDEX idx_tasks_status ON tasks(status);
```

### 5.3 Statistics Table
```sql
CREATE TABLE statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  country VARCHAR(2) NOT NULL,
  total_tasks INTEGER DEFAULT 0,
  successful_tasks INTEGER DEFAULT 0,
  failed_tasks INTEGER DEFAULT 0,
  proxy_failures INTEGER DEFAULT 0,
  avg_completion_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(session_id, country)
);

CREATE INDEX idx_statistics_session_country ON statistics(session_id, country);
```

---

## 6. Environment Configuration

### 6.1 Environment Variables

#### Client Service
```env
# RabbitMQ
RABBITMQ_URL=amqp://user:password@localhost:5672
SESSIONS_QUEUE=sessions
TASKS_QUEUE=tasks

# PostgreSQL
POSTGRES_CONNECTION_STRING=postgresql://user:password@localhost:5432/automation

# Timeouts
RPC_TIMEOUT=60000
TASK_RETRY_LIMIT=5

# Rate Management
BASE_TASKS_PER_MINUTE=5.56
RATE_ADJUSTMENT_INTERVAL=300000
```

#### Worker Service
```env
# RabbitMQ
RABBITMQ_URL=amqp://user:password@localhost:5672
TASKS_QUEUE=tasks

# DataImpulse API
DATAIMPULSE_API_URL=https://gw.dataimpulse.com:777
DEVICE_TYPE_USERNAME_MOBILE=mobile_username
DEVICE_TYPE_PASSWORD_MOBILE=mobile_password
DEVICE_TYPE_USERNAME_DESKTOP=desktop_username
DEVICE_TYPE_PASSWORD_DESKTOP=desktop_password

# Timeouts
NAVIGATION_TIMEOUT=30000
ELEMENT_WAIT_TIMEOUT=10000
BETWEEN_NAVIGATION_DELAY=7500

# Proxy
PROXY_RETRY_LIMIT=3

# Debug and VNC Configuration
ENABLE_VNC=false              # Set to true to enable VNC server
DEBUG_MODE=false              # Set to true for visual debugging
HEADLESS=true                 # Set to false when VNC is enabled
VNC_PORT=5901                 # VNC server port
DISPLAY=:99                   # X display number
XVFB_WHD=1920x1080x24        # Xvfb resolution

# Debug Delays (milliseconds)
DEBUG_PRE_CLICK_DELAY=2000    # Delay before clicking
DEBUG_POST_CLICK_DELAY=3000   # Delay after clicking
DEBUG_HIGHLIGHT_DURATION=2000 # Element highlight duration
```

---

## 7. Docker Configuration

### 7.1 Docker Compose (Local Development)
```yaml
version: '3.8'

services:
  rabbitmq:
    image: rabbitmq:3-management
    container_name: rabbitmq
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    networks:
      - automation-network

  postgres:
    image: postgres:15
    container_name: postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: automation
      POSTGRES_PASSWORD: automation
      POSTGRES_DB: automation
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    networks:
      - automation-network

  client:
    build:
      context: ./client
      dockerfile: Dockerfile
    container_name: automation-client
    depends_on:
      - rabbitmq
      - postgres
    environment:
      - RABBITMQ_URL=amqp://admin:admin@rabbitmq:5672
      - POSTGRES_CONNECTION_STRING=postgresql://automation:automation@postgres:5432/automation
    env_file:
      - ./client/.env
    volumes:
      - ./client:/app
      - /app/node_modules
    networks:
      - automation-network
    restart: unless-stopped

  worker:
    build:
      context: ./worker
      dockerfile: Dockerfile
    container_name: automation-worker
    depends_on:
      - rabbitmq
    environment:
      - RABBITMQ_URL=amqp://admin:admin@rabbitmq:5672
      - ENABLE_VNC=true
      - DEBUG_MODE=true
      - HEADLESS=false
      - VNC_PORT=5901
    env_file:
      - ./worker/.env
    ports:
      - "5901:5901"  # VNC port
    volumes:
      - ./worker:/app
      - /app/node_modules
    networks:
      - automation-network
    restart: unless-stopped

  novnc:
    build:
      context: ./novnc
      dockerfile: Dockerfile.novnc
    container_name: automation-novnc
    depends_on:
      - worker
    ports:
      - "6080:6080"  # NoVNC web interface
    environment:
      - VNC_HOST=worker
      - VNC_PORT=5901
    networks:
      - automation-network
    restart: unless-stopped

volumes:
  rabbitmq_data:
  postgres_data:

networks:
  automation-network:
    driver: bridge
```

### 7.2 Dockerfile (Worker Service)
```dockerfile
# Use Apify base image with Puppeteer and Chrome pre-installed
FROM apify/actor-node-puppeteer-chrome:20

# Switch to root to install additional packages
USER root

# Install VNC server and dependencies
RUN apt-get update && apt-get install -y \
    x11vnc \
    xvfb \
    fluxbox \
    && rm -rf /var/lib/apt/lists/*

# Copy package files with correct ownership
COPY --chown=myuser package*.json ./

# Install NPM packages
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Copy the remaining files
COPY --chown=myuser . ./

# Create start script for Xvfb
RUN echo '#!/bin/bash\n\
echo "Starting X virtual framebuffer using: Xvfb $DISPLAY -ac -screen 0 $XVFB_WHD -nolisten tcp"\n\
Xvfb $DISPLAY -ac -screen 0 $XVFB_WHD -nolisten tcp &\n\
\n\
# Start VNC server if enabled\n\
if [ "$ENABLE_VNC" = "true" ]; then\n\
    echo "Starting VNC server on port ${VNC_PORT:-5901}"\n\
    x11vnc -display $DISPLAY -forever -shared -rfbport ${VNC_PORT:-5901} -nopw &\n\
    echo "VNC server started on port ${VNC_PORT:-5901}"\n\
    echo "Connect using VNC viewer to: localhost:${VNC_PORT:-5901}"\n\
fi\n\
\n\
# Execute main command\n\
echo "Executing main command"\n\
exec "$@"' > /start_xvfb_and_run_cmd.sh && chmod +x /start_xvfb_and_run_cmd.sh

# Set environment variables
ENV DISPLAY=:99
ENV XVFB_WHD=1920x1080x24
ENV VNC_PORT=5901

# Start Xvfb, VNC (if enabled), and run the application
CMD ["/start_xvfb_and_run_cmd.sh", "node", "index.js"]
```

### 7.3 NoVNC Service (Docker Compose)
```dockerfile
# Dockerfile.novnc
FROM alpine:latest

RUN apk add --no-cache \
    bash \
    nginx \
    openssl \
    supervisor \
    && rm -rf /var/cache/apk/*

# Install noVNC
RUN wget -O /tmp/novnc.tar.gz https://github.com/novnc/noVNC/archive/v1.4.0.tar.gz \
    && tar -xzf /tmp/novnc.tar.gz -C /opt \
    && mv /opt/noVNC-1.4.0 /opt/novnc \
    && ln -s /opt/novnc/vnc.html /opt/novnc/index.html \
    && rm /tmp/novnc.tar.gz

# Configure nginx
RUN echo 'server {\n\
    listen 6080;\n\
    location / {\n\
        root /opt/novnc;\n\
        index index.html;\n\
    }\n\
    location /websockify {\n\
        proxy_pass http://localhost:6081;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Upgrade $http_upgrade;\n\
        proxy_set_header Connection "upgrade";\n\
    }\n\
}' > /etc/nginx/http.d/novnc.conf

EXPOSE 6080

CMD ["/opt/novnc/utils/novnc_proxy", "--vnc", "worker:5901", "--listen", "6080"]
```

---

## 8. Kubernetes Configuration (Production)

### 8.1 Worker Deployment with VNC Support
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: automation-worker
spec:
  replicas: 3
  selector:
    matchLabels:
      app: automation-worker
  template:
    metadata:
      labels:
        app: automation-worker
    spec:
      containers:
      - name: worker
        image: registry.digitalocean.com/automation/worker:latest
        envFrom:
        - secretRef:
            name: worker-secrets
        env:
        - name: ENABLE_VNC
          value: "false"  # Enable only when debugging
        - name: DEBUG_MODE
          value: "false"
        - name: HEADLESS
          value: "true"
        ports:
        - containerPort: 5901
          name: vnc
          protocol: TCP
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
---
# NodePort Service for VNC Access (only create when debugging)
apiVersion: v1
kind: Service
metadata:
  name: automation-worker-vnc
spec:
  type: NodePort
  selector:
    app: automation-worker
  ports:
  - port: 5901
    targetPort: 5901
    nodePort: 30901
    name: vnc-worker-1
---
# NoVNC Deployment for Web-based VNC Access
apiVersion: apps/v1
kind: Deployment
metadata:
  name: automation-novnc
spec:
  replicas: 1
  selector:
    matchLabels:
      app: automation-novnc
  template:
    metadata:
      labels:
        app: automation-novnc
    spec:
      containers:
      - name: novnc
        image: registry.digitalocean.com/automation/novnc:latest
        ports:
        - containerPort: 6080
          name: http
        env:
        - name: VNC_HOST
          value: "automation-worker"
        - name: VNC_PORT
          value: "5901"
---
apiVersion: v1
kind: Service
metadata:
  name: automation-novnc
spec:
  type: NodePort
  selector:
    app: automation-novnc
  ports:
  - port: 6080
    targetPort: 6080
    nodePort: 30080
    name: novnc-web
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: automation-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: automation-worker
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### 8.2 Client Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: automation-client
spec:
  replicas: 1
  selector:
    matchLabels:
      app: automation-client
  template:
    metadata:
      labels:
        app: automation-client
    spec:
      containers:
      - name: client
        image: registry.digitalocean.com/automation/client:latest
        envFrom:
        - secretRef:
            name: client-secrets
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

### 8.3 CronJob for Session Processing (Future)
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: session-processor
spec:
  schedule: "0 */6 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: session-processor
            image: registry.digitalocean.com/automation/session-processor:latest
            command:
            - node
            - process-sessions.js
          restartPolicy: OnFailure
```

---

## 9. Monitoring and Logging

### 9.1 Key Metrics to Track
- Tasks per minute (actual vs target)
- Success rate by country
- Success rate by device/OS combination
- Average task completion time
- Proxy failure rate
- Worker pod utilization
- RabbitMQ queue depth

### 9.2 Logging Requirements
- Structured JSON logging
- Log levels: ERROR, WARN, INFO, DEBUG
- Include correlation_id in all task-related logs
- Log format:
```json
{
  "timestamp": "2025-08-10T22:45:00Z",
  "level": "INFO",
  "service": "worker",
  "correlation_id": "uuid",
  "message": "Navigation completed successfully",
  "metadata": {
    "country": "ca",
    "device": "mobile",
    "os": "iOS"
  }
}
```

---

## 10. Testing Strategy

### 10.1 Unit Tests
- Task generation logic
- Distribution calculations
- Rate adjustment algorithms
- Navigation action handlers

### 10.2 Integration Tests
- RabbitMQ RPC communication
- Database operations
- Proxy request handling
- End-to-end task processing

### 10.3 Load Testing
- Verify system handles 8000 tasks/24 hours
- Test worker scaling under load
- Validate rate adjustment under various conditions

---

## 11. Security Considerations

### 11.1 Credentials Management
- Store all credentials in Kubernetes secrets
- Use environment variables for local development
- Never commit credentials to version control
- Rotate proxy credentials regularly

### 11.2 Network Security
- Use TLS for RabbitMQ connections in production
- Encrypt database connections
- Implement proper firewall rules in DigitalOcean

---

## 12. Future Enhancements

### 12.1 Version 2.0 Considerations
- Screenshot capture capability
- Data extraction from pages
- Performance metrics collection
- Advanced navigation actions (scroll, hover, form fill)
- Real-time dashboard for monitoring
- Multi-step form submissions
- Cookie and session management
- A/B testing support

### 12.2 Scalability Improvements
- Redis for caching and rate limiting
- Message batching for improved throughput
- Geographic distribution of workers
- Advanced queue prioritization

---

## 13. Acceptance Criteria

### 13.1 Functional Requirements
- ✓ System processes 8000 tasks over 24 hours
- ✓ Tasks distributed evenly across countries
- ✓ Device/OS distribution matches configuration
- ✓ All navigation sequences execute correctly
- ✓ Failed tasks retry up to 5 times
- ✓ System recovers from crashes

### 13.2 Performance Requirements
- ✓ Worker processes task within 60 seconds
- ✓ System maintains target rate (±10%)
- ✓ Horizontal scaling responds to load
- ✓ Database queries execute under 100ms

### 13.3 Reliability Requirements
- ✓ 99% uptime for client service
- ✓ No message loss during failures
- ✓ Graceful degradation on proxy failures
- ✓ Complete audit trail in database

---

## Appendix A: Development Setup Guide

### Prerequisites
- Docker Desktop installed
- Node.js 18+ installed
- DataImpulse API credentials

### Setup Steps
1. Clone repository
2. Copy `.env.example` to `.env` in both client and worker directories
3. Add DataImpulse credentials to `.env` files
4. Run `docker-compose up -d rabbitmq postgres`
5. Run database migrations: `npm run migrate`
6. Start services: `docker-compose up`
7. Send test session to RabbitMQ management UI (localhost:15672)

### Testing
```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Send test session
npm run send-test-session
```

---

## Appendix B: Troubleshooting Guide

### Common Issues

#### Issue: Proxy Connection Failures
- Verify DataImpulse credentials
- Check country code is valid
- Monitor API rate limits
- Review proxy stats endpoint

#### Issue: Navigation Timeouts
- Increase ELEMENT_WAIT_TIMEOUT
- Check CSS selectors are valid
- Verify page JavaScript execution
- Review network conditions

#### Issue: Memory Issues in Worker Pods
- Increase pod memory limits
- Ensure browser cleanup after each task
- Monitor for memory leaks
- Consider reducing concurrent browsers

## 15. Implementation Examples

### 15.1 Worker VNC Initialization
```javascript
// worker/index.js
const startWorker = async () => {
  // Log VNC status on startup
  if (process.env.ENABLE_VNC === 'true') {
    console.log('=================================');
    console.log('VNC Server Configuration:');
    console.log(`VNC Port: ${process.env.VNC_PORT || 5901}`);
    console.log(`Display: ${process.env.DISPLAY}`);
    console.log(`Resolution: ${process.env.XVFB_WHD}`);
    console.log('Connect using VNC viewer to: localhost:5901');
    console.log('Or use NoVNC at: http://localhost:6080');
    console.log('=================================');
    
    // Verify Xvfb is running
    const { exec } = require('child_process');
    exec('ps aux | grep Xvfb', (error, stdout) => {
      if (error) {
        console.error('ERROR: Xvfb not running. VNC will not work.');
        if (process.env.ENABLE_VNC === 'true') {
          process.exit(1); // Exit if VNC required but not available
        }
      } else {
        console.log('Xvfb is running successfully');
      }
    });
  }
  
  if (process.env.DEBUG_MODE === 'true') {
    console.log('Debug mode enabled - Visual indicators and delays active');
  }
  
  // Continue with normal worker initialization
  await initializeRabbitMQ();
  await listenForTasks();
};
```

### 15.2 Debug Mode Navigation Implementation
```javascript
// worker/navigation.js
class NavigationExecutor {
  constructor(page, debugMode = false) {
    this.page = page;
    this.debugMode = debugMode || process.env.DEBUG_MODE === 'true';
  }
  
  async executeNavigation(navigation, index) {
    if (this.debugMode) {
      console.log(`[DEBUG] Starting navigation ${index + 1}:`, {
        selector: navigation.css,
        action: navigation.action,
        url: this.page.url()
      });
    }
    
    // Wait for element
    await this.page.waitForSelector(navigation.css, {
      timeout: parseInt(process.env.ELEMENT_WAIT_TIMEOUT) || 10000
    });
    
    // Get element information
    const element = await this.page.$(navigation.css);
    
    if (this.debugMode) {
      // Highlight element
      await this.highlightElement(navigation.css);
      
      // Log element details
      const elementInfo = await this.page.evaluate(sel => {
        const el = document.querySelector(sel);
        return {
          tag: el.tagName,
          text: el.innerText?.substring(0, 100),
          classes: el.className,
          id: el.id,
          href: el.href
        };
      }, navigation.css);
      
      console.log('[DEBUG] Element details:', elementInfo);
      
      // Show mouse movement
      const boundingBox = await element.boundingBox();
      await this.moveMouseWithVisual(
        boundingBox.x + boundingBox.width / 2,
        boundingBox.y + boundingBox.height / 2
      );
      
      // Pre-click delay
      const preClickDelay = parseInt(process.env.DEBUG_PRE_CLICK_DELAY) || 2000;
      console.log(`[DEBUG] Waiting ${preClickDelay}ms before click...`);
      await this.page.waitForTimeout(preClickDelay);
    }
    
    // Execute action
    if (navigation.action === 'click_first') {
      await element.click();
    } else if (navigation.action === 'random_click') {
      const elements = await this.page.$(navigation.css);
      const randomIndex = Math.floor(Math.random() * elements.length);
      
      if (this.debugMode) {
        console.log(`[DEBUG] Found ${elements.length} elements, clicking index ${randomIndex}`);
      }
      
      await elements[randomIndex].click();
    }
    
    if (this.debugMode) {
      // Post-click delay
      const postClickDelay = parseInt(process.env.DEBUG_POST_CLICK_DELAY) || 3000;
      console.log(`[DEBUG] Waiting ${postClickDelay}ms after click...`);
      await this.page.waitForTimeout(postClickDelay);
      
      // Log new URL if changed
      console.log('[DEBUG] Current URL after click:', this.page.url());
    }
    
    // Wait for navigation
    await this.page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: parseInt(process.env.NAVIGATION_TIMEOUT) || 30000
    }).catch(err => {
      if (this.debugMode) {
        console.log('[DEBUG] Navigation wait timed out, continuing anyway');
      }
    });
  }
  
  async highlightElement(selector) {
    await this.page.evaluate((sel, duration) => {
      const element = document.querySelector(sel);
      if (element) {
        const originalBorder = element.style.border;
        const originalBackground = element.style.backgroundColor;
        
        element.style.border = '3px solid red';
        element.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
        element.style.transition = 'all 0.3s ease';
        
        setTimeout(() => {
          element.style.border = originalBorder;
          element.style.backgroundColor = originalBackground;
        }, duration);
      }
    }, selector, parseInt(process.env.DEBUG_HIGHLIGHT_DURATION) || 2000);
  }
  
  async moveMouseWithVisual(x, y) {
    if (this.debugMode) {
      // Create visual cursor
      await this.page.evaluate((x, y) => {
        const cursor = document.createElement('div');
        cursor.style.position = 'fixed';
        cursor.style.width = '20px';
        cursor.style.height = '20px';
        cursor.style.borderRadius = '50%';
        cursor.style.backgroundColor = 'red';
        cursor.style.border = '2px solid white';
        cursor.style.zIndex = '999999';
        cursor.style.left = (x - 10) + 'px';
        cursor.style.top = (y - 10) + 'px';
        cursor.style.pointerEvents = 'none';
        cursor.style.boxShadow = '0 0 10px rgba(255,0,0,0.5)';
        cursor.id = 'debug-cursor';
        
        const oldCursor = document.getElementById('debug-cursor');
        if (oldCursor) oldCursor.remove();
        
        document.body.appendChild(cursor);
        
        // Animate cursor movement
        cursor.animate([
          { transform: 'scale(1)', opacity: 1 },
          { transform: 'scale(1.5)', opacity: 0.5 },
          { transform: 'scale(1)', opacity: 1 }
        ], {
          duration: 500,
          iterations: 2
        });
        
        setTimeout(() => cursor.remove(), 2000);
      }, x, y);
    }
    
    await this.page.mouse.move(x, y, { steps: 10 });
  }
}
```

### 15.3 Start Script for Xvfb and VNC
```bash
#!/bin/bash
# start_xvfb_and_run_cmd.sh

echo "========================================="
echo "Starting X Virtual Framebuffer and VNC"
echo "========================================="

# Start Xvfb
echo "Starting Xvfb with display $DISPLAY"
echo "Resolution: $XVFB_WHD"
Xvfb $DISPLAY -ac -screen 0 $XVFB_WHD -nolisten tcp &
XVFB_PID=$!

# Wait for Xvfb to start
sleep 2

# Check if Xvfb started successfully
if ! kill -0 $XVFB_PID 2>/dev/null; then
    echo "ERROR: Xvfb failed to start"
    exit 1
fi

echo "Xvfb started successfully (PID: $XVFB_PID)"

# Start VNC server if enabled
if [ "$ENABLE_VNC" = "true" ]; then
    echo "Starting VNC server on port ${VNC_PORT:-5901}"
    x11vnc -display $DISPLAY -forever -shared -rfbport ${VNC_PORT:-5901} -nopw &
    VNC_PID=$!
    
    sleep 2
    
    if kill -0 $VNC_PID 2>/dev/null; then
        echo "VNC server started successfully (PID: $VNC_PID)"
        echo "========================================="
        echo "VNC Connection Information:"
        echo "Port: ${VNC_PORT:-5901}"
        echo "Connect using: vnc://localhost:${VNC_PORT:-5901}"
        echo "========================================="
    else
        echo "ERROR: VNC server failed to start"
        if [ "$ENABLE_VNC" = "true" ]; then
            echo "VNC is required but failed to start. Exiting."
            kill $XVFB_PID
            exit 1
        fi
    fi
else
    echo "VNC is disabled (set ENABLE_VNC=true to enable)"
fi

# Execute main command
echo "Executing main command: $@"
exec "$@"
```

---

## Appendix C: Quick Start Guide

### Local Development with VNC

#### 1. Clone and Setup
```bash
git clone <repository>
cd browser-automation
cp .env.example worker/.env
cp .env.example client/.env
```

#### 2. Configure for Debug Mode
```bash
# worker/.env
ENABLE_VNC=true
DEBUG_MODE=true
HEADLESS=false
VNC_PORT=5901

# Add your DataImpulse credentials
DEVICE_TYPE_USERNAME_MOBILE=your_mobile_username
DEVICE_TYPE_PASSWORD_MOBILE=your_mobile_password
DEVICE_TYPE_USERNAME_DESKTOP=your_desktop_username
DEVICE_TYPE_PASSWORD_DESKTOP=your_desktop_password
```

#### 3. Start Services
```bash
# Start infrastructure
docker-compose up -d rabbitmq postgres

# Run database migrations
docker-compose run client npm run migrate

# Start all services with VNC
docker-compose up

# Or start specific services
docker-compose up worker novnc
```

#### 4. Connect to VNC
- **VNC Viewer**: Connect to `localhost:5901`
- **Web Browser**: Open `http://localhost:6080`

#### 5. Send Test Session
```bash
# Connect to RabbitMQ Management UI
# http://localhost:15672 (admin/admin)

# Publish message to "sessions" queue:
{
  "tasks_24h": 10,
  "countries": ["us"],
  "main_page_url": "https://example.com",
  "navigations": [
    {
      "css": "a.nav-link",
      "action": "click_first"
    }
  ],
  "mobile_desktop_distribution": "50:50",
  "mobile_os_distribution": "1:1",
  "desktop_os_distribution": "1:1"
}
```

#### 6. Watch Execution
- View browser automation in VNC
- See red borders highlighting elements
- Observe mouse movements
- Check console for debug logs

### Production Debugging

#### Enable Debug Mode on Specific Pod
```bash
# Get pod name
kubectl get pods -l app=automation-worker

# Enable debug mode on specific pod
kubectl set env pod/automation-worker-xxxxx \
  ENABLE_VNC=true \
  DEBUG_MODE=true \
  HEADLESS=false

# Port forward to that pod
kubectl port-forward pod/automation-worker-xxxxx 5901:5901

# Connect VNC viewer to localhost:5901
```

#### Using NoVNC in Production
```bash
# Deploy NoVNC if not already deployed
kubectl apply -f k8s/novnc-deployment.yaml

# Access NoVNC
kubectl port-forward svc/automation-novnc 6080:6080

# Open browser to http://localhost:6080
```

---

## Appendix D: Environment Configuration Reference

### Complete Environment Variables

| Variable | Default | Description | Modes |
|----------|---------|-------------|-------|
| **VNC & Debug** | | | |
| `ENABLE_VNC` | `false` | Enable VNC server | All |
| `DEBUG_MODE` | `false` | Enable visual debugging | All |
| `HEADLESS` | `true` | Run browser in headless mode | All |
| `VNC_PORT` | `5901` | VNC server port | Debug |
| `DISPLAY` | `:99` | X display number | All |
| `XVFB_WHD` | `1920x1080x24` | Xvfb resolution | All |
| `DEBUG_PRE_CLICK_DELAY` | `2000` | Ms to wait before clicking | Debug |
| `DEBUG_POST_CLICK_DELAY` | `3000` | Ms to wait after clicking | Debug |
| `DEBUG_HIGHLIGHT_DURATION` | `2000` | Ms to show element highlight | Debug |
| **Core Settings** | | | |
| `RABBITMQ_URL` | - | RabbitMQ connection string | All |
| `TASKS_QUEUE` | `tasks` | Queue name for tasks | All |
| `NAVIGATION_TIMEOUT` | `30000` | Navigation timeout in ms | All |
| `ELEMENT_WAIT_TIMEOUT` | `10000` | Element wait timeout in ms | All |
| `BETWEEN_NAVIGATION_DELAY` | `7500` | Delay between navigations | All |
| **Proxy Settings** | | | |
| `DATAIMPULSE_API_URL` | - | DataImpulse API endpoint | All |
| `DEVICE_TYPE_USERNAME_MOBILE` | - | Mobile proxy username | All |
| `DEVICE_TYPE_PASSWORD_MOBILE` | - | Mobile proxy password | All |
| `DEVICE_TYPE_USERNAME_DESKTOP` | - | Desktop proxy username | All |
| `DEVICE_TYPE_PASSWORD_DESKTOP` | - | Desktop proxy password | All |
| `PROXY_RETRY_LIMIT` | `3` | Max proxy retry attempts | All |

### Mode Configurations

#### Production Mode
```env
ENABLE_VNC=false
DEBUG_MODE=false
HEADLESS=true
```

#### Debug Mode (Local)
```env
ENABLE_VNC=true
DEBUG_MODE=true
HEADLESS=false
VNC_PORT=5901
```

#### Debug Mode (Production)
```env
ENABLE_VNC=true
DEBUG_MODE=true
HEADLESS=false
VNC_PORT=5901
# Apply via kubectl set env
```

---

**Document Version History**
- v1.0 - Initial draft (August 2025)
- v1.1 - Added VNC support and debugging features (August 2025)