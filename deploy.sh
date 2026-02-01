#!/bin/bash
# URGENT DEPLOYMENT SCRIPT FOR HOSPITAL PROJECT

echo "🚨 DEPLOYING CRITICAL FIX FOR TIKTOK CAPTIONS TOOL"
echo ""

# Navigate to backend directory
cd "/Users/admin/Downloads/KÕIGE UUEM/BACKEND" || exit 1

echo "📦 Staging changes..."
git add index.js

echo "💾 Committing..."
git commit -m "URGENT: Fix TikTok captions - Use correct Whisper model version"

echo "🚀 Pushing to GitHub..."
git push

echo ""
echo "✅ Code pushed to GitHub!"
echo ""
echo "⏳ Render will auto-deploy in ~3 minutes"
echo ""
echo "📋 WHAT WAS FIXED:"
echo "  ✅ Correct Whisper model version (80996966...)"
echo "  ✅ Latest public version from openai/whisper"
echo "  ✅ Auto-refund on errors"
echo "  ✅ Token variable fixed"
echo ""
echo "🧪 AFTER 3 MINUTES, TEST:"
echo "  1. Go to: https://lypo.org/tiktok-captions.html"
echo "  2. Upload a SHORT video (10-30 seconds)"
echo "  3. Click Generate Captions"
echo "  4. Should work! ✅"
echo ""
echo "⏰ Check Render dashboard for deployment progress:"
echo "   https://dashboard.render.com"
echo ""
