"use strict";

const API = "api/film";
const POLL_MS = 2000;
const MIN_FAVS = 3;
const MAX_FAVS = 5;

const app = document.getElementById("app");
const roomTag = document.getElementById("roomTag");

let config = { tmdb: false, genres: [] };
let session = loadSession();   // { code, token }
let state = null;
let view = "";                 // vilken vy som är renderad
let pollTimer = null;
let editingPrefs = false;
let favs = [];
let pickedGenres = new Set();
let deck = [];                 // filmer kvar att swipa
let deckTotal = 0;

// ---------- Hjälpfunktioner ----------

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function loadSession() {
  try { return JSON.parse(localStorage.getItem("filmkvall") || "null"); } catch (_) { return null; }
}
function saveSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem("filmkvall", JSON.stringify(s));
    else localStorage.removeItem("filmkvall");
  } catch (_) {}
}
function savedName() { try { return localStorage.getItem("filmkvall_name") || ""; } catch (_) { return ""; } }
function rememberName(n) { try { localStorage.setItem("filmkvall_name", n); } catch (_) {} }

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

async function api(path, body) {
  const opts = { headers: { "Content-Type": "application/json" } };
  if (session && session.token) opts.headers["X-Token"] = session.token;
  if (body !== undefined) { opts.method = "POST"; opts.body = JSON.stringify(body); }
  const res = await fetch(API + path, opts);
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = new Error((data && data.message) || "Något gick fel (" + res.status + ")");
    err.status = res.status;
    throw err;
  }
  return data;
}

function roomLink(code) {
  return location.origin + location.pathname + "?r=" + encodeURIComponent(code);
}

function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

function posterUrl(m) { return m.poster ? "poster/" + encodeURIComponent(m.id) : null; }

function metaLine(m) {
  const bits = [];
  if (m.year) bits.push(m.year);
  if (m.rating) bits.push("★ " + m.rating);
  if (m.runtime) bits.push(m.runtime + " min");
  if (m.age) bits.push(m.age);
  return bits.join(" · ");
}

function setView(name, html) {
  view = name;
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

// ---------- Start ----------

async function init() {
  try { config = await api("/config"); }
  catch (e) { toast("Kunde inte nå servern: " + e.message); }

  const urlCode = new URLSearchParams(location.search).get("r");
  if (session && (!urlCode || urlCode.toUpperCase() === session.code)) {
    startPolling();
  } else {
    showHome(urlCode ? urlCode.toUpperCase() : "");
  }
}

function showHome(code) {
  stopPolling();
  roomTag.hidden = true;
  const name = esc(savedName());
  setView("home", `
    <h1>Vad ska vi se ikväll?</h1>
    <p class="muted">Alla väljer favoriter och genrer, sedan swipar ni på förslag från filmbiblioteket. Filmen flest gillar vinner.</p>
    <div class="panel">
      <label for="name">Ditt namn</label>
      <input id="name" type="text" maxlength="40" autocomplete="given-name" value="${name}" placeholder="t.ex. Anna">
      ${code ? `
        <label>Rum</label>
        <div class="big-code">${esc(code)}</div>
        <button class="primary block" id="join">Gå med</button>
        <button class="link" id="other">Skapa ett eget rum i stället</button>
      ` : `
        <button class="primary block" id="create">Skapa nytt rum</button>
        <div class="divider">eller gå med i ett rum</div>
        <div class="row">
          <input id="code" class="code-input" type="text" maxlength="6" placeholder="KOD" autocapitalize="characters">
          <button id="join" style="flex:0 0 auto">Gå med</button>
        </div>
      `}
    </div>`);

  const nameEl = document.getElementById("name");
  const getName = () => {
    const n = nameEl.value.trim();
    if (!n) { toast("Skriv ditt namn först."); nameEl.focus(); return null; }
    rememberName(n);
    return n;
  };

  const create = document.getElementById("create");
  if (create) create.onclick = async () => {
    const n = getName(); if (!n) return;
    create.disabled = true;
    try { enterRoom(await api("/rooms", { name: n })); }
    catch (e) { toast(e.message); create.disabled = false; }
  };

  const join = document.getElementById("join");
  join.onclick = async () => {
    const n = getName(); if (!n) return;
    const c = code || document.getElementById("code").value.trim().toUpperCase();
    if (!c) { toast("Skriv rumskoden."); return; }
    join.disabled = true;
    try { enterRoom(await api("/rooms/" + encodeURIComponent(c) + "/join", { name: n })); }
    catch (e) { toast(e.message); join.disabled = false; }
  };

  const other = document.getElementById("other");
  if (other) other.onclick = () => { history.replaceState(null, "", location.pathname); showHome(""); };
}

function enterRoom(res) {
  saveSession({ code: res.code, token: res.token });
  history.replaceState(null, "", "?r=" + encodeURIComponent(res.code));
  favs = []; pickedGenres = new Set(); deck = []; editingPrefs = false;
  startPolling();
}

function leaveRoom() {
  saveSession(null);
  state = null;
  history.replaceState(null, "", location.pathname);
  showHome("");
}

// ---------- Polling ----------

function startPolling() {
  stopPolling();
  if (!view || view === "home") app.innerHTML = '<div class="spinner"></div>';
  poll();
}
function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }

async function poll() {
  if (!session) return;
  try {
    state = await api("/rooms/" + encodeURIComponent(session.code));
    render();
  } catch (e) {
    if (e.status === 403 || e.status === 404) {
      toast(e.message);
      leaveRoom();
      return;
    }
  }
  pollTimer = setTimeout(poll, POLL_MS);
}

function render() {
  roomTag.hidden = false;
  roomTag.textContent = "Rum " + state.code;

  if (state.status === "lobby") {
    if (!state.me.ready || editingPrefs) {
      if (view !== "prefs") showPrefs();
      updatePeople();
    } else {
      if (view !== "lobby") showLobby();
      updateLobby();
    }
  } else if (state.status === "swiping") {
    if (view === "swipe") return;              // swipar lokalt, stör inte
    if (view !== "waiting") {
      if (!state.me.done) { showSwipe(); if (view === "swipe") return; }
      else showWaiting();
    }
    updateWaiting();
  } else if (state.status === "done") {
    if (view !== "results") showResults();
  }
}

// ---------- Delning ----------

function shareBox() {
  const link = roomLink(state.code);
  return `
    <div class="panel share">
      <div class="qr">${qrSvg(link)}</div>
      <div>
        <div class="muted small">Rumskod</div>
        <div class="big-code">${esc(state.code)}</div>
        <button id="share" style="margin-top:6px">Dela länk</button>
      </div>
    </div>`;
}

function bindShare() {
  const b = document.getElementById("share");
  if (!b) return;
  b.onclick = async () => {
    const link = roomLink(state.code);
    if (navigator.share) {
      try { await navigator.share({ title: "Filmkväll", text: "Gå med i rum " + state.code, url: link }); return; } catch (_) { return; }
    }
    try { await navigator.clipboard.writeText(link); toast("Länken är kopierad."); }
    catch (_) { prompt("Kopiera länken:", link); }
  };
}

function peopleHtml(withProgress) {
  return state.participants.map((p) => {
    let right;
    if (withProgress) {
      const pct = state.total ? Math.round(100 * p.swiped / state.total) : 0;
      right = p.done ? '<span class="badge ok">Klar</span>' : `<span class="bar"><i style="width:${pct}%"></i></span>`;
    } else {
      right = p.ready ? '<span class="badge ok">Klar</span>' : '<span class="badge">Väljer…</span>';
    }
    return `<li><span>${esc(p.name)}${p.host ? " 👑" : ""}${p.id === state.me.id ? ' <span class="muted small">(du)</span>' : ""}</span>${right}</li>`;
  }).join("");
}

function updatePeople() {
  const ul = document.getElementById("people");
  if (ul) ul.innerHTML = peopleHtml(false);
}

// ---------- Val av favoriter och genrer ----------

function showPrefs() {
  if (state.me.ready || editingPrefs) {
    favs = state.me.favorites.slice();
    pickedGenres = new Set(state.me.genres);
  }
  setView("prefs", `
    ${shareBox()}
    ${config.tmdb ? `
      <h2>Dina favoritfilmer</h2>
      <p class="muted small">Välj ${MIN_FAVS}–${MAX_FAVS} filmer du älskar. De kan vara vilka filmer som helst.</p>
      <div id="favs" class="chips"></div>
      <input id="search" type="text" placeholder="Sök film…" autocomplete="off" style="margin-top:10px">
      <ul id="results" class="results"></ul>
    ` : ""}
    <h2>Vad är du sugen på?</h2>
    <p class="muted small">Välj en eller flera genrer (valfritt).</p>
    <div id="genres" class="chips"></div>
    <button id="ready" class="primary block">Klar</button>
    <h2>I rummet</h2>
    <div class="panel"><ul id="people" class="people"></ul></div>
    <button class="link" id="leave">Lämna rummet</button>
  `);
  bindShare();
  document.getElementById("leave").onclick = leaveRoom;

  const gEl = document.getElementById("genres");
  gEl.innerHTML = config.genres.map((g) =>
    `<button class="chip${pickedGenres.has(g.name) ? " on" : ""}" data-g="${esc(g.name)}">${esc(g.name)}</button>`).join("")
    || '<span class="muted small">Inga genrer hittades.</span>';
  gEl.onclick = (ev) => {
    const b = ev.target.closest("[data-g]");
    if (!b) return;
    const g = b.dataset.g;
    if (pickedGenres.has(g)) pickedGenres.delete(g); else pickedGenres.add(g);
    b.classList.toggle("on");
  };

  if (config.tmdb) {
    renderFavs();
    const input = document.getElementById("search");
    const list = document.getElementById("results");
    let timer, seq = 0, lastResults = [];
    input.oninput = () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { list.innerHTML = ""; return; }
      timer = setTimeout(async () => {
        const my = ++seq;
        try {
          const r = await api("/search?q=" + encodeURIComponent(q));
          if (my !== seq) return;
          lastResults = r;
          list.innerHTML = r.map((m, i) => `
            <li data-i="${i}">
              ${m.poster ? `<img class="thumb" src="${esc(m.poster)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="thumb"></span>'}
              <span>${esc(m.title)} <span class="muted">${m.year ? "(" + m.year + ")" : ""}</span></span>
            </li>`).join("") || '<li class="muted">Inga träffar</li>';
        } catch (e) { toast(e.message); }
      }, 350);
    };
    list.onclick = (ev) => {
      const li = ev.target.closest("[data-i]");
      if (!li) return;
      const m = lastResults[+li.dataset.i];
      if (favs.some((f) => f.id === m.id)) { toast("Den är redan vald."); return; }
      if (favs.length >= MAX_FAVS) { toast("Max " + MAX_FAVS + " favoriter."); return; }
      favs.push(m);
      renderFavs();
      input.value = ""; list.innerHTML = ""; input.focus();
    };
  }

  const ready = document.getElementById("ready");
  ready.onclick = async () => {
    if (config.tmdb && favs.length < MIN_FAVS) { toast("Välj minst " + MIN_FAVS + " favoritfilmer."); return; }
    ready.disabled = true;
    try {
      state = await api("/rooms/" + encodeURIComponent(session.code) + "/prefs", { favorites: favs, genres: [...pickedGenres] });
      editingPrefs = false;
      render();
    } catch (e) { toast(e.message); ready.disabled = false; }
  };
}

function renderFavs() {
  const el = document.getElementById("favs");
  if (!el) return;
  el.innerHTML = favs.map((f, i) => `
    <span class="fav">
      ${f.poster ? `<img class="thumb" src="${esc(f.poster)}" alt="" onerror="this.remove()">` : ""}
      <span>${esc(f.title)}</span>
      <button data-rm="${i}" aria-label="Ta bort">✕</button>
    </span>`).join("") || `<span class="muted small">Inga valda ännu (0/${MAX_FAVS})</span>`;
  el.onclick = (ev) => {
    const b = ev.target.closest("[data-rm]");
    if (!b) return;
    favs.splice(+b.dataset.rm, 1);
    renderFavs();
  };
}

// ---------- Väntar på start ----------

function showLobby() {
  setView("lobby", `
    ${shareBox()}
    <h2>I rummet</h2>
    <div class="panel"><ul id="people" class="people"></ul></div>
    <div id="lobbyAction"></div>
    <button class="link" id="edit">Ändra mina val</button>
    <button class="link" id="leave" style="margin-left:16px">Lämna rummet</button>
  `);
  bindShare();
  document.getElementById("edit").onclick = () => { editingPrefs = true; showPrefs(); updatePeople(); };
  document.getElementById("leave").onclick = leaveRoom;
}

function updateLobby() {
  updatePeople();
  const box = document.getElementById("lobbyAction");
  const allReady = state.participants.every((p) => p.ready);
  const key = state.me.host + ":" + allReady + ":" + state.participants.length;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  if (state.me.host) {
    box.innerHTML = `
      <button id="start" class="primary block" ${allReady ? "" : "disabled"}>Starta swipandet</button>
      <p class="muted small center">${allReady
        ? (state.participants.length < 2 ? "Du är ensam i rummet, men det går att köra ändå." : "Alla är klara!")
        : "Väntar på att alla ska bli klara."}</p>`;
    document.getElementById("start").onclick = async (ev) => {
      ev.target.disabled = true;
      ev.target.textContent = "Letar fram filmer…";
      try { state = await api("/rooms/" + encodeURIComponent(session.code) + "/start", {}); render(); }
      catch (e) { toast(e.message); ev.target.disabled = false; ev.target.textContent = "Starta swipandet"; }
    };
  } else {
    box.innerHTML = '<p class="muted center">Väntar på att värden startar swipandet…</p>';
  }
}

// ---------- Swipe ----------

function showSwipe() {
  const done = state.mySwipes || {};
  deck = state.candidates.filter((c) => !(c.id in done));
  deckTotal = state.candidates.length;
  if (!deck.length) { showWaiting(); return; }
  setView("swipe", `
    <div class="progress"><span id="count"></span><span>← nej · ja →</span></div>
    <div class="deck" id="deck"></div>
    <div class="controls">
      <button class="round nope" id="nope" aria-label="Nej">✕</button>
      <button class="round like" id="like" aria-label="Ja">♥</button>
    </div>`);
  document.getElementById("nope").onclick = () => fling(false);
  document.getElementById("like").onclick = () => fling(true);
  drawDeck();
}

function cardHtml(m) {
  const p = posterUrl(m);
  const why = [];
  if (m.because && m.because.length) why.push("Liknar " + m.because.map(esc).join(", "));
  else if (m.genreMatches && m.genreMatches.length) why.push("Passar: " + m.genreMatches.map(esc).join(", "));
  return `
    <div class="fallback">${esc(m.title)}</div>
    ${p ? `<img class="poster" src="${p}" alt="" onerror="this.remove()">` : ""}
    <div class="stamp like">JA</div>
    <div class="stamp nope">NEJ</div>
    <div class="info">
      <div class="title">${esc(m.title)}</div>
      <div class="meta">${esc(metaLine(m))}</div>
      ${why.length ? `<div class="why">${why.join(" · ")}</div>` : ""}
      ${m.overview ? `<div class="overview">${esc(m.overview)}</div>` : ""}
      <div class="tags">${(m.genres || []).map((g) => `<span>${esc(g)}</span>`).join("")}</div>
    </div>`;
}

function drawDeck() {
  const el = document.getElementById("deck");
  if (!el) return;
  document.getElementById("count").textContent =
    Math.min(deckTotal - deck.length + 1, deckTotal) + " / " + deckTotal;
  el.innerHTML = "";
  // Rita de två översta korten, det översta sist så det hamnar överst.
  deck.slice(0, 2).reverse().forEach((m, i, arr) => {
    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = cardHtml(m);
    if (i < arr.length - 1) c.style.transform = "scale(.95) translateY(10px)";
    el.appendChild(c);
  });
  const top = el.lastElementChild;
  if (top) attachDrag(top);
  // Förladda nästa affisch
  if (deck[2] && deck[2].poster) { const img = new Image(); img.src = posterUrl(deck[2]); }
}

function attachDrag(card) {
  let startX = 0, startY = 0, dx = 0, dy = 0, dragging = false, moved = false;
  const like = card.querySelector(".stamp.like");
  const nope = card.querySelector(".stamp.nope");

  card.addEventListener("pointerdown", (e) => {
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY; dx = dy = 0;
    card.classList.add("dragging");
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dx = e.clientX - startX; dy = e.clientY - startY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
    card.style.transform = `translate(${dx}px, ${dy * 0.3}px) rotate(${dx / 18}deg)`;
    like.style.opacity = Math.max(0, Math.min(1, dx / 100));
    nope.style.opacity = Math.max(0, Math.min(1, -dx / 100));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("dragging");
    if (Math.abs(dx) > 100) { fling(dx > 0, card); return; }
    card.style.transform = "";
    like.style.opacity = nope.style.opacity = 0;
    if (!moved) card.classList.toggle("open"); // tryck = visa hela handlingen
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

let flinging = false;
function fling(isLike, card) {
  if (flinging || !deck.length) return;
  const el = document.getElementById("deck");
  card = card || (el && el.lastElementChild);
  if (!card) return;
  flinging = true;
  const m = deck[0];
  card.querySelector(isLike ? ".stamp.like" : ".stamp.nope").style.opacity = 1;
  card.style.transform = `translate(${isLike ? 600 : -600}px, 40px) rotate(${isLike ? 30 : -30}deg)`;

  sendSwipe(m.id, isLike);
  setTimeout(() => {
    deck.shift();
    flinging = false;
    if (deck.length) drawDeck();
    else { showWaiting(); updateWaiting(); }
  }, 220);
}

async function sendSwipe(movie, like, attempt) {
  try {
    await api("/rooms/" + encodeURIComponent(session.code) + "/swipe", { movie: movie, like: like });
  } catch (e) {
    if ((attempt || 0) < 2 && e.status !== 400) setTimeout(() => sendSwipe(movie, like, (attempt || 0) + 1), 1000);
    else toast("Kunde inte spara: " + e.message);
  }
}

document.addEventListener("keydown", (e) => {
  if (view !== "swipe") return;
  if (e.key === "ArrowRight") fling(true);
  if (e.key === "ArrowLeft") fling(false);
});

// ---------- Väntar på de andra ----------

function showWaiting() {
  setView("waiting", `
    <h1>Bra jobbat! 🍿</h1>
    <p class="muted">Väntar på att de andra ska swipa klart.</p>
    <div class="panel"><ul id="people" class="people"></ul></div>
    <div id="hostBox"></div>`);
}

function updateWaiting() {
  const ul = document.getElementById("people");
  if (ul) ul.innerHTML = peopleHtml(true);
  const box = document.getElementById("hostBox");
  if (box && state.me.host && !box.innerHTML) {
    box.innerHTML = '<button id="finish" class="block">Visa resultatet nu</button>';
    document.getElementById("finish").onclick = async (ev) => {
      if (!confirm("Visa resultatet innan alla är klara?")) return;
      ev.target.disabled = true;
      try { state = await api("/rooms/" + encodeURIComponent(session.code) + "/finish", {}); render(); }
      catch (e) { toast(e.message); ev.target.disabled = false; }
    };
  }
}

// ---------- Resultat ----------

function showResults() {
  stopPolling();
  const res = state.results || [];
  const n = state.participants.length;
  if (!res.length) {
    setView("results", `
      <h1>Ingen vinnare 😅</h1>
      <p class="muted">Ingen film fick någon gillning. Testa en ny omgång med andra genrer.</p>
      <button class="primary block" id="again">Ny omgång</button>`);
  } else {
    const w = res[0];
    const p = posterUrl(w.movie);
    const perfect = w.likes === n && n > 1;
    setView("results", `
      <h1>Ikväll blir det…</h1>
      <div class="winner">
        ${p ? `<img src="${p}" alt="" onerror="this.remove()">` : ""}
        <div class="info">
          ${perfect ? '<span class="match">Perfekt match! Alla gillade den 🎉</span>' : ""}
          <div class="title">${esc(w.movie.title)}</div>
          <div class="muted">${esc(metaLine(w.movie))}</div>
          <p>Gillad av ${w.likes} av ${n}: ${w.likedBy.map(esc).join(", ")}</p>
          ${w.movie.overview ? `<p class="muted small">${esc(w.movie.overview)}</p>` : ""}
        </div>
      </div>
      ${res.length > 1 ? `
        <h2>Topplistan</h2>
        <div class="panel"><ol class="ranking">
          ${res.slice(1).map((r) => `
            <li>
              ${r.movie.poster ? `<img class="thumb" src="${posterUrl(r.movie)}" alt="" loading="lazy">` : '<span class="thumb"></span>'}
              <div><div>${esc(r.movie.title)} <span class="muted">${r.movie.year ? "(" + r.movie.year + ")" : ""}</span></div>
              <div class="muted small">${r.likes} av ${n}: ${r.likedBy.map(esc).join(", ")}</div></div>
            </li>`).join("")}
        </ol></div>` : ""}
      <button class="primary block" id="again">Ny omgång</button>`);
  }
  document.getElementById("again").onclick = leaveRoom;
}

init();
