(() => {
  const form = document.getElementById("feedbackForm");
  const nameEl = document.getElementById("fbName");
  const commentEl = document.getElementById("fbComment");
  const thanksEl = document.getElementById("fbThanks");
  const starLabel = document.getElementById("starLabel");
  const randomBtn = document.getElementById("fbRandom");
  const starRow = document.getElementById("starRow");

  let stars = 0;

  function setStars(n) {
    stars = n;
    const btns = Array.from(starRow.querySelectorAll("button[data-star]"));
    btns.forEach((b) => {
      const s = Number(b.dataset.star || 0);
      // Use existing button styles; only tweak opacity to show selection
      b.style.opacity = s <= stars ? "1" : "0.35";
    });
    starLabel.textContent = stars ? `${stars} / 5` : "No rating selected";
  }

  function randomName() {
    const names = ["Alex", "Sam", "Maya", "Noah", "Lina", "Chris", "Zoe", "Leo", "Ava", "Ben"];
    return names[Math.floor(Math.random() * names.length)];
  }

  starRow.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-star]");
    if (!btn) return;
    setStars(Number(btn.dataset.star || 0));
  });

  randomBtn.addEventListener("click", () => {
    nameEl.value = randomName();
    nameEl.focus();
  });

  // default visuals
  setStars(0);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const payload = {
      name: (nameEl.value || "").trim() || "Anonymous",
      stars,
      comment: (commentEl.value || "").trim(),
      createdAt: new Date().toISOString()
    };

    if (!payload.comment) return;

    // Simple local storage saving (no backend changes)
    try {
      const key = "lypo_feedback";
      const existing = JSON.parse(localStorage.getItem(key) || "[]");
      existing.unshift(payload);
      localStorage.setItem(key, JSON.stringify(existing.slice(0, 25)));
    } catch {}

    form.reset();
    setStars(0);
    thanksEl.style.display = "block";
    setTimeout(() => (thanksEl.style.display = "none"), 3500);
  });
})();