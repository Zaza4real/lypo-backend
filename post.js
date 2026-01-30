(() => {
  const BACKEND_BASE_URL = "https://lypo-backend.onrender.com";
  const titleEl = document.getElementById("postTitle");
  const metaEl = document.getElementById("postMeta");
  const bodyEl = document.getElementById("postBody");
  const mediaEl = document.getElementById("postMedia");

  function esc(s){ return String(s||"").replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
  function fmtDate(iso){ try { return new Date(iso).toLocaleDateString(); } catch { return ""; } }

  async function load() {
    const qs = new URLSearchParams(location.search||"");
    const slug = qs.get("slug") || "";
    if (!slug) { titleEl.textContent = "Not found"; return; }
    try {
      const res = await fetch(`${BACKEND_BASE_URL}/api/blog/posts/${encodeURIComponent(slug)}`);
      const data = await res.json();
      const p = data?.post;
      if (!p) { titleEl.textContent = "Not found"; return; }

      document.title = `${p.title} • LYPO`;
      titleEl.textContent = p.title;
      metaEl.textContent = p.published_at ? fmtDate(p.published_at) : "";

      const parts = [];
      if (p.cover_url) parts.push(`<div class="postCover"><img src="${esc(p.cover_url)}" alt="${esc(p.title)}" loading="lazy" /></div>`);
      if (p.video_url) parts.push(`<div class="postVideo"><video controls preload="metadata" src="${esc(p.video_url)}"></video></div>`);
      mediaEl.innerHTML = parts.join("");

      bodyEl.innerHTML = p.content_html || (p.excerpt ? `<p>${esc(p.excerpt)}</p>` : "");
    } catch (e) {
      titleEl.textContent = "Could not load post";
    }
  }

  document.addEventListener("DOMContentLoaded", load);
})();