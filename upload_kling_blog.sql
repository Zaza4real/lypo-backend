-- Upload Kling AI Video Generator Blog Post
-- SEO-optimized marketing content for Kling 2.5 Turbo Pro
-- 
-- To use: Copy and paste into your PostgreSQL console or pgAdmin
-- Or run: psql $DATABASE_URL -f upload_kling_blog.sql

-- First, check if post with this slug exists and delete it (to allow re-upload)
DELETE FROM blog_posts WHERE slug = 'kling-ai-video-generator-text-image-to-video-turbo-realistic';

-- Insert the blog post
-- Note: You'll need to manually copy the HTML content from kling-ai-video-blog.html
-- and paste it into the content_html field below

INSERT INTO blog_posts (
  title,
  slug,
  excerpt,
  cover_url,
  content_html,
  status,
  created_at,
  updated_at
) VALUES (
  'Kling AI Video Generator: Create Stunning, Realistic Videos in Seconds',
  'kling-ai-video-generator-text-image-to-video-turbo-realistic',
  'Transform text prompts and images into stunning, realistic AI videos with Kling 2.5 Turbo Pro. Lightning-fast generation (2-5 minutes), cinematic quality, and built-in audio. Perfect for content creators, marketers, and filmmakers. Try the most advanced AI video generator today.',
  'kling-ai-video-cover.png',
  
  -- CONTENT_HTML: Copy the full <article> content from kling-ai-video-blog.html here
  -- For security, the content should be properly escaped
  -- Use the Node.js script (upload_kling_blog.js) for automatic content extraction
  
  '<!-- Full blog post HTML content goes here -->
  <!-- Run: node upload_kling_blog.js to automatically insert content -->',
  
  'published',
  NOW(),
  NOW()
);

-- Verify the upload
SELECT 
  id,
  title,
  slug,
  status,
  created_at,
  updated_at
FROM blog_posts 
WHERE slug = 'kling-ai-video-generator-text-image-to-video-turbo-realistic';

-- Show the public URL
SELECT 
  'Blog post URL: https://lypo.org/post.html?slug=' || slug as public_url
FROM blog_posts 
WHERE slug = 'kling-ai-video-generator-text-image-to-video-turbo-realistic';
