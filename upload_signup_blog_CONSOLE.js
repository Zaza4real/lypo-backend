// ============================================
// UPLOAD EASY SIGNUP BLOG POST - BROWSER CONSOLE VERSION
// ============================================
// 
// HOW TO USE:
// 1. Go to: https://lypo.org/dashboard.html
// 2. Open browser console: Cmd+Option+J (Mac) or F12 (Windows)
// 3. Copy this ENTIRE file
// 4. Paste into console
// 5. Press Enter
// 6. Wait for "Blog post published successfully!" message
//
// ============================================

(async function() {
  console.log('🚀 Starting blog post upload...');
  
  // Get auth token
  const token = localStorage.getItem('lypo_token_v1');
  if (!token) {
    console.error('❌ No auth token found. Please log in first.');
    return;
  }

  // Blog post data
  const blogPost = {
    title: 'Sign Up in 30 Seconds: The Easiest Way to Start Creating',
    slug: 'quick-easy-signup-30-seconds',
    excerpt: 'Sign up for LYPO in seconds with just your email and password, or use Google Sign-In. No credit card required, no surveys, no waiting. Start creating AI videos, translations, and captions instantly with 500 free credits.',
    cover_url: 'assets/easy-signup-cover.png',
    content_html: `<!-- Cover Image -->
  <div style="margin-bottom: 40px; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.4);">
    <img src="assets/easy-signup-cover.png" alt="LYPO Easy Sign Up Process" style="width: 100%; display: block;">
  </div>

  <!-- Title -->
  <h1 style="font-size: 42px; font-weight: 900; line-height: 1.15; margin-bottom: 20px; letter-spacing: -0.02em; background: linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.85) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
    Sign Up in 30 Seconds: The Easiest Way to Start Creating
  </h1>

  <!-- Meta Info -->
  <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 40px; font-size: 14px; color: rgba(255,255,255,0.5);">
    <span>📅 February 2, 2026</span>
    <span>•</span>
    <span>⏱️ 2 min read</span>
    <span>•</span>
    <span>👤 LYPO Team</span>
  </div>

  <!-- Introduction -->
  <div style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(59, 130, 246, 0.08)); border-left: 3px solid rgba(139, 92, 246, 0.5); padding: 20px 24px; margin-bottom: 40px; border-radius: 8px;">
    <p style="font-size: 18px; margin: 0; line-height: 1.6; color: rgba(255,255,255,0.9);">
      <strong>We believe creating content should be easy.</strong> That's why we made signing up for LYPO the fastest, simplest process possible. No lengthy forms. No credit card required. No waiting for approval. Just <strong>30 seconds</strong> and you're in.
    </p>
  </div>

  <!-- Content -->
  <div style="font-size: 17px; color: rgba(255,255,255,0.85);">

    <h2 style="font-size: 32px; font-weight: 800; margin-top: 50px; margin-bottom: 20px; color: rgba(255,255,255,0.95); letter-spacing: -0.01em;">
      Two Ways to Sign Up (Both Take 30 Seconds)
    </h2>

    <!-- Method 1 -->
    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 30px; margin-bottom: 24px;">
      <h3 style="font-size: 24px; font-weight: 700; margin-top: 0; margin-bottom: 16px; color: rgba(139, 92, 246, 1);">
        Method 1: Email + Password
      </h3>
      <p style="margin-bottom: 16px;">
        The classic approach. Simple and secure.
      </p>
      <ol style="margin: 0; padding-left: 24px; line-height: 1.9;">
        <li><strong>Enter your email address</strong> (any email works)</li>
        <li><strong>Create a password</strong> (enter it twice for confirmation)</li>
        <li><strong>Click "Sign Up"</strong></li>
      </ol>
      <p style="margin-top: 16px; margin-bottom: 0; font-size: 15px; color: rgba(255,255,255,0.6);">
        That's it. You're in. No email verification required to start creating.
      </p>
    </div>

    <!-- Method 2 -->
    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 30px; margin-bottom: 40px;">
      <h3 style="font-size: 24px; font-weight: 700; margin-top: 0; margin-bottom: 16px; color: rgba(59, 130, 246, 1);">
        Method 2: Google Sign-In
      </h3>
      <p style="margin-bottom: 16px;">
        Even faster. One click and you're done.
      </p>
      <ol style="margin: 0; padding-left: 24px; line-height: 1.9;">
        <li><strong>Click "Sign in with Google"</strong></li>
        <li><strong>Select your Google account</strong></li>
        <li><strong>Done</strong></li>
      </ol>
      <p style="margin-top: 16px; margin-bottom: 0; font-size: 15px; color: rgba(255,255,255,0.6);">
        Literally 3 clicks. No typing required.
      </p>
    </div>

    <h2 style="font-size: 32px; font-weight: 800; margin-top: 50px; margin-bottom: 20px; color: rgba(255,255,255,0.95); letter-spacing: -0.01em;">
      What We DON'T Ask For
    </h2>

    <p style="margin-bottom: 20px;">
      Most platforms make you jump through hoops. We don't.
    </p>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px; margin-bottom: 40px;">
      <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px; padding: 20px;">
        <div style="font-size: 32px; margin-bottom: 10px;">❌</div>
        <strong style="display: block; margin-bottom: 8px; font-size: 16px;">No Credit Card</strong>
        <span style="font-size: 14px; color: rgba(255,255,255,0.6);">Start with free credits. Pay only when you need more.</span>
      </div>
      
      <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px; padding: 20px;">
        <div style="font-size: 32px; margin-bottom: 10px;">❌</div>
        <strong style="display: block; margin-bottom: 8px; font-size: 16px;">No Phone Number</strong>
        <span style="font-size: 14px; color: rgba(255,255,255,0.6);">We don't need it. We won't call you.</span>
      </div>
      
      <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px; padding: 20px;">
        <div style="font-size: 32px; margin-bottom: 10px;">❌</div>
        <strong style="display: block; margin-bottom: 8px; font-size: 16px;">No Surveys</strong>
        <span style="font-size: 14px; color: rgba(255,255,255,0.6);">We don't need your life story. Just sign up and create.</span>
      </div>
      
      <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px; padding: 20px;">
        <div style="font-size: 32px; margin-bottom: 10px;">❌</div>
        <strong style="display: block; margin-bottom: 8px; font-size: 16px;">No Waiting</strong>
        <span style="font-size: 14px; color: rgba(255,255,255,0.6);">No approval process. Instant access.</span>
      </div>
      
      <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px; padding: 20px;">
        <div style="font-size: 32px; margin-bottom: 10px;">❌</div>
        <strong style="display: block; margin-bottom: 8px; font-size: 16px;">No Spam</strong>
        <span style="font-size: 14px; color: rgba(255,255,255,0.6);">We only email about important updates.</span>
      </div>
      
      <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px; padding: 20px;">
        <div style="font-size: 32px; margin-bottom: 10px;">❌</div>
        <strong style="display: block; margin-bottom: 8px; font-size: 16px;">No BS</strong>
        <span style="font-size: 14px; color: rgba(255,255,255,0.6);">Just a simple, honest signup process.</span>
      </div>
    </div>

    <h2 style="font-size: 32px; font-weight: 800; margin-top: 50px; margin-bottom: 20px; color: rgba(255,255,255,0.95); letter-spacing: -0.01em;">
      What You Get Instantly
    </h2>

    <p style="margin-bottom: 20px;">
      The moment you sign up:
    </p>

    <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(5, 150, 105, 0.08)); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; padding: 30px; margin-bottom: 40px;">
      <ul style="margin: 0; padding-left: 24px; line-height: 2;">
        <li><strong>500 free credits</strong> to test all our tools</li>
        <li><strong>Full access</strong> to video translation, TikTok captions, and AI video generation</li>
        <li><strong>No limitations</strong> on features (free credits work on everything)</li>
        <li><strong>Dashboard</strong> to track your projects and usage</li>
        <li><strong>Support</strong> if you need help</li>
      </ul>
    </div>

    <h2 style="font-size: 32px; font-weight: 800; margin-top: 50px; margin-bottom: 20px; color: rgba(255,255,255,0.95); letter-spacing: -0.01em;">
      Why We Keep It Simple
    </h2>

    <p style="margin-bottom: 16px;">
      We're content creators ourselves. We know the frustration of:
    </p>

    <ul style="margin-bottom: 30px; padding-left: 24px; line-height: 2;">
      <li>20-field signup forms</li>
      <li>"Verify your email" delays</li>
      <li>Required credit cards for "free trials"</li>
      <li>Approval waitlists</li>
      <li>Phone number requirements</li>
    </ul>

    <p style="margin-bottom: 16px; font-size: 18px; font-weight: 600; color: rgba(139, 92, 246, 1);">
      So we removed all of that.
    </p>

    <p style="margin-bottom: 30px;">
      LYPO's signup process is what we wish every platform had: <strong>fast, simple, and respectful of your time.</strong>
    </p>

    <h2 style="font-size: 32px; font-weight: 800; margin-top: 50px; margin-bottom: 20px; color: rgba(255,255,255,0.95); letter-spacing: -0.01em;">
      Security & Privacy
    </h2>

    <p style="margin-bottom: 16px;">
      Simple doesn't mean careless. Your account is secure:
    </p>

    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 30px; margin-bottom: 40px;">
      <ul style="margin: 0; padding-left: 24px; line-height: 2;">
        <li><strong>Encrypted passwords</strong> (we can't see them, even if we wanted to)</li>
        <li><strong>Secure Google OAuth</strong> for Sign-In with Google</li>
        <li><strong>HTTPS everywhere</strong> (all data encrypted in transit)</li>
        <li><strong>No data selling</strong> (we're not in that business)</li>
        <li><strong>GDPR compliant</strong> (respect for your privacy)</li>
      </ul>
    </div>

    <h2 style="font-size: 32px; font-weight: 800; margin-top: 50px; margin-bottom: 20px; color: rgba(255,255,255,0.95); letter-spacing: -0.01em;">
      Ready to Sign Up?
    </h2>

    <p style="margin-bottom: 30px; font-size: 18px;">
      It takes <strong>30 seconds</strong>. No credit card. No hassle. Just create.
    </p>

    <!-- CTA Box -->
    <div style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(59, 130, 246, 0.15)); border: 2px solid rgba(139, 92, 246, 0.4); border-radius: 16px; padding: 40px; text-align: center; margin: 50px 0;">
      <h3 style="font-size: 28px; font-weight: 800; margin-top: 0; margin-bottom: 16px; color: rgba(255,255,255,0.95);">
        Start Creating in 30 Seconds
      </h3>
      <p style="font-size: 16px; margin-bottom: 30px; color: rgba(255,255,255,0.7);">
        Join thousands of creators using LYPO to translate videos, add captions, and generate AI content.
      </p>
      <a href="auth.html" style="display: inline-block; background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%); color: white; padding: 18px 40px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 18px; box-shadow: 0 6px 30px rgba(139, 92, 246, 0.4), 0 0 60px rgba(139, 92, 246, 0.2); transition: all 0.3s ease;">
        Sign Up Now - It's Free
      </a>
      <p style="font-size: 13px; margin-top: 16px; margin-bottom: 0; color: rgba(255,255,255,0.5);">
        No credit card required • 500 free credits • Instant access
      </p>
    </div>

    <h2 style="font-size: 32px; font-weight: 800; margin-top: 50px; margin-bottom: 20px; color: rgba(255,255,255,0.95); letter-spacing: -0.01em;">
      FAQs
    </h2>

    <div style="margin-bottom: 30px;">
      <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 10px; color: rgba(139, 92, 246, 1);">
        Do I need to verify my email?
      </h3>
      <p style="margin: 0; padding-left: 20px; border-left: 2px solid rgba(139, 92, 246, 0.3);">
        No. You can start creating immediately. Email verification is optional and only needed if you want to recover your account.
      </p>
    </div>

    <div style="margin-bottom: 30px;">
      <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 10px; color: rgba(139, 92, 246, 1);">
        Is Google Sign-In safe?
      </h3>
      <p style="margin: 0; padding-left: 20px; border-left: 2px solid rgba(139, 92, 246, 0.3);">
        Yes. We use Google's official OAuth 2.0 protocol. We never see your Google password. Google handles all authentication securely.
      </p>
    </div>

    <div style="margin-bottom: 30px;">
      <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 10px; color: rgba(139, 92, 246, 1);">
        What can I do with 500 free credits?
      </h3>
      <p style="margin: 0; padding-left: 20px; border-left: 2px solid rgba(139, 92, 246, 0.3);">
        Plenty! You can translate multiple videos, generate TikTok captions for 5 videos, or create 2-3 AI-generated videos. It's enough to fully test everything.
      </p>
    </div>

    <div style="margin-bottom: 30px;">
      <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 10px; color: rgba(139, 92, 246, 1);">
        Do free credits expire?
      </h3>
      <p style="margin: 0; padding-left: 20px; border-left: 2px solid rgba(139, 92, 246, 0.3);">
        No. Your credits never expire. Use them whenever you're ready.
      </p>
    </div>

    <div style="margin-bottom: 30px;">
      <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 10px; color: rgba(139, 92, 246, 1);">
        Can I sign up with a temporary email?
      </h3>
      <p style="margin: 0; padding-left: 20px; border-left: 2px solid rgba(139, 92, 246, 0.3);">
        Technically yes, but we don't recommend it. If you forget your password or need support, you'll need access to that email. Use a real email you can access.
      </p>
    </div>

  </div>

  <!-- Final CTA -->
  <div style="margin-top: 60px; padding-top: 40px; border-top: 1px solid rgba(255,255,255,0.08); text-align: center;">
    <h2 style="font-size: 36px; font-weight: 900; margin-bottom: 20px; color: rgba(255,255,255,0.95);">
      What Are You Waiting For?
    </h2>
    <p style="font-size: 18px; margin-bottom: 30px; color: rgba(255,255,255,0.7);">
      30 seconds. That's all it takes. No tricks, no hassles, just tools.
    </p>
    <a href="auth.html" style="display: inline-block; background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%); color: white; padding: 18px 40px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 18px; box-shadow: 0 6px 30px rgba(139, 92, 246, 0.4), 0 0 60px rgba(139, 92, 246, 0.2); transition: all 0.3s ease;">
      Sign Up Now
    </a>
  </div>`,
    status: 'published'
  };

  try {
    console.log('📤 Uploading blog post...');
    
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
      throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Blog post published successfully!');
    console.log('📊 Result:', result);
    console.log('🔗 View at: https://lypo.org/post.html?slug=quick-easy-signup-30-seconds');
    
  } catch (error) {
    console.error('❌ Error uploading blog post:', error);
    console.error('💡 Make sure you\'re logged in as admin');
  }
})();
