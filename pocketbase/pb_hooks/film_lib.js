/// <reference path="../pb_data/types.d.ts" />
// Logiken för Filmkväll. Laddas med require() inifrån varje route i film.pb.js.

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const THEMES = ["bio", "modern", "retro", "rock", "rosa", "scifi", "noir", "western", "skrack", "jul", "strand", "terminal", "pastell", "rymd", "disco"];
const LIB_CACHE_MS = 10 * 60 * 1000;

function env(key, def) {
  const v = $os.getenv(key);
  return v ? v : def;
}

function intEnv(key, def) {
  const n = parseInt(env(key, ""), 10);
  return n > 0 ? n : def;
}

function readJson(record, field, def) {
  try {
    const s = toString(record.get(field));
    if (!s || s === "null") return def;
    return JSON.parse(s);
  } catch (_) {
    return def;
  }
}

function cleanName(v) {
  return String(v || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

// ---------- Jellyfin ----------

// Jellyfin kan ha genrer på både engelska och svenska. Slå ihop till svenska.
const GENRE_SV = {
  "action": "Action", "adventure": "Äventyr", "animation": "Animerat", "anime": "Animerat",
  "comedy": "Komedi", "crime": "Kriminal", "documentary": "Dokumentär", "drama": "Drama",
  "family": "Familj", "fantasy": "Fantasy", "history": "Historisk", "horror": "Skräck",
  "music": "Musik", "musical": "Musikal", "mystery": "Mystik", "romance": "Romantik",
  "science fiction": "Science Fiction", "sci-fi": "Science Fiction", "sci-fi & fantasy": "Science Fiction",
  "thriller": "Thriller", "tv movie": "TV-film", "war": "Krig", "war & politics": "Krig",
  "western": "Västern", "action & adventure": "Action", "kids": "Familj", "sport": "Sport",
  "biography": "Biografi", "suspense": "Thriller", "disaster": "Katastrof",
};

function normGenre(g) {
  g = String(g || "").trim();
  return GENRE_SV[g.toLowerCase()] || g;
}

function jellyfinHeaders() {
  return {
    "Accept": "application/json",
    "Authorization": 'MediaBrowser Client="Filmkvall", Device="Server", DeviceId="filmkvall", Version="1.0", Token="' + env("JELLYFIN_API_KEY", "") + '"',
  };
}

function library() {
  const store = $app.store();
  const cached = store.get("filmkvall_library");
  if (cached) {
    const c = JSON.parse(cached);
    if (Date.now() - c.at < LIB_CACHE_MS) return c.items;
  }

  const base = env("JELLYFIN_URL", "").replace(/\/+$/, "");
  if (!base) throw new BadRequestError("JELLYFIN_URL saknas i .env");
  const userId = env("JELLYFIN_USER_ID", "");
  const path = userId ? "/Users/" + encodeURIComponent(userId) + "/Items" : "/Items";
  const url = base + path +
    "?IncludeItemTypes=Movie&Recursive=true&Fields=ProviderIds,Genres,Overview,ProductionYear,CommunityRating,RunTimeTicks,OfficialRating&EnableImageTypes=Primary&ImageTypeLimit=1";

  const res = $http.send({ url: url, method: "GET", headers: jellyfinHeaders(), timeout: 60 });
  if (res.statusCode !== 200) {
    console.log("Filmkväll: Jellyfin svarade " + res.statusCode + " på " + base + path);
    throw new ApiError(502, "Kunde inte hämta filmer från Jellyfin (status " + res.statusCode + ").");
  }

  const raw = (res.json && res.json.Items) || [];
  const items = raw.map((i) => {
    const pid = i.ProviderIds || {};
    return {
      id: i.Id,
      title: i.Name || "",
      year: i.ProductionYear || null,
      overview: (i.Overview || "").slice(0, 600),
      rating: i.CommunityRating ? Math.round(i.CommunityRating * 10) / 10 : null,
      age: i.OfficialRating || "",
      genres: (i.Genres || []).map(normGenre).filter((g, k, a) => g && a.indexOf(g) === k),
      runtime: i.RunTimeTicks ? Math.round(i.RunTimeTicks / 600000000) : null,
      tmdb: String(pid.Tmdb || pid.tmdb || pid.TMDB || ""),
      poster: !!(i.ImageTags && i.ImageTags.Primary),
    };
  });

  store.set("filmkvall_library", JSON.stringify({ at: Date.now(), items: items }));
  return items;
}

function genres() {
  const counts = {};
  for (const m of library()) {
    for (const g of m.genres) counts[g] = (counts[g] || 0) + 1;
  }
  return Object.keys(counts)
    .filter((g) => counts[g] >= 2)
    .sort((a, b) => a.localeCompare(b, "sv"))
    .map((g) => ({ name: g, count: counts[g] }));
}

// ---------- TMDB ----------

function hasTmdb() {
  return !!env("TMDB_API_KEY", "");
}

function tmdb(path, params) {
  const key = env("TMDB_API_KEY", "");
  if (!key) throw new BadRequestError("TMDB_API_KEY saknas i .env");
  const headers = { "Accept": "application/json" };
  let url = env("TMDB_BASE_URL", "https://api.themoviedb.org/3") + path + "?language=sv-SE";
  // Långa nycklar är v4-läsnycklar (Bearer), korta är v3 api_key.
  if (key.length > 40) headers["Authorization"] = "Bearer " + key;
  else url += "&api_key=" + encodeURIComponent(key);
  for (const k in params || {}) url += "&" + k + "=" + encodeURIComponent(params[k]);

  const res = $http.send({ url: url, method: "GET", headers: headers, timeout: 15 });
  if (res.statusCode !== 200) {
    console.log("Filmkväll: TMDB svarade " + res.statusCode + " på " + path);
    throw new ApiError(502, "TMDB svarade med fel (status " + res.statusCode + ").");
  }
  return res.json;
}

function searchMovies(q) {
  q = String(q || "").trim();
  if (q.length < 2) return [];
  const data = tmdb("/search/movie", { query: q, include_adult: "false" });
  return (data.results || []).slice(0, 10).map((r) => ({
    id: r.id,
    title: r.title,
    year: r.release_date ? parseInt(r.release_date.slice(0, 4), 10) : null,
    poster: r.poster_path ? "https://image.tmdb.org/t/p/w185" + r.poster_path : null,
  }));
}

function recommendations(tmdbId) {
  const store = $app.store();
  const key = "filmkvall_rec_" + tmdbId;
  const cached = store.get(key);
  if (cached) return JSON.parse(cached);
  let ids = [];
  try {
    const data = tmdb("/movie/" + tmdbId + "/recommendations", { page: "1" });
    ids = (data.results || []).map((r) => String(r.id));
    if (ids.length < 10) {
      const sim = tmdb("/movie/" + tmdbId + "/similar", { page: "1" });
      ids = ids.concat((sim.results || []).map((r) => String(r.id)));
    }
  } catch (e) {
    console.log("Filmkväll: kunde inte hämta rekommendationer för " + tmdbId);
  }
  store.set(key, JSON.stringify(ids));
  return ids;
}

// Svensk beskrivning från TMDB. Tom sträng om TMDB saknar svensk text
// (då används Jellyfins beskrivning i stället).
function swedishOverview(tmdbId) {
  if (!tmdbId || !hasTmdb()) return "";
  const store = $app.store();
  const key = "filmkvall_sv_" + tmdbId;
  const cached = store.get(key);
  if (cached !== null && cached !== undefined) return cached;
  let text = "";
  try {
    const data = tmdb("/movie/" + tmdbId, {});
    text = String((data && data.overview) || "").trim().slice(0, 600);
  } catch (e) {
    console.log("Filmkväll: kunde inte hämta svensk beskrivning för " + tmdbId);
    return ""; // cacha inte fel, försök igen nästa gång
  }
  store.set(key, text);
  return text;
}

// ---------- Förslag ----------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function buildCandidates(people) {
  const lib = library();
  if (!lib.length) throw new BadRequestError("Hittade inga filmer i Jellyfin.");
  const count = intEnv("CANDIDATE_COUNT", 25);

  const byTmdb = {};
  for (const m of lib) if (m.tmdb) byTmdb[m.tmdb] = m;

  // Rekommendationer från allas favoriter, bara filmer som finns i biblioteket.
  const rec = {}; // jellyfinId -> { hits, people: {pid:true}, because: {title:true} }
  for (const p of people) {
    for (const fav of p.favorites) {
      for (const tid of recommendations(fav.id)) {
        const m = byTmdb[tid];
        if (!m) continue;
        const r = rec[m.id] || (rec[m.id] = { hits: 0, people: {}, because: {} });
        r.hits++;
        r.people[p.id] = true;
        r.because[fav.title] = true;
      }
    }
  }

  const favTmdb = {};
  for (const p of people) for (const f of p.favorites) favTmdb[String(f.id)] = true;

  const scored = lib.map((m) => {
    const r = rec[m.id];
    const recPeople = r ? Object.keys(r.people).length : 0;
    const genreMatches = {};
    let genrePeople = 0;
    for (const p of people) {
      const hit = p.genres.filter((g) => m.genres.indexOf(g) >= 0);
      if (hit.length) genrePeople++;
      for (const g of hit) genreMatches[g] = true;
    }
    let score = recPeople * 4 + (r ? Math.min(r.hits, 6) : 0) + genrePeople * 3 +
      (m.rating || 5) / 10 + Math.random() * 1.5;
    if (favTmdb[m.tmdb]) score -= 2; // någons favorit: okej, men lite lägre
    return {
      movie: m,
      score: score,
      relevant: recPeople > 0 || genrePeople > 0,
      because: r ? Object.keys(r.because).slice(0, 3) : [],
      genreMatches: Object.keys(genreMatches),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  let picked = scored.filter((s) => s.relevant).slice(0, count);
  if (picked.length < count) {
    // Fyll på med välbetygsatta filmer ur biblioteket.
    const used = {};
    for (const s of picked) used[s.movie.id] = true;
    const rest = scored
      .filter((s) => !used[s.movie.id])
      .sort((a, b) => ((b.movie.rating || 5) + Math.random() * 2) - ((a.movie.rating || 5) + Math.random() * 2));
    picked = picked.concat(rest.slice(0, count - picked.length));
  }

  return shuffle(picked.map((s) => {
    const m = s.movie;
    return {
      id: m.id, title: m.title, year: m.year, overview: swedishOverview(m.tmdb) || m.overview, rating: m.rating,
      age: m.age, genres: m.genres, runtime: m.runtime, poster: m.poster,
      because: s.because, genreMatches: s.genreMatches,
    };
  }));
}

// ---------- Rum ----------

function ttlCutoff() {
  const d = new Date(Date.now() - intEnv("ROOM_TTL_HOURS", 24) * 3600 * 1000);
  return d.toISOString().replace("T", " ");
}

function findRoom(code) {
  code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  let room;
  try {
    room = $app.findFirstRecordByData("rooms", "code", code);
  } catch (_) {
    throw new NotFoundError("Rummet finns inte (eller har gått ut).");
  }
  if (room.getString("created") < ttlCutoff()) throw new NotFoundError("Rummet har gått ut.");
  return room;
}

function findMe(room, e) {
  const token = e.request.header.get("X-Token");
  if (!token) throw new ForbiddenError("Du är inte med i rummet.");
  let me;
  try {
    me = $app.findFirstRecordByData("participants", "token", token);
  } catch (_) {
    throw new ForbiddenError("Du är inte med i rummet.");
  }
  if (me.getString("room") !== room.id) throw new ForbiddenError("Du är inte med i rummet.");
  return me;
}

function participantsOf(room) {
  return $app.findRecordsByFilter("participants", "room = {:room}", "created", 0, 0, { room: room.id });
}

function addParticipant(room, name) {
  name = cleanName(name);
  if (!name) throw new BadRequestError("Skriv ditt namn.");
  const p = new Record($app.findCollectionByNameOrId("participants"));
  p.set("room", room.id);
  p.set("name", name);
  p.set("token", $security.randomString(40));
  p.set("favorites", []);
  p.set("genres", []);
  p.set("ready", false);
  p.set("done", false);
  $app.save(p);
  return p;
}

function cleanTheme(t) {
  t = String(t || "");
  return THEMES.indexOf(t) >= 0 ? t : "bio";
}

function setTheme(room, me, theme) {
  if (room.getString("host") !== me.id) throw new ForbiddenError("Bara den som skapade rummet kan byta tema.");
  room.set("theme", cleanTheme(theme));
  $app.save(room);
}

function createRoom(name, theme) {
  const col = $app.findCollectionByNameOrId("rooms");
  let room;
  for (let i = 0; i < 10; i++) {
    const code = $security.randomStringWithAlphabet(5, CODE_ALPHABET);
    try {
      $app.findFirstRecordByData("rooms", "code", code);
      continue; // upptagen
    } catch (_) {}
    room = new Record(col);
    room.set("code", code);
    room.set("status", "lobby");
    room.set("theme", cleanTheme(theme));
    room.set("candidates", []);
    $app.save(room);
    break;
  }
  if (!room) throw new ApiError(500, "Kunde inte skapa rum, försök igen.");
  const p = addParticipant(room, name);
  room.set("host", p.id);
  $app.save(room);
  return { room: room, me: p };
}

function joinRoom(code, name) {
  const room = findRoom(code);
  if (room.getString("status") !== "lobby") throw new BadRequestError("Rummet har redan börjat swipa.");
  if (participantsOf(room).length >= 20) throw new BadRequestError("Rummet är fullt.");
  return { room: room, me: addParticipant(room, name) };
}

function savePrefs(room, me, body) {
  if (room.getString("status") !== "lobby") throw new BadRequestError("Swipandet har redan börjat.");
  const favs = (Array.isArray(body.favorites) ? body.favorites : []).slice(0, 5).map((f) => ({
    id: parseInt(f.id, 10),
    title: String(f.title || "").slice(0, 120),
    year: f.year ? parseInt(f.year, 10) : null,
    poster: typeof f.poster === "string" && f.poster.indexOf("https://image.tmdb.org/") === 0 ? f.poster : null,
  })).filter((f) => f.id > 0);
  const known = {};
  for (const g of genres()) known[g.name] = true;
  const gs = (Array.isArray(body.genres) ? body.genres : []).map(String).filter((g) => known[g]).slice(0, 20);

  if (hasTmdb() && favs.length < 1) throw new BadRequestError("Välj minst en favoritfilm.");
  me.set("favorites", favs);
  me.set("genres", gs);
  me.set("ready", true);
  $app.save(me);
}

function startSwiping(room, me) {
  if (room.getString("host") !== me.id) throw new ForbiddenError("Bara den som skapade rummet kan starta.");
  if (room.getString("status") !== "lobby") throw new BadRequestError("Swipandet har redan startat.");
  const ps = participantsOf(room);
  const notReady = ps.filter((p) => !p.getBool("ready")).map((p) => p.getString("name"));
  if (notReady.length) throw new BadRequestError("Väntar på: " + notReady.join(", "));

  const people = ps.map((p) => ({
    id: p.id,
    favorites: readJson(p, "favorites", []),
    genres: readJson(p, "genres", []),
  }));
  room.set("candidates", buildCandidates(people));
  room.set("status", "swiping");
  $app.save(room);
}

function swipe(room, me, body) {
  if (room.getString("status") !== "swiping") throw new BadRequestError("Rummet swipar inte just nu.");
  const candidates = readJson(room, "candidates", []);
  const movie = String(body.movie || "");
  if (!candidates.some((c) => c.id === movie)) throw new BadRequestError("Okänd film.");

  let s;
  try {
    s = $app.findFirstRecordByFilter("swipes", "participant = {:p} && movie = {:m}", { p: me.id, m: movie });
  } catch (_) {
    s = new Record($app.findCollectionByNameOrId("swipes"));
    s.set("room", room.id);
    s.set("participant", me.id);
    s.set("movie", movie);
  }
  s.set("like", !!body.like);
  $app.save(s);

  const mine = $app.findRecordsByFilter("swipes", "participant = {:p}", "", 0, 0, { p: me.id });
  if (mine.length >= candidates.length && !me.getBool("done")) {
    me.set("done", true);
    $app.save(me);
  }
  if (participantsOf(room).every((p) => p.getBool("done"))) {
    room.set("status", "done");
    $app.save(room);
  }
}

function finish(room, me) {
  if (room.getString("host") !== me.id) throw new ForbiddenError("Bara den som skapade rummet kan avsluta.");
  if (room.getString("status") !== "swiping") throw new BadRequestError("Rummet swipar inte just nu.");
  room.set("status", "done");
  $app.save(room);
}

function state(room, me) {
  const status = room.getString("status");
  const ps = participantsOf(room);
  const candidates = status === "lobby" ? [] : readJson(room, "candidates", []);
  const swipes = status === "lobby" ? [] :
    $app.findRecordsByFilter("swipes", "room = {:r}", "", 0, 0, { r: room.id });

  const countBy = {};
  const mySwipes = {};
  for (const s of swipes) {
    const pid = s.getString("participant");
    countBy[pid] = (countBy[pid] || 0) + 1;
    if (pid === me.id) mySwipes[s.getString("movie")] = s.getBool("like");
  }

  const out = {
    code: room.getString("code"),
    status: status,
    theme: cleanTheme(room.getString("theme")),
    tmdb: hasTmdb(),
    me: {
      id: me.id,
      name: me.getString("name"),
      host: room.getString("host") === me.id,
      ready: me.getBool("ready"),
      done: me.getBool("done"),
      favorites: readJson(me, "favorites", []),
      genres: readJson(me, "genres", []),
    },
    participants: ps.map((p) => ({
      id: p.id,
      name: p.getString("name"),
      host: room.getString("host") === p.id,
      ready: p.getBool("ready"),
      done: p.getBool("done"),
      swiped: countBy[p.id] || 0,
    })),
    total: candidates.length,
  };

  if (status === "swiping") {
    out.candidates = candidates;
    out.mySwipes = mySwipes;
  }

  if (status === "done") {
    const names = {};
    for (const p of ps) names[p.id] = p.getString("name");
    const likes = {};
    for (const s of swipes) {
      if (!s.getBool("like")) continue;
      const m = s.getString("movie");
      (likes[m] || (likes[m] = [])).push(names[s.getString("participant")]);
    }
    out.results = candidates
      .map((c) => ({ movie: c, likes: (likes[c.id] || []).length, likedBy: likes[c.id] || [] }))
      .filter((r) => r.likes > 0)
      .sort((a, b) => (b.likes - a.likes) || ((b.movie.rating || 0) - (a.movie.rating || 0)))
      .slice(0, 10);
  }
  return out;
}

function cleanup() {
  const old = $app.findRecordsByFilter("rooms", "created < {:cut}", "", 0, 0, { cut: ttlCutoff() });
  for (const r of old) $app.delete(r);
  if (old.length) console.log("Filmkväll: tog bort " + old.length + " gamla rum");
}

module.exports = {
  genres, hasTmdb, searchMovies, createRoom, joinRoom, findRoom, findMe,
  savePrefs, startSwiping, swipe, finish, state, cleanup, setTheme,
};
