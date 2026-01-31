-- Database Migration for Google Sign-In
-- Run this if automatic migration doesn't work

-- Step 1: Make password_hash optional (for OAuth users)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Step 2: Add Google OAuth columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'email';

-- Step 3: Set default auth_provider for existing users
UPDATE users SET auth_provider = 'email' WHERE auth_provider IS NULL;

-- Step 4: Create index for faster Google ID lookups
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Verification queries:
-- Check schema
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'users';

-- Check existing users
SELECT email, auth_provider, google_id IS NOT NULL as has_google 
FROM users;
