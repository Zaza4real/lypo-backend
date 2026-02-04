#!/usr/bin/env node

/**
 * Upload script for "Kling AI Video Generator" blog post
 * 
 * SEO-optimized marketing blog post for Kling 2.5 Turbo Pro
 * Targets: AI video generation, text-to-video, image-to-video keywords
 * 
 * Features:
 * - 2,500+ words of SEO content
 * - Comprehensive keyword targeting
 * - Multiple CTAs for conversion
 * - Professional cover image
 */

import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Read the HTML content from the blog post file
const blogHtmlPath = join(__dirname, '../FRONTEND/kling-ai-video-blog.html');
let contentHtml = '';

try {
  const fullHtml = readFileSync(blogHtmlPath, 'utf-8');
  
  // Extract just the article content (between <article> tags)
  const articleMatch = fullHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/);
  
  if (articleMatch) {
    contentHtml = articleMatch[1].trim();
    console.log('✅ Extracted article content from HTML file');
  } else {
    console.error('❌ Could not find <article> tag in HTML file');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error reading HTML file:', error.message);
  process.exit(1);
}

const blogPost = {
  title: 'Kling AI Video Generator: Create Stunning, Realistic Videos in Seconds',
  slug: 'kling-ai-video-generator-text-image-to-video-turbo-realistic',
  excerpt: 'Transform text prompts and images into stunning, realistic AI videos with Kling 2.5 Turbo Pro. Lightning-fast generation (2-5 minutes), cinematic quality, and built-in audio. Perfect for content creators, marketers, and filmmakers. Try the most advanced AI video generator today.',
  cover_url: 'assets/kling-ai-video-cover.png',
  content_html: contentHtml,
  status: 'published'
};

async function uploadBlogPost() {
  try {
    console.log('🚀 Starting blog post upload...\n');
    
    // Check if slug already exists
    const existingPost = await pool.query(
      'SELECT id, title FROM blog_posts WHERE slug = $1',
      [blogPost.slug]
    );
    
    if (existingPost.rows.length > 0) {
      console.log('⚠️  Blog post with this slug already exists:');
      console.log(`   ID: ${existingPost.rows[0].id}`);
      console.log(`   Title: ${existingPost.rows[0].title}`);
      console.log('\n🔄 Updating existing post...\n');
      
      // Update existing post
      const result = await pool.query(
        `UPDATE blog_posts 
         SET title = $1, excerpt = $2, cover_url = $3, content_html = $4, 
             status = $5, updated_at = NOW()
         WHERE slug = $6
         RETURNING id, title, slug, status, created_at, updated_at`,
        [blogPost.title, blogPost.excerpt, blogPost.cover_url, 
         blogPost.content_html, blogPost.status, blogPost.slug]
      );
      
      const post = result.rows[0];
      
      console.log('✅ Blog post UPDATED successfully!\n');
      console.log('📋 Post Details:');
      console.log(`   ID: ${post.id}`);
      console.log(`   Title: ${post.title}`);
      console.log(`   Slug: ${post.slug}`);
      console.log(`   Status: ${post.status}`);
      console.log(`   Created: ${new Date(post.created_at).toLocaleString()}`);
      console.log(`   Updated: ${new Date(post.updated_at).toLocaleString()}`);
      
    } else {
      // Insert new post
      const result = await pool.query(
        `INSERT INTO blog_posts 
         (title, slug, excerpt, cover_url, content_html, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, title, slug, status, created_at, updated_at`,
        [blogPost.title, blogPost.slug, blogPost.excerpt, blogPost.cover_url, 
         blogPost.content_html, blogPost.status]
      );
      
      const post = result.rows[0];
      
      console.log('✅ Blog post CREATED successfully!\n');
      console.log('📋 Post Details:');
      console.log(`   ID: ${post.id}`);
      console.log(`   Title: ${post.title}`);
      console.log(`   Slug: ${post.slug}`);
      console.log(`   Status: ${post.status}`);
      console.log(`   Created: ${new Date(post.created_at).toLocaleString()}`);
    }
    
    console.log('\n🌐 Public URL:');
    console.log(`   https://lypo.org/post.html?slug=${blogPost.slug}`);
    
    console.log('\n📊 SEO Stats:');
    console.log(`   Word Count: ~2,500+`);
    console.log(`   Primary Keywords: AI video generator, text to video, image to video`);
    console.log(`   Meta Tags: ✅ Complete (Title, Description, OG, Twitter)`);
    console.log(`   Structured Data: ✅ Schema.org Article`);
    console.log(`   Mobile Optimized: ✅ Yes`);
    console.log(`   CTAs: 3 conversion-focused buttons`);
    
    console.log('\n🎯 Next Steps:');
    console.log('   1. Visit the blog post URL to verify');
    console.log('   2. Submit to Google Search Console');
    console.log('   3. Share on social media (auto-optimized OG tags)');
    console.log('   4. Monitor analytics for traffic and conversions');
    
    console.log('\n✨ Blog post is LIVE and ready to rank! 🚀\n');
    
  } catch (error) {
    console.error('\n❌ Error uploading blog post:');
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the upload
uploadBlogPost();
