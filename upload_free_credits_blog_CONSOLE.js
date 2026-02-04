// ============================================
// 🚀 UPLOAD FREE CREDITS OFFER BLOG POST
// ============================================
// 
// HOW TO USE:
// 1. Open https://lypo.org/dashboard.html in your browser
// 2. Make sure you're logged in as admin
// 3. Open browser console (F12 or Cmd+Option+J on Mac, F12 or Ctrl+Shift+J on Windows)
// 4. Copy this ENTIRE file
// 5. Paste into console and press Enter
// 6. Wait for success message (may take a few seconds)
//
// ============================================

(async function uploadFreeCreditsPost() {
  console.log('🚀 Starting 50 FREE CREDITS blog post upload...');
  
  // Get authentication token
  const token = localStorage.getItem('lypo_token_v1');
  if (!token) {
    console.error('❌ ERROR: No authentication token found.');
    console.error('💡 Please log in at https://lypo.org/dashboard.html first');
    return;
  }

  // Blog post data
  const blogPost = {
    title: "Get 50 Free Credits Just for Signing Up",
    slug: "50-free-credits-sign-up-offer",
    excerpt: "Sign up now and receive 50 free credits instantly. Create your first TikTok captions video completely free. No credit card required, no strings attached. Start creating AI videos in 30 seconds.",
    cover_url: "assets/free-credits-offer-cover.png",
    content_html: `<!-- Cover Image -->
  <div style="margin-bottom: 40px; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.4);">
    <img src="assets/free-credits-offer-cover.png" alt="50 Free Credits - Sign Up and Start Creating" style="width: 100%; display: block;">
  </div>

  <!-- Title -->
  <h1 style="font-size: 44px; font-weight: 900; line-height: 1.15; margin-bottom: 20px; letter-spacing: -0.02em; color: rgba(255,255,255,0.98);">
    Get 50 Free Credits Just for Signing Up
  </h1>

  <!-- Meta Info -->
  <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 40px; font-size: 14px; color: rgba(255,255,255,0.5);">
    <span>📅 February 2, 2026</span>
    <span>•</span>
    <span>⏱️ 3 min read</span>
    <span>•</span>
    <span>👤 LYPO Team</span>
  </div>

  <!-- Introduction -->
  <div style="background: rgba(255,255,255,0.03); border-left: 3px solid rgba(139, 92, 246, 0.6); padding: 24px 28px; margin-bottom: 40px; border-radius: 8px;">
    <p style="font-size: 19px; margin: 0; line-height: 1.65; color: rgba(255,255,255,0.92); font-weight: 500;">
      We're making it easier than ever to try LYPO. Sign up today and <strong>receive 50 free credits instantly</strong> — enough to create your first TikTok captions video completely free. No credit card required.
    </p>
  </div>

  <!-- Content -->
  <div style="font-size: 17px; color: rgba(255,255,255,0.87);">

    <h2 style="font-size: 34px; font-weight: 800; margin-top: 50px; margin-bottom: 24px; color: rgba(255,255,255,0.98); letter-spacing: -0.01em;">
      Why 50 Free Credits?
    </h2>

    <p style="margin-bottom: 24px; line-height: 1.75;">
      We want you to experience what LYPO can do without any risk. 50 credits is the perfect amount to:
    </p>

    <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 24px; margin-bottom: 32px;">
      <ul style="margin: 0; padding-left: 20px; line-height: 2; font-size: 16px;">
        <li><strong>Create one complete TikTok captions video (50 credits)</strong> — Perfect for testing the full workflow</li>
        <li><strong>Or translate a 5-second video (50 credits)</strong> — See AI dubbing in action</li>
        <li><strong>Or generate a 2-second AI video with Kling (40 credits)</strong> — Experience the fastest AI video generator</li>
      </ul>
    </div>

    <p style="margin-bottom: 40px; line-height: 1.75; font-size: 18px; padding: 20px; background: rgba(139, 92, 246, 0.08); border-radius: 10px; border-left: 3px solid rgba(139, 92, 246, 0.5);">
      <strong style="color: rgba(139, 92, 246, 1);">The bottom line:</strong> You can create a real, usable piece of content before spending a single dollar.
    </p>

    <h2 style="font-size: 34px; font-weight: 800; margin-top: 60px; margin-bottom: 24px; color: rgba(255,255,255,0.98); letter-spacing: -0.01em;">
      What Can You Do With 50 Credits?
    </h2>

    <p style="margin-bottom: 24px; line-height: 1.75;">
      Here's exactly what 50 free credits gets you:
    </p>

    <div style="display: grid; gap: 20px; margin-bottom: 40px;">
      <!-- Option 1 -->
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 28px;">
        <h3 style="font-size: 20px; font-weight: 700; margin-top: 0; margin-bottom: 12px; color: rgba(139, 92, 246, 1);">
          Option 1: One Complete TikTok Captions Video
        </h3>
        <p style="margin: 0 0 16px 0; line-height: 1.75; color: rgba(255,255,255,0.8);">
          Upload your video, get perfectly timed word-by-word captions with viral TikTok-style animations. Fully customizable colors, fonts, and timing. Download and post immediately.
        </p>
        <div style="background: rgba(139, 92, 246, 0.1); border-radius: 8px; padding: 12px; font-size: 14px; color: rgba(255,255,255,0.7);">
          <strong>Cost:</strong> 50 credits per video<br>
          <strong>Free credits covers:</strong> 1 complete video<br>
          <strong>Perfect for:</strong> Testing the caption tool before committing
        </div>
      </div>

      <!-- Option 2 -->
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 28px;">
        <h3 style="font-size: 20px; font-weight: 700; margin-top: 0; margin-bottom: 12px; color: rgba(139, 92, 246, 1);">
          Option 2: Video Translation (5 seconds)
        </h3>
        <p style="margin: 0 0 16px 0; line-height: 1.75; color: rgba(255,255,255,0.8);">
          Translate a 5-second video into any of 30+ languages with natural AI voices. Perfect for testing dubbing quality before translating longer content.
        </p>
        <div style="background: rgba(139, 92, 246, 0.1); border-radius: 8px; padding: 12px; font-size: 14px; color: rgba(255,255,255,0.7);">
          <strong>Cost:</strong> 10 credits per second<br>
          <strong>Free credits covers:</strong> 5 seconds of video<br>
          <strong>Perfect for:</strong> Testing translation quality and voices
        </div>
      </div>

      <!-- Option 3 -->
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 28px;">
        <h3 style="font-size: 20px; font-weight: 700; margin-top: 0; margin-bottom: 12px; color: rgba(139, 92, 246, 1);">
          Option 3: AI Video Generation (2 seconds)
        </h3>
        <p style="margin: 0 0 16px 0; line-height: 1.75; color: rgba(255,255,255,0.8);">
          Generate a 2-second AI video from text or image with Kling 2.5 Turbo Pro. See the fastest, most realistic AI video generator in action with built-in audio.
        </p>
        <div style="background: rgba(139, 92, 246, 0.1); border-radius: 8px; padding: 12px; font-size: 14px; color: rgba(255,255,255,0.7);">
          <strong>Cost:</strong> 20 credits per second<br>
          <strong>Free credits covers:</strong> 2 seconds of AI video<br>
          <strong>Perfect for:</strong> Experiencing cutting-edge AI video generation
        </div>
      </div>
    </div>

    <h2 style="font-size: 34px; font-weight: 800; margin-top: 60px; margin-bottom: 24px; color: rgba(255,255,255,0.98); letter-spacing: -0.01em;">
      No Hidden Catches
    </h2>

    <p style="margin-bottom: 24px; line-height: 1.75;">
      We're serious about transparency. Here's what "50 free credits" actually means:
    </p>

    <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; padding: 28px; margin-bottom: 40px;">
      <h3 style="font-size: 22px; font-weight: 700; margin-top: 0; margin-bottom: 20px; color: rgba(16, 185, 129, 1);">
        What "Free" Actually Means
      </h3>
      
      <div style="line-height: 2; color: rgba(255,255,255,0.85);">
        <div style="margin-bottom: 12px;">
          ✅ <strong>No credit card required</strong> — Sign up with just email and password (or Google Sign-In)
        </div>
        <div style="margin-bottom: 12px;">
          ✅ <strong>No trial period</strong> — Credits are yours permanently, no expiration
        </div>
        <div style="margin-bottom: 12px;">
          ✅ <strong>No automatic billing</strong> — You'll never be charged unless you manually buy more credits
        </div>
        <div style="margin-bottom: 12px;">
          ✅ <strong>No hidden fees</strong> — 50 credits = 50 credits. No fine print.
        </div>
        <div style="margin-bottom: 12px;">
          ✅ <strong>No strings attached</strong> — Use them, test the tools, decide if LYPO is right for you
        </div>
        <div>
          ✅ <strong>Full feature access</strong> — Free credits work exactly like purchased credits
        </div>
      </div>
    </div>

    <h2 style="font-size: 34px; font-weight: 800; margin-top: 60px; margin-bottom: 24px; color: rgba(255,255,255,0.98); letter-spacing: -0.01em;">
      How to Claim Your Free Credits
    </h2>

    <p style="margin-bottom: 24px; line-height: 1.75;">
      Getting your 50 free credits takes 30 seconds:
    </p>

    <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 32px; margin-bottom: 40px;">
      <div style="display: grid; gap: 24px;">
        <div style="display: flex; gap: 16px;">
          <div style="flex-shrink: 0; width: 40px; height: 40px; background: rgba(139, 92, 246, 0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; color: rgba(139, 92, 246, 1);">
            1
          </div>
          <div>
            <h4 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 700; color: rgba(255,255,255,0.95);">
              Go to LYPO.org
            </h4>
            <p style="margin: 0; line-height: 1.7; color: rgba(255,255,255,0.75);">
              Visit the homepage and click "Login" or "Get Started"
            </p>
          </div>
        </div>

        <div style="display: flex; gap: 16px;">
          <div style="flex-shrink: 0; width: 40px; height: 40px; background: rgba(139, 92, 246, 0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; color: rgba(139, 92, 246, 1);">
            2
          </div>
          <div>
            <h4 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 700; color: rgba(255,255,255,0.95);">
              Create Your Account
            </h4>
            <p style="margin: 0; line-height: 1.7; color: rgba(255,255,255,0.75);">
              Enter your email and create a password (or use Google Sign-In for even faster signup)
            </p>
          </div>
        </div>

        <div style="display: flex; gap: 16px;">
          <div style="flex-shrink: 0; width: 40px; height: 40px; background: rgba(139, 92, 246, 0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; color: rgba(139, 92, 246, 1);">
            3
          </div>
          <div>
            <h4 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 700; color: rgba(255,255,255,0.95);">
              Credits Added Instantly
            </h4>
            <p style="margin: 0; line-height: 1.7; color: rgba(255,255,255,0.75);">
              50 credits are automatically added to your account the moment you sign up. No verification email, no waiting.
            </p>
          </div>
        </div>

        <div style="display: flex; gap: 16px;">
          <div style="flex-shrink: 0; width: 40px; height: 40px; background: rgba(139, 92, 246, 0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; color: rgba(139, 92, 246, 1);">
            4
          </div>
          <div>
            <h4 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 700; color: rgba(255,255,255,0.95);">
              Start Creating
            </h4>
            <p style="margin: 0; line-height: 1.7; color: rgba(255,255,255,0.75);">
              Choose your tool, upload your content, and see what LYPO can do. Your first video is completely free.
            </p>
          </div>
        </div>
      </div>
    </div>

    <h2 style="font-size: 34px; font-weight: 800; margin-top: 60px; margin-bottom: 24px; color: rgba(255,255,255,0.98); letter-spacing: -0.01em;">
      Why We Offer Free Credits
    </h2>

    <p style="margin-bottom: 24px; line-height: 1.75;">
      Most AI video tools either don't offer free trials or require a credit card upfront. We do things differently:
    </p>

    <div style="background: rgba(255,255,255,0.03); border-left: 3px solid rgba(139, 92, 246, 0.6); padding: 24px 28px; margin-bottom: 32px; border-radius: 8px;">
      <p style="font-size: 17px; margin: 0 0 16px 0; line-height: 1.7; color: rgba(255,255,255,0.9);">
        <strong>We believe the best way to show you LYPO's value is to let you try it.</strong>
      </p>
      <p style="font-size: 17px; margin: 0; line-height: 1.7; color: rgba(255,255,255,0.9);">
        If our tools save you time, produce great results, and are worth using — you'll know after creating your first video. No sales pitch needed.
      </p>
    </div>

    <p style="margin-bottom: 40px; line-height: 1.75;">
      We're confident that once you see how fast Kling AI generates videos (2-5 minutes vs competitors' 20-30 minutes), how professional the TikTok captions look, and how natural the AI dubbing sounds, you'll want to keep using LYPO.
    </p>

    <h2 style="font-size: 34px; font-weight: 800; margin-top: 60px; margin-bottom: 24px; color: rgba(255,255,255,0.98); letter-spacing: -0.01em;">
      What Happens After You Use Your Free Credits?
    </h2>

    <p style="margin-bottom: 24px; line-height: 1.75;">
      Simple: You decide if you want to buy more credits or not.
    </p>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 40px;">
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 24px;">
        <h4 style="font-size: 18px; font-weight: 700; margin-top: 0; margin-bottom: 12px; color: rgba(139, 92, 246, 1);">If You Love It</h4>
        <p style="margin: 0; font-size: 15px; line-height: 1.7; color: rgba(255,255,255,0.75);">
          Buy more credits whenever you need them. No subscriptions, credits never expire. Pay only for what you use.
        </p>
      </div>
      
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 24px;">
        <h4 style="font-size: 18px; font-weight: 700; margin-top: 0; margin-bottom: 12px; color: rgba(139, 92, 246, 1);">If It's Not For You</h4>
        <p style="margin: 0; font-size: 15px; line-height: 1.7; color: rgba(255,255,255,0.75);">
          No problem. Your account stays active, no charges ever occur. Come back anytime if you change your mind.
        </p>
      </div>
    </div>

    <p style="margin-bottom: 40px; line-height: 1.75; font-size: 17px;">
      We don't do aggressive follow-up emails or pressure tactics. You tried the tools, you decide.
    </p>

    <!-- CTA Box -->
    <div style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.12), rgba(59, 130, 246, 0.12)); border: 2px solid rgba(139, 92, 246, 0.3); border-radius: 16px; padding: 40px; text-align: center; margin: 50px 0;">
      <h3 style="font-size: 28px; font-weight: 800; margin-top: 0; margin-bottom: 16px; color: rgba(255,255,255,0.98);">
        Ready to Try LYPO?
      </h3>
      <p style="font-size: 17px; margin-bottom: 30px; color: rgba(255,255,255,0.75); line-height: 1.7;">
        Sign up in 30 seconds. Get 50 free credits instantly.<br>
        Create your first AI video completely free.
      </p>
      <a href="index.html#auth" style="display: inline-block; background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%); color: white; padding: 18px 42px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 18px; box-shadow: 0 6px 30px rgba(139, 92, 246, 0.4), 0 0 60px rgba(139, 92, 246, 0.2); transition: all 0.3s ease;">
        Claim Your 50 Free Credits
      </a>
      <p style="font-size: 13px; margin-top: 16px; margin-bottom: 0; color: rgba(255,255,255,0.5);">
        No credit card required • Instant access • Never expires
      </p>
    </div>

    <h2 style="font-size: 34px; font-weight: 800; margin-top: 60px; margin-bottom: 24px; color: rgba(255,255,255,0.98); letter-spacing: -0.01em;">
      Frequently Asked Questions
    </h2>

    <div style="margin-bottom: 30px;">
      <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 10px; color: rgba(139, 92, 246, 1);">
        Do the free credits expire?
      </h3>
      <p style="margin: 0; padding-left: 20px; border-left: 2px solid rgba(139, 92, 246, 0.3); line-height: 1.75;">
        No. Your 50 free credits never expire. Use them today, next week, or next month — they'll still be there.
      </p>
    </div>

    <div style="margin-bottom: 30px;">
      <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 10px; color: rgba(139, 92, 246, 1);">
        Will I be charged automatically after using them?
      </h3>
      <p style="margin: 0; padding-left: 20px; border-left: 2px solid rgba(139, 92, 246, 0.3); line-height: 1.75;">
        Absolutely not. You will never be charged unless you manually choose to buy more credits. No credit card is required to sign up, so there's nothing to charge.
      </p>
    </div>

    <div style="margin-bottom: 30px;">
      <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 10px; color: rgba(139, 92, 246, 1);">
        Can I really create a full TikTok video for free?
      </h3>
      <p style="margin: 0; padding-left: 20px; border-left: 2px solid rgba(139, 92, 246, 0.3); line-height: 1.75;">
        Yes! TikTok captions cost 50 credits per video, so your free credits cover one complete video from start to finish. Upload, generate captions, customize, and download — all free.
      </p>
    </div>

    <div style="margin-bottom: 30px;">
      <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 10px; color: rgba(139, 92, 246, 1);">
        What if I need more credits?
      </h3>
      <p style="margin: 0; padding-left: 20px; border-left: 2px solid rgba(139, 92, 246, 0.3); line-height: 1.75;">
        You can buy more credits anytime through your dashboard. Credits are affordable, never expire, and work across all tools. No subscription required.
      </p>
    </div>

    <div style="margin-bottom: 30px;">
      <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 10px; color: rgba(139, 92, 246, 1);">
        Is this a limited-time offer?
      </h3>
      <p style="margin: 0; padding-left: 20px; border-left: 2px solid rgba(139, 92, 246, 0.3); line-height: 1.75;">
        Currently, all new users receive 50 free credits. While we may adjust this offer in the future, anyone who signs up now will keep their credits permanently.
      </p>
    </div>

  </div>

  <!-- Final CTA -->
  <div style="margin-top: 60px; padding-top: 40px; border-top: 1px solid rgba(255,255,255,0.08); text-align: center;">
    <h2 style="font-size: 36px; font-weight: 900; margin-bottom: 20px; color: rgba(255,255,255,0.98);">
      Try LYPO Risk-Free Today
    </h2>
    <p style="font-size: 18px; margin-bottom: 30px; color: rgba(255,255,255,0.75); line-height: 1.7;">
      50 free credits. No credit card. No risk. Just create.
    </p>
    <a href="index.html#auth" style="display: inline-block; background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%); color: white; padding: 18px 42px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 18px; box-shadow: 0 6px 30px rgba(139, 92, 246, 0.4), 0 0 60px rgba(139, 92, 246, 0.2); transition: all 0.3s ease;">
      Sign Up & Get Free Credits
    </a>
  </div>`,
    status: 'published'
  };

  try {
    console.log('📤 Uploading blog post to database...');
    console.log('📊 Title:', blogPost.title);
    console.log('🔗 Slug:', blogPost.slug);
    
    const response = await fetch('https://lypo-backend.onrender.com/api/admin/blog/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(blogPost)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed with status ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    
    console.log('✅ SUCCESS! Blog post published!');
    console.log('📊 Result:', result);
    console.log('');
    console.log('🔗 VIEW YOUR POST AT:');
    console.log('   https://lypo.org/post.html?slug=50-free-credits-sign-up-offer');
    console.log('');
    console.log('📈 NEXT STEPS:');
    console.log('   1. Visit the link above to verify');
    console.log('   2. Update sitemap.xml');
    console.log('   3. Share on social media');
    
  } catch (error) {
    console.error('❌ ERROR uploading blog post:', error.message);
    console.error('');
    console.error('💡 TROUBLESHOOTING:');
    console.error('   1. Make sure you\'re logged in as admin');
    console.error('   2. Check your internet connection');
    console.error('   3. Try refreshing the page and running again');
    console.error('');
    console.error('Full error:', error);
  }
})();
