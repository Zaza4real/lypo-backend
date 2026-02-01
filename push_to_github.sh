#!/bin/bash
# PUSH BACKEND TO GITHUB

echo "🚀 DEPLOYING TIKTOK CAPTIONS TO GITHUB"
echo ""

cd "/Users/admin/Downloads/KÕIGE UUEM/BACKEND"

echo "📦 Adding remote..."
git remote set-url origin https://github.com/Zaza4real/lypo-backend.git

echo "✅ Ready to push!"
echo ""
echo "======================================"
echo "RUN THIS COMMAND NOW:"
echo "======================================"
echo ""
echo "cd \"/Users/admin/Downloads/KÕIGE UUEM/BACKEND\""
echo "git push -u origin main"
echo ""
echo "======================================"
echo ""
echo "GitHub will ask for:"
echo "  Username: Zaza4real"
echo "  Password: (use Personal Access Token)"
echo ""
echo "⏰ After pushing:"
echo "  1. Render will auto-deploy (3 minutes)"
echo "  2. Test at: lypo.org/tiktok-captions.html"
echo "  3. WILL WORK! ✅"
echo ""
