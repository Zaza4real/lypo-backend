// Shared header behavior for all pages
(() => {
  const AUTH_TOKEN_KEY = "lypo_token_v1";
  const token = () => localStorage.getItem(AUTH_TOKEN_KEY) || "";
  const isAuthed = () => !!token();

  const authBtn = document.querySelector(".headerAuthBtn");
  const dashBtn = document.querySelector('[data-nav="dashboard"]');
  const logoLink = document.querySelector(".logoWrap");
  const tabs = document.querySelectorAll(".tabBtn");

  // UNIVERSAL TAB NAV (single handler, prevents double-binding bugs)
  if (tabs && tabs.length) {
    tabs.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const href = btn.getAttribute("data-href");
        if (href) {
          location.href = href;
          return;
        }
        const tab = btn.getAttribute("data-tab") || "home";
        if (tab === "home") {
          location.href = "index.html";
        } else {
          location.href = `index.html?tab=${encodeURIComponent(tab)}`;
        }
      });
    });
  }

  // Make logo always go to homepage
  if (logoLink) {
    logoLink.setAttribute("href", "index.html");
  }

  // Highlight current page in header (dashboard / auth)
  const path = (location.pathname || "").toLowerCase();
  const isDashboard = path.includes("dashboard");
  const isAuth = path.includes("auth");
  if (dashBtn) dashBtn.classList.toggle("isActive", isDashboard);

  if (authBtn) {
    const applyAuthState = () => {
      if (isAuthed()) {
        authBtn.querySelector(".btnLabel")?.replaceChildren(document.createTextNode("Logout"));
        authBtn.setAttribute("aria-label", "Logout");
        authBtn.classList.add("isActive", false);
      } else {
        authBtn.querySelector(".btnLabel")?.replaceChildren(document.createTextNode("Login"));
        authBtn.setAttribute("aria-label", "Login");
        authBtn.classList.toggle("isActive", isAuth);
      }
    };

    applyAuthState();

    authBtn.addEventListener("click", (e) => {
      if (isAuthed()) {
        e.preventDefault();
        localStorage.removeItem(AUTH_TOKEN_KEY);
        location.href = "index.html";
        return;
      }
      // Not authed: go to login page
      location.href = "auth.html";
    });
}
})()


// Active header tab (white pill) based on current page
(function applyActiveHeaderTab(){
  const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const btns = Array.from(document.querySelectorAll(".tabs .tabBtn"));
  if (!btns.length) return;

  btns.forEach((b) => {
    const href = (b.getAttribute("data-href") || "").toLowerCase();
    const tab = (b.getAttribute("data-tab") || "").toLowerCase();
    const isHome = (page === "index.html" || page === "");
    const shouldBeActive = (href && href === page) || (isHome && tab === "home");
    b.classList.toggle("isActive", !!shouldBeActive);
    b.setAttribute("aria-selected", shouldBeActive ? "true" : "false");
  });
})();
