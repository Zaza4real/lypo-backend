-- REFUND LOST CREDITS FROM FAILED TIKTOK GENERATION
-- Run this in your PostgreSQL database

-- Step 1: Check your current balance
SELECT email, balance, created_at 
FROM users 
WHERE email = 'YOUR_EMAIL_HERE'  -- Replace with your actual email
LIMIT 1;

-- Step 2: Refund 50 credits
UPDATE users 
SET balance = balance + 50 
WHERE email = 'YOUR_EMAIL_HERE';  -- Replace with your actual email

-- Step 3: Verify the refund worked
SELECT email, balance, created_at 
FROM users 
WHERE email = 'YOUR_EMAIL_HERE'  -- Replace with your actual email
LIMIT 1;

-- Expected: balance should be +50 from before

/*
INSTRUCTIONS:
1. Find your DATABASE_URL in Render environment variables
2. Connect using psql or a GUI tool (TablePlus, DBeaver, etc.)
3. Replace 'YOUR_EMAIL_HERE' with your actual email (3 places)
4. Run the script
5. Credits restored! ✅
*/
