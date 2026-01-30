// GLOBAL DOM helper — must be defined before any usage
const $ = (id) => document.getElementById(id);
function setAuthMsg(text){ const el = $("authMsg"); if(el) el.textContent = text || ""; }

async function getSelectedVideoDurationSeconds() {
    const input = $("videoFile");
    const file = input?.files?.[0];
    if (!file) throw new Error("Please choose a video first.");
    const url = URL.createObjectURL(file);
    try {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.src = url;
      await new Promise((resolve, reject) => {
        v.onloadedmetadata = () => resolve();
        v.onerror = () => reject(new Error("Could not read video metadata"));
      });
      const seconds = Number(v.duration || 0);
      if (!Number.isFinite(seconds) || seconds <= 0) return 1;
      return Math.ceil(seconds);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

// LYPO frontend demo script (v20) — fixed (no syntax errors)
(() => {
  if (window.__LYPO_INIT__) return;
  window.__LYPO_INIT__ = true;

  const BACKEND_BASE_URL = "https://lypo-backend.onrender.com";
  const POLL_INTERVAL_MS = 1400;
  const POLL_TIMEOUT_MS = 8 * 60 * 1000;

  // Pricing hint (USD)
  const CREDITS_PER_SECOND = 10;


  // ---- Auth (email + password) + Credits
  const AUTH_TOKEN_KEY = "lypo_token_v1";
  let authToken = localStorage.getItem(AUTH_TOKEN_KEY) || "";
  let currentUser = null;

  function setAuthUI() {
    const label = $("headerAuthLabel");
    const headerBtn = $("headerAuth");
    const btnLogin = $("btnLogin");
    const logoutBtn = $("btnLogout");

    const loggedIn = Boolean(authToken && currentUser);
    const txt = loggedIn ? `Dashboard` : "Login";
    if (label) label.textContent = txt;
    if (headerBtn) headerBtn.setAttribute("aria-label", txt);
    if (btnLogin) btnLogin.querySelector(".btnLabel").textContent = txt;

    if (logoutBtn) logoutBtn.hidden = !loggedIn;
  }

  function openAuthModal() {
    const m = $("authModal");
    if (!m) return;
    m.hidden = false;
    m.setAttribute("aria-hidden", "false");
    setTimeout(() => $("authEmail")?.focus?.(), 50);
  }
  function closeAuthModal() {
    const m = $("authModal");
    if (!m) return;
    m.hidden = true;
    m.setAttribute("aria-hidden", "true");
  }

function showAuthModal(show) {
    if (show) openAuthModal();
    else closeAuthModal();
  }

  async function apiFetch(path, opts = {}, requireAuth = false) {
    const headers = new Headers(opts.headers || {});
    if (!headers.has("Content-Type") && !(opts.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    if (requireAuth) {
      if (!authToken) throw new Error("Please login first.");
      headers.set("Authorization", `Bearer ${authToken}`);
    }
    const res = await fetch(`${BACKEND_BASE_URL}${path}`, { ...opts, headers });
    let data = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) data = await res.json().catch(() => null);
    else data = await res.text().catch(() => null);
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : (typeof data === "string" ? data : "Request failed");
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function refreshMeAndBalance(silent=false) {
    try {
      if (!authToken) { currentUser = null; setAuthUI(); setBalanceUI(null); return; }
      const me = await apiFetch("/api/auth/me", { method: "GET" }, true);
      currentUser = me.user;
      setAuthUI();
      const b = await apiFetch("/api/credits", { method: "GET" }, true);
      setBalanceUI(b.balance);
      if (!silent) setStatus("Logged in.");
    } catch (e) {
      // token expired/invalid
      authToken = "";
      localStorage.removeItem(AUTH_TOKEN_KEY);
      currentUser = null;
      setAuthUI();
      setBalanceUI(null);
      if (!silent) setStatus("Session expired. Please login again.");
    }
  }

  function setBalanceUI(balance) {
    const el = $("lyposBalance");
    if (!el) return;
    if (typeof balance === "number") el.textContent = `Balance: ${balance} credits`;
    else el.textContent = "Balance: — credits";
  }

  async function ensureLoggedIn() {
    if (authToken && currentUser) return true;
    openAuthModal();
    throw new Error("Please login to continue.");
  }
  // ---- UI helpers
  function setStatus(text) {
    const st = $("statusText");
    if (st) st.textContent = text;
  }
  function setPreviewTitle(text) {
    const p = $("previewText");
    if (p) p.textContent = text;
  }
  function setPreviewHint(text) {
    const h = $("previewHint");
    if (h) h.textContent = text;
  }
  function popHint() {
    const hint = $("previewHint");
    if (!hint) return;
    hint.classList.remove("hintPop");
    void hint.offsetWidth; // reflow
    hint.classList.add("hintPop");
  }

  function showSkeleton(on) {
    const sk = $("previewSkeleton");
    if (sk) sk.hidden = !on;
  }

  function clearOutputVideo() {
    const box = $("previewBox");
    if (box) box.classList.remove("hasVideo");
    const v = $("outputVideo");
    if (!v) return;
    try { v.pause?.(); } catch {}
    v.hidden = true;
    v.removeAttribute("src");
    v.load?.();
  }

  function showOutputVideo(url) {
    const box = $("previewBox");
    if (box) box.classList.add("hasVideo");
    const v = $("outputVideo");
    if (!v) return;
    v.hidden = false;
    v.src = url;
    v.load?.();
  }

  function setBackendChip(text) {
    const el = $("chipBackend");
    if (el) el.textContent = text;
  }

  function setLoading(isLoading, text) {
    
  setGenMsg(!!isLoading);
const pill = $("statusPill");
    const progress = $("progressWrap");
    const run = $("btnRun");
    const pay = $("btnPay");

    if (pill) pill.classList.toggle("isLoading", !!isLoading);
    if (progress) progress.hidden = !isLoading;

    if (run) {
      run.disabled = !!isLoading;
      run.classList.toggle("isLoading", !!isLoading);
      // Keep the button visible while generating (disable + spinner via CSS)
      run.style.visibility = "";
    }
    if (pay) {
      pay.disabled = !!isLoading;
      pay.classList.toggle("isLoading", !!isLoading);
    }
    if (typeof text === "string") setStatus(text);
  }

  // ---- Generating messages
  const GENERATING_MESSAGES = [
    "Longer videos travel deeper paths through the machine ⏳",
    "Stay with us — good dubbing is a small act of digital divinity 😇",
    "Aligning lips, preserving voices, politely bending reality…",
    "Crafting your translated video frame by frame ✨"
  ];
  let genMsgIdx = 0;
  let genMsgTimer = null;

  function startGeneratingMessages() {
    stopGeneratingMessages();
    genMsgIdx = 0;
    popHint();
    setPreviewHint(GENERATING_MESSAGES[genMsgIdx]);
    genMsgTimer = setInterval(() => {
      genMsgIdx = (genMsgIdx + 1) % GENERATING_MESSAGES.length;
      popHint();
      setPreviewHint(GENERATING_MESSAGES[genMsgIdx]);
    }, 5200);
  }

  function stopGeneratingMessages() {
    if (genMsgTimer) {
      clearInterval(genMsgTimer);
      genMsgTimer = null;
    }
  }

  function attachAuth() {
    const btnLogin = $("btnLogin");
    const headerBtn = $("headerAuth");
    const closeEls = document.querySelectorAll('[data-close="1"]');

    // Open modal from either button
    const open = () => { setAuthMsg(""); openAuthModal(); };
    btnLogin?.addEventListener("click", open);
    headerBtn?.addEventListener("click", () => {
      if (authToken && currentUser) {
        window.location.href = "dashboard.html";
        return;
      }
      window.location.href = "auth.html";
    });

    // Close modal (backdrop / X)
    closeEls.forEach((el) => el.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation(); closeAuthModal(); }));

    // ESC closes
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAuthModal();
    });

    // Login / Signup
    $("btnDoLogin")?.addEventListener("click", async () => {
      try {
        const email = $("authEmail")?.value?.trim();
        const password = $("authPass")?.value || "";
        setAuthMsg("Logging in…");
        setStatus("Logging in…");
        const out = await apiFetch("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password })
        }, false);
        authToken = out.token;
        localStorage.setItem(AUTH_TOKEN_KEY, authToken);
        currentUser = out.user;
        setAuthUI();
        closeAuthModal();
        await refreshMeAndBalance(true);
        setStatus("Logged in.");
      } catch (e) {
        setAuthMsg(`Login failed: ${e.message || e}`);
        setStatus(`Login failed: ${e.message || e}`);
      }
    });

    $("btnDoSignup")?.addEventListener("click", async () => {
      try {
        const email = $("authEmail")?.value?.trim();
        const password = $("authPass")?.value || "";
        setAuthMsg("Creating account…");
        setStatus("Creating account…");
        const out = await apiFetch("/api/auth/signup", {
          method: "POST",
          body: JSON.stringify({ email, password })
        }, false);
        authToken = out.token;
        localStorage.setItem(AUTH_TOKEN_KEY, authToken);
        currentUser = out.user;
        setAuthUI();
        closeAuthModal();
        await refreshMeAndBalance(true);
        setStatus("Account created.");
      } catch (e) {
        setAuthMsg(`Signup failed: ${e.message || e}`);
        setStatus(`Signup failed: ${e.message || e}`);
      }
    });

    $("btnLogout")?.addEventListener("click", () => {
      authToken = "";
      currentUser = null;
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setAuthUI();
      setBalanceUI(null);
      closeAuthModal();
      setStatus("Logged out.");
    });

    // If Stripe redirected back
    const params = new URLSearchParams(location.search);
    if (params.get("paid") === "1") {
      setStatus("Payment received. Updating balance…");
      refreshMeAndBalance(true);
      // clean URL (no reload)
      params.delete("paid");
      const clean = `${location.pathname}${params.toString() ? "?" + params.toString() : ""}${location.hash}`;
      history.replaceState({}, "", clean);
    }

    // Initial session restore
    refreshMeAndBalance(true);
  }


  function attachPay() {
    const btn = $("btnPay");
    if (!btn) return;

    btn.addEventListener("click", async () => {
      try {
        await ensureLoggedIn();

        // Simple packs (USD) — change these later if you want
        const raw = prompt("How many USD worth of credits do you want to buy? (e.g. 5, 10, 25)", "10");
        if (!raw) return;
        const usd = Number(raw);
        if (!Number.isFinite(usd) || usd <= 0) throw new Error("Invalid amount");

        setLoading(true, "Opening payment…");
        const data = await apiFetch("/api/stripe/create-checkout-session", {
          method: "POST",
          body: JSON.stringify({ usd })
        }, true);

        window.location.href = data.url; // redirect to Stripe Checkout
      } catch (e) {
        setLoading(false, "Ready");
        setStatus(`Payment error: ${e.message || e}`);
      }
    });
  }

  // ---- Download (blob only; avoids fullscreen/player)
  function resetDownload() {
    const btn = $("btnDownload");
    if (!btn) return;
    btn.hidden = true;
    btn.classList.remove("isReady");
    btn.setAttribute("aria-disabled", "true");
    btn.setAttribute("tabindex", "-1");
    btn.dataset.url = "";
  }

  function enableDownload(url) {
    const btn = $("btnDownload");
    if (!btn) return;
    btn.hidden = false;
    btn.dataset.url = url;
    btn.classList.add("isReady");
    btn.setAttribute("aria-disabled", "false");
    btn.removeAttribute("tabindex");
  }

  function guessMp4Name() {
    const original = $("videoFile")?.files?.[0]?.name || "video";
    const base = original.replace(/\.[^.]+$/, "");
    return `${base}-translated.mp4`;
  }

  async function downloadViaBlob(url, filename) {
    // Requires CORS on outputUrl OR proxy from your backend
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

    const originalBlob = await res.blob();
    const blob = new Blob([originalBlob], { type: "application/octet-stream" });

    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(blobUrl), 2500);
  }

  // ---- Tabs
  function attachTabs() {
    const tabBtns = Array.from(document.querySelectorAll(".tabBtn")).filter((b) => b.dataset && b.dataset.tab);
    const panels = Array.from(document.querySelectorAll(".tabPanel"));
    const goHome = document.querySelector("[data-go='home']");

    // Buttons that navigate to separate pages (e.g., Support / About / Features)
    const linkBtns = Array.from(document.querySelectorAll('.tabBtn[data-href]'));
    linkBtns.forEach((b) => b.addEventListener('click', () => {
      const href = b.dataset.href;
      if (href) location.href = href;
    }));


    function activate(tab) {
      tabBtns.forEach((b) => {
        const on = b.dataset.tab === tab;
        b.classList.toggle("isActive", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      panels.forEach((p) => p.classList.toggle("isActive", p.id === `tab-${tab}`));
    }

    tabBtns.forEach((b) => b.addEventListener("click", () => activate(b.dataset.tab)));
    goHome?.addEventListener("click", (e) => {
      e.preventDefault();
      activate("home");
    });
  }

  // ---- Networking
  async function fetchJson(url, options = {}) {
    // Automatically attach JWT when available
    const headers = new Headers(options.headers || {});
    if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
    const res = await fetch(url, { ...options, headers });
    const isJson = (res.headers.get("content-type") || "").includes("application/json");
    if (!res.ok) {
      const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");
      throw new Error(typeof body === "string" ? body : (body?.error || `HTTP ${res.status}`));
    }
    return isJson ? res.json() : null;
  }

  // ---- Languages (Replicate expects full names)
  async function loadLanguages() {
    const select = $("targetLang");
    if (!select) return;

    const MAP = {
      "en":"English","es":"Spanish","fr":"French","de":"German","it":"Italian","pt":"Portuguese",
      "nl":"Dutch","tr":"Turkish","ko":"Korean","da":"Danish","ar":"Arabic","ro":"Romanian",
      "zh":"Chinese","ja":"Japanese","sv":"Swedish","id":"Indonesian","uk":"Ukrainian","el":"Greek",
      "cs":"Czech","bg":"Bulgarian","ms":"Malay","sk":"Slovak","hr":"Croatian","ta":"Tamil","fi":"Finnish","ru":"Russian",
      "pl":"Polish","hi":"Hindi","fil":"Filipino"
    };

    const FALLBACK = [
      "Arabic","Arabic (Egypt)","Arabic (Saudi Arabia)","Bulgarian","Chinese","Chinese (Mandarin, Simplified)","Chinese (Taiwanese Mandarin, Traditional)",
      "Croatian","Czech","Danish","Dutch","English","English (Australia)","English (Canada)","English (India)","English (UK)","English (United States)",
      "Filipino","Finnish","French","French (Canada)","French (France)","German","German (Austria)","German (Germany)","German (Switzerland)",
      "Greek","Hindi","Indonesian","Italian","Japanese","Korean","Malay","Mandarin","Polish","Portuguese","Portuguese (Brazil)","Portuguese (Portugal)",
      "Romanian","Russian","Russian (Russia)","Slovak","Spanish","Spanish (Mexico)","Spanish (Spain)","Swedish","Tamil","Turkish","Turkish (Türkiye)",
      "Ukrainian","Ukrainian (Ukraine)"
    ];

    function normalize(item) {
      if (!item) return null;
      if (typeof item === "string") {
        const v = MAP[item] || item;
        return { value: v, label: v };
      }
      const raw = item.name || item.label || item.title || item.value || item.code;
      if (!raw) return null;
      const code = (item.code || "").toLowerCase();
      const v = MAP[raw] || MAP[code] || raw;
      return { value: v, label: v };
    }

    function fill(list) {
      select.innerHTML = "";
      list.forEach((it) => {
        const opt = document.createElement("option");
        opt.value = it.value;
        opt.textContent = it.label;
        select.appendChild(opt);
      });
    }

    try {
      const raw = await fetchJson(`${BACKEND_BASE_URL}/api/languages`);
      const items = (raw || []).map(normalize).filter(Boolean);

      if (items.length) {
        const seen = new Set();
        const uniq = [];
        for (const it of items) {
          if (seen.has(it.value)) continue;
          seen.add(it.value);
          uniq.push(it);
        }
        uniq.sort((a,b) => a.label.localeCompare(b.label));
        fill(uniq);
        return;
      }
      throw new Error("Empty language list");
    } catch {
      fill(FALLBACK.map((x) => ({ value: x, label: x })));
    }
  }

  // ---- Backend health
  async function checkBackend() {
    try {
      await fetchJson(`${BACKEND_BASE_URL}/health`);
      setBackendChip("Backend: connected ✓");
    } catch {
      setBackendChip("Backend: not connected");
    }
  }

  // ---- Cost estimate + upload picker
  function estimateCreditsFromSeconds(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.max(1, Math.ceil(seconds)) * CREDITS_PER_SECOND;
  }

  function attachUploadPicker() {
    const input = $("videoFile");
    const pickBtn = $("btnPickVideo");
    const nameEl = $("videoName");
    if (!input || !pickBtn) return;

    const setName = (file) => { if (nameEl) nameEl.textContent = file ? file.name : "or drop it here"; };

    pickBtn.addEventListener("click", () => input.click());

    input.addEventListener("change", () => {
      const file = input.files?.[0] || null;
      setName(file);

      resetDownload();
      clearOutputVideo();
      showSkeleton(false);
      stopGeneratingMessages();
      setPreviewTitle("No output yet");
      setPreviewHint("Generated video will appear here");

      const costEl = $("costEstimate");
      const pay = $("btnPay");

      if (!file) {
        if (costEl) costEl.textContent = "";
        if (pay) pay.querySelector(".btnLabel").textContent = "Pay";
        return;
      }

      const tmp = document.createElement("video");
      tmp.preload = "metadata";
      tmp.onloadedmetadata = () => {
        const seconds = Number(tmp.duration);
        const est = estimateCreditsFromSeconds(seconds);
        if (costEl && est) costEl.textContent = `Estimated: ${est} credits`;
        if (pay && est) pay.querySelector(".btnLabel").textContent = `Pay (buy credits)`;
        URL.revokeObjectURL(tmp.src);
      };
      tmp.src = URL.createObjectURL(file);
    });

    ["dragenter","dragover"].forEach((ev) => {
      pickBtn.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        pickBtn.classList.add("dragOver");
      });
    });
    ["dragleave","drop"].forEach((ev) => {
      pickBtn.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        pickBtn.classList.remove("dragOver");
      });
    });
    pickBtn.addEventListener("drop", (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      input.files = e.dataTransfer.files;
      input.dispatchEvent(new Event("change"));
    });
  }

  // ---- Polling + run
  async function pollJob(jobId) {
    const start = Date.now();
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      const j = await fetchJson(`${BACKEND_BASE_URL}/api/dub/${encodeURIComponent(jobId)}`);
      if (j?.status === "succeeded" && j?.outputUrl) return j;
      if (j?.status === "failed") throw new Error(j?.error || "Job failed");
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      setStatus("Generating…");
    }
    throw new Error("Timed out waiting for result");
  }

  async function runUploadDub() {
    const input = $("videoFile");
    const select = $("targetLang");
    const file = input?.files?.[0];
    const outputLanguage = select?.value; // full name

    if (!file) return setStatus("Please choose a video first.");
    if (!outputLanguage) return setStatus("Please select a target language.");

    resetDownload();
    clearOutputVideo();
    showSkeleton(true);
    setPreviewTitle("Generating…");
    startGeneratingMessages();

    try {
      await ensureLoggedIn();      // Credits are charged server-side in /api/dub-upload (authoritative)

      const seconds = await getSelectedVideoDurationSeconds();
      const costCredits = Math.max(1, Math.ceil(seconds)) * CREDITS_PER_SECOND;
      if (!confirm(`This video is ~${seconds}s. Cost: ${costCredits} credits. Continue?`)) {
        setLoading(false, "Ready");
        stopGeneratingMessages();
        showSkeleton(false);
        setPreviewTitle("Cancelled");
        setPreviewHint("Upload cancelled.");
        return;
      }

      setLoading(true, "Uploading…");

      const fd = new FormData();
      fd.append("video", file);
      fd.append("output_language", outputLanguage);
      if (typeof seconds === "number" && Number.isFinite(seconds)) fd.append("seconds", String(seconds));

      const up = await fetchJson(`${BACKEND_BASE_URL}/api/dub-upload`, { method: "POST", body: fd });
      const jobId = up?.id || up?.jobId || up?.predictionId;
      if (!jobId) throw new Error("No job id returned from server.");

      setStatus("Generating…");
      const final = await pollJob(jobId);

      setLoading(false, "Ready ✅");
      stopGeneratingMessages();
      showSkeleton(false);

      showOutputVideo(final.outputUrl);
      enableDownload(final.outputUrl);

      setPreviewTitle("Output ready");
      setPreviewHint("Preview is playable. Click Download to save the MP4.");
    } catch (e) {
      setLoading(false, "Error");
      stopGeneratingMessages();
      showSkeleton(false);
      clearOutputVideo();
      setPreviewTitle("Error");
      setPreviewHint("Something went wrong.");
      setStatus(`Error: ${e?.message || e}`);
    }
  }
  // ---- Mini showcase (English ➜ French)
  function attachMiniShowcase() {
    const vids = {
      english: $("miniEnglish"),
      french: $("miniFrench"),
    };
    const tiles = {
      english: vids.english?.closest(".miniVid") || null,
      french: vids.french?.closest(".miniVid") || null,
    };
    const buttons = Array.from(document.querySelectorAll(".miniPlay"));

    // no loop by default (keeps audio sane)
    Object.values(vids).forEach((v) => { if (v) v.loop = false; });

    function setPlaying(key, on) {
      const tile = tiles[key];
      const btn = document.querySelector(`.miniPlay[data-play="${key}"]`);
      if (tile) tile.classList.toggle("isPlaying", !!on);
      if (btn) btn.textContent = on ? "❚❚" : "▶";
    }

    function stopAll() {
      Object.entries(vids).forEach(([key, v]) => {
        try { v?.pause(); } catch {}
        setPlaying(key, false);
      });
    }

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.play;
        const v = vids[key];
        if (!v) return;

        const isPlaying = !v.paused && !v.ended;
        stopAll();

        if (!isPlaying) {
          v.play().then(() => setPlaying(key, true)).catch(() => {});
        }
      });
    });

    // Sync UI with actual playback state
    Object.entries(vids).forEach(([key, v]) => {
      v?.addEventListener("play", () => setPlaying(key, true));
      v?.addEventListener("pause", () => setPlaying(key, false));
      v?.addEventListener("ended", () => setPlaying(key, false));
      v?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
    });

    // Auto-pause when the showcase scrolls out of view
    // (pauses any playing preview as soon as it is not meaningfully visible)
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.35) {
            stopAll();
          }
        }
      }, { threshold: [0, 0.15, 0.35, 0.6, 1] });

      const tab = document.querySelector(".showcaseTab");
      if (tab) io.observe(tab);
    } else {
      // Fallback: pause on scroll
      window.addEventListener("scroll", () => stopAll(), { passive: true });
    }
  }


  function attachDownload() {
    const btn = $("btnDownload");
    if (!btn) return;

    btn.addEventListener("click", async () => {
      const raw = btn.dataset.url;
      if (!raw || btn.getAttribute("aria-disabled") === "true") return;

      const filename = guessMp4Name();
      try {
        await downloadViaBlob(raw, filename);
      } catch {
        setStatus("Download blocked by server (CORS) ⚠️");
        setPreviewHint("To force download without opening the player: enable CORS on outputUrl or proxy it via your backend.");
      }
    });
  }


// Buy credits (integrated modal, opens Stripe in a new tab)
// Buy credits (inline)
(function attachBuyCredits(){
  const BACKEND_BASE_URL = "https://lypo-backend.onrender.com";
  const AUTH_TOKEN_KEY = "lypo_token_v1";
  const CREDITS_PER_USD = 100; // matches backend LYPOS_PER_USD

  const payBtn = document.getElementById("btnPay");
  const usdInput = document.getElementById("payUsd");
  const preview = document.getElementById("payCreditsPreview");
  const msg = document.getElementById("payMsg");
  const goBtn = document.getElementById("btnPayGo");
  const hint = document.getElementById("payPopupHint");
  const openLink = document.getElementById("payOpenLink");

  function setMsg(t){ if (msg) msg.textContent = t || ""; }
  function setPreview(){
    if (!usdInput || !preview) return;
    const usd = Number(usdInput.value || 0);
    const credits = Math.max(0, Math.round(usd * CREDITS_PER_USD));
    preview.textContent = `${credits} credits`;
  }

  // quick buttons
  document.querySelectorAll("[data-usd]").forEach((btn)=>{
    btn.addEventListener("click", ()=>{
      const v = Number(btn.getAttribute("data-usd") || 0);
      if (usdInput) usdInput.value = String(v || 5);
      setPreview();
      setMsg("");
    });
  });
  usdInput?.addEventListener("input", ()=>{ setPreview(); setMsg(""); });

  // Pay button just focuses the inline card
  payBtn?.addEventListener("click", () => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY) || "";
    if (!token) { try { showAuthModal(true); } catch {} return; }
    usdInput?.focus?.();
    usdInput?.scrollIntoView?.({behavior:"smooth", block:"center"});
  });

  goBtn?.addEventListener("click", async () => {
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY) || "";
      if (!token) { try { showAuthModal(true); } catch {} return; }

      const usd = Number(usdInput?.value || 0);
      if (!Number.isFinite(usd) || usd <= 0) { setMsg("Please enter a valid amount."); return; }

      setMsg("Opening secure checkout…");
      hint && (hint.style.display = "none");
      openLink && (openLink.href = "#");

      const res = await fetch(`${BACKEND_BASE_URL}/api/stripe/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ usd }),
      });

      const ct = res.headers.get("content-type") || "";
      const payload = ct.includes("application/json") ? await res.json().catch(()=>({})) : await res.text().catch(()=> "");
      if (!res.ok) throw new Error(payload?.error || (typeof payload === "string" ? payload : "Failed to create checkout session"));

      const url = payload?.url;
      if (!url) throw new Error("Missing checkout URL");

      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (!w) {
        if (openLink) openLink.href = url;
        if (hint) hint.style.display = "block";
        setMsg("Your browser blocked the popup. Use the link below to open checkout.");
        return;
      }

      setMsg("Checkout opened in a new tab.");
    } catch (e) {
      setMsg(`Payment error: ${e?.message || e}`);
    }
  });

  setPreview();
})();




  function setYear() {
    const y = $("year");
    if (y) y.textContent = String(new Date().getFullYear());
  }

  function lockPreviewBox() {
    $("previewBox")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  // ---- INIT
  attachTabs();
  setYear();
  attachUploadPicker();
  attachDownload();
  attachPay();
  attachAuth();
  attachMiniShowcase();
  lockPreviewBox();

  resetDownload();
  clearOutputVideo();
  showSkeleton(false);
  setPreviewTitle("No output yet");
  setPreviewHint("Generated video will appear here");

  loadLanguages();
  checkBackend();

  $("btnRun")?.addEventListener("click", runUploadDub);
})();


function setGenMsg(isGenerating){
  const el = document.getElementById("genMsg");
  if (!el) return;
  el.hidden = !isGenerating;
}
