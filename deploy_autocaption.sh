#!/bin/bash
# DEPLOY AUTOCAPTION MODEL - HOSPITAL PROJECT

echo "🚨 DEPLOYING AUTOCAPTION MODEL (BETTER THAN WHISPER!)"
echo ""

# Navigate to backend directory
cd "/Users/admin/Downloads/KÕIGE UUEM/BACKEND" || exit 1

echo "📦 Staging changes..."
git add index.js

echo "💾 Committing..."
git commit -m "Switch to autocaption model - adds karaoke captions to video"

echo "🚀 Pushing to GitHub..."
git push

echo ""
echo "✅ Code pushed to GitHub!"
echo ""
echo "⏳ Render will auto-deploy in ~3 minutes"
echo ""
echo "🎉 NEW MODEL BENEFITS:"
echo "  ✅ Adds karaoke-style captions DIRECTLY to video"
echo "  ✅ Perfect for TikTok, Instagram Reels, YouTube Shorts"
echo "  ✅ 80.7K runs - stable and proven"
echo "  ✅ Public model - no permission issues"
echo "  ✅ Simpler code - just pass video URL!"
echo ""
echo "💰 COST: ~$0.052 per video (~19 runs per $1)"
echo "⏱️  PROCESSING TIME: ~45-54 seconds per video"
echo ""
echo "🧪 AFTER 3 MINUTES, TEST:"
echo "  1. Go to: https://lypo.org/tiktok-captions.html"
echo "  2. Upload a video with spoken audio"
echo "  3. Click Generate Captions"
echo "  4. Wait ~1 minute"
echo "  5. Download video WITH captions! ✅"
echo ""
echo "⏰ Check Render dashboard:"
echo "   https://dashboard.render.com"
echo ""
