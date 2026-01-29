// Support page (send email via backend + Resend)
(() => {
  const AUTH_TOKEN_KEY = "lypo_token_v1";
  const BACKEND_BASE_URL = "https://lypo-backend.onrender.com";

  const $ = (id) => document.getElementById(id);
  const token = () => localStorage.getItem(AUTH_TOKEN_KEY) || "";

  // Header auth button (match homepage behavior)
  const headerBtn = $("headerAuth");
  const headerLabel = $("headerAuthLabel");

  function applyAuthState() {
    const loggedIn = Boolean(token());
    if (headerLabel) headerLabel.textContent = loggedIn ? "Logout" : "Login";
  }

  if (headerBtn) {
    applyAuthState();
    headerBtn.addEventListener("click", () => {
      if (token()) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        location.href = "index.html";
      } else {
        location.href = "auth.html";
      }
    });
  }

  async function apiFetch(path, opts = {}, sendAuth = false) {
    const headers = new Headers(opts.headers || {});
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (sendAuth && token()) headers.set("Authorization", `Bearer ${token()}`);
    const res = await fetch(`${BACKEND_BASE_URL}${path}`, { ...opts, headers });
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json().catch(() => null) : await res.text().catch(() => null);
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : (typeof data === "string" ? data : "Request failed");
      throw new Error(msg);
    }
    return data;
  }

  const btn = $("btnSupportSend");
  const hint = $("supportHint");
  const label = $("btnSupportLabel");

  function setHint(msg, isError = false) {
    if (!hint) return;
    hint.textContent = msg || "";
    hint.style.opacity = msg ? "1" : "0";
    hint.style.color = isError ? "var(--bad)" : "var(--good)";
  }

  async function send() {
    const email = ($("supportEmail")?.value || "").trim();
    const subject = ($("supportSubject")?.value || "").trim();
    const message = ($("supportMessage")?.value || "").trim();

    setHint("");
    if (!message) return setHint("Please enter a message.", true);
    if (!email && !token()) return setHint("Please enter your email.", true);

    if (btn) btn.disabled = true;
    if (label) label.textContent = "Sending…";

    try {
      await apiFetch("/api/support", {
        method: "POST",
        body: JSON.stringify({ email, subject, message })
      }, true);

      setHint("Sent! We’ll reply as soon as possible.");
      if ($("supportMessage")) $("supportMessage").value = "";
      // keep email filled
    } catch (e) {
      setHint(e?.message || "Could not send message.", true);
    } finally {
      if (btn) btn.disabled = false;
      if (label) label.textContent = "Send message";
      applyAuthState();
    }
  }

  if (btn) btn.addEventListener("click", send);
})();
