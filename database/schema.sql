-- Browser Automation System Database Schema
-- Version: 1.0 (Fixed Foreign Key References)
-- Created: 2025-08-10

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sessions table - stores session configurations
CREATE TABLE sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    tasks_24h INTEGER NOT NULL,
    countries TEXT[] NOT NULL,
    main_page_url TEXT NOT NULL,
    navigations JSONB NOT NULL,
    mobile_desktop_distribution VARCHAR(10) NOT NULL,
    mobile_os_distribution VARCHAR(10) NOT NULL,
    desktop_os_distribution VARCHAR(10) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    total_tasks_generated INTEGER DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    last_error TEXT
);

-- Tasks table - stores individual task instances
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    correlation_id UUID UNIQUE NOT NULL,
    session_id VARCHAR(255) REFERENCES sessions(session_id) ON DELETE CASCADE,
    country VARCHAR(5) NOT NULL,
    device VARCHAR(20) NOT NULL,
    os VARCHAR(20) NOT NULL,
    main_page_url TEXT NOT NULL,
    navigations JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sent_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    processing_time_ms INTEGER
);

-- Task responses table - stores worker responses
CREATE TABLE task_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    correlation_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL,
    country VARCHAR(5) NOT NULL,
    device VARCHAR(20) NOT NULL,
    os VARCHAR(20) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    error_message TEXT,
    error_type VARCHAR(50),
    navigation_step INTEGER,
    response_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Statistics table - aggregated statistics
CREATE TABLE statistics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id VARCHAR(255) REFERENCES sessions(session_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    hour INTEGER NOT NULL, -- 0-23
    country VARCHAR(5) NOT NULL,
    device VARCHAR(20) NOT NULL,
    os VARCHAR(20) NOT NULL,
    total_tasks INTEGER DEFAULT 0,
    successful_tasks INTEGER DEFAULT 0,
    failed_tasks INTEGER DEFAULT 0,
    avg_response_time_ms DECIMAL(10,2),
    success_rate DECIMAL(5,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(session_id, date, hour, country, device, os)
);

-- Rate management table - tracks sending rates
CREATE TABLE rate_management (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id VARCHAR(255) REFERENCES sessions(session_id) ON DELETE CASCADE,
    current_rate_per_minute DECIMAL(8,2) NOT NULL,
    target_rate_per_minute DECIMAL(8,2) NOT NULL,
    adjustment_factor DECIMAL(4,2) DEFAULT 1.0,
    last_adjustment_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    tasks_sent_current_hour INTEGER DEFAULT 0,
    tasks_completed_current_hour INTEGER DEFAULT 0,
    avg_completion_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Proxy usage tracking
CREATE TABLE proxy_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    country VARCHAR(5) NOT NULL,
    device_type VARCHAR(20) NOT NULL,
    proxy_ip VARCHAR(45),
    proxy_port INTEGER,
    request_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    response_time_ms INTEGER,
    success BOOLEAN DEFAULT FALSE,
    error_message TEXT
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_statistics_updated_at BEFORE UPDATE ON statistics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rate_management_updated_at BEFORE UPDATE ON rate_management
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for performance (AFTER tables are created)
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_created_at ON sessions(created_at);

CREATE INDEX idx_tasks_session_id ON tasks(session_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_correlation_id ON tasks(correlation_id);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
CREATE INDEX idx_tasks_country_device_os ON tasks(country, device, os);

CREATE INDEX idx_task_responses_task_id ON task_responses(task_id);
CREATE INDEX idx_task_responses_correlation_id ON task_responses(correlation_id);
CREATE INDEX idx_task_responses_timestamp ON task_responses(timestamp);
CREATE INDEX idx_task_responses_status ON task_responses(status);

CREATE INDEX idx_statistics_session_id ON statistics(session_id);
CREATE INDEX idx_statistics_date_hour ON statistics(date, hour);
CREATE INDEX idx_statistics_country_device_os ON statistics(country, device, os);

CREATE INDEX idx_rate_management_session_id ON rate_management(session_id);
CREATE INDEX idx_rate_management_updated_at ON rate_management(updated_at);

CREATE INDEX idx_proxy_usage_task_id ON proxy_usage(task_id);
CREATE INDEX idx_proxy_usage_country ON proxy_usage(country);
CREATE INDEX idx_proxy_usage_request_time ON proxy_usage(request_time);

-- Create views for common queries
CREATE VIEW session_summary AS
SELECT 
    s.session_id,
    s.tasks_24h,
    s.countries,
    s.status,
    s.created_at,
    s.total_tasks_generated,
    s.tasks_completed,
    s.tasks_failed,
    CASE 
        WHEN s.total_tasks_generated > 0 
        THEN ROUND((s.tasks_completed::DECIMAL / s.total_tasks_generated * 100), 2)
        ELSE 0 
    END as completion_percentage,
    CASE 
        WHEN s.tasks_completed > 0 
        THEN ROUND((s.tasks_completed::DECIMAL / (s.tasks_completed + s.tasks_failed) * 100), 2)
        ELSE 0 
    END as success_rate
FROM sessions s;

CREATE VIEW task_performance AS
SELECT 
    t.country,
    t.device,
    t.os,
    COUNT(*) as total_tasks,
    COUNT(CASE WHEN tr.status = 'successful' THEN 1 END) as successful_tasks,
    COUNT(CASE WHEN tr.status != 'successful' THEN 1 END) as failed_tasks,
    AVG(tr.response_time_ms) as avg_response_time,
    ROUND(
        COUNT(CASE WHEN tr.status = 'successful' THEN 1 END)::DECIMAL / COUNT(*) * 100, 
        2
    ) as success_rate
FROM tasks t
LEFT JOIN task_responses tr ON t.id = tr.task_id
GROUP BY t.country, t.device, t.os;

-- Insert initial configuration data
INSERT INTO sessions (session_id, tasks_24h, countries, main_page_url, navigations, mobile_desktop_distribution, mobile_os_distribution, desktop_os_distribution, status)
VALUES (
    'example-session-001',
    8000,
    ARRAY['ca', 'de', 'ch', 'sg', 'hk'],
    'https://example.com',
    '[
        {"css": "header > div > h2 > a", "action": "click_first"},
        {"css": ".e-n-tab-title", "action": "random_click"},
        {"css": ".products", "action": "random_click"}
    ]'::jsonb,
    '65:35',
    '1:2',
    '1:2',
    'pending'
);
