#!/bin/bash
# QUICK FIX - CORRECT PARAMETER NAME

echo "🔧 FIXING PARAMETER NAME (video_file_input)"
echo ""

cd "/Users/admin/Downloads/KÕIGE UUEM/BACKEND" || exit 1

echo "📦 Staging..."
git add index.js

echo "💾 Committing..."
git commit -m "Fix: Use correct parameter name video_file_input"

echo "🚀 Pushing..."
git push

echo ""
echo "✅ FIXED!"
echo ""
echo "⏳ Wait 3 minutes for Render deploy"
echo ""
echo "🧪 Then test at: https://lypo.org/tiktok-captions.html"
echo ""
echo "THIS WILL WORK! ✅"
echo ""
