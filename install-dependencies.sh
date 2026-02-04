#!/bin/bash

# Installation script for LYPO Backend
# This installs all required dependencies including FFmpeg

echo "🚀 Installing LYPO Backend Dependencies..."
echo ""

# Check Node.js version
echo "📦 Checking Node.js version..."
node --version
echo ""

# Install npm packages
echo "📥 Installing npm packages..."
npm install
echo ""

# Verify FFmpeg installation
echo "🎬 Verifying FFmpeg installation..."
node -e "import('@ffmpeg-installer/ffmpeg').then(m => { console.log('✅ FFmpeg path:', m.default.path); }).catch(e => { console.error('❌ FFmpeg not found:', e.message); process.exit(1); })"
echo ""

# Check environment variables
echo "🔐 Checking environment variables..."
if [ -z "$DATABASE_URL" ]; then
  echo "⚠️  Warning: DATABASE_URL not set"
else
  echo "✅ DATABASE_URL set"
fi

if [ -z "$REPLICATE_API_TOKEN" ]; then
  echo "⚠️  Warning: REPLICATE_API_TOKEN not set"
else
  echo "✅ REPLICATE_API_TOKEN set"
fi

if [ -z "$S3_ENDPOINT" ]; then
  echo "⚠️  Warning: S3_ENDPOINT not set"
else
  echo "✅ S3_ENDPOINT set"
fi

if [ -z "$JWT_SECRET" ]; then
  echo "⚠️  Warning: JWT_SECRET not set"
else
  echo "✅ JWT_SECRET set"
fi

if [ -z "$STRIPE_SECRET_KEY" ]; then
  echo "⚠️  Warning: STRIPE_SECRET_KEY not set"
else
  echo "✅ STRIPE_SECRET_KEY set"
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "To start the server:"
echo "  npm start"
echo ""
echo "To test FFmpeg:"
echo "  node -e \"import('fluent-ffmpeg').then(m => console.log(m.default().version))\""
echo ""
