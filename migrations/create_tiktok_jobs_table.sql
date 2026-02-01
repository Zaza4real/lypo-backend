-- TikTok Captions Jobs Table
-- Run this SQL on your PostgreSQL database

CREATE TABLE IF NOT EXISTS tiktok_jobs (
  job_id VARCHAR(255) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'starting',
  input_url TEXT,
  output_url TEXT,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_tiktok_jobs_email ON tiktok_jobs(email);
CREATE INDEX IF NOT EXISTS idx_tiktok_jobs_status ON tiktok_jobs(status);

-- Grant permissions (adjust user as needed)
-- GRANT ALL PRIVILEGES ON TABLE tiktok_jobs TO your_db_user;
