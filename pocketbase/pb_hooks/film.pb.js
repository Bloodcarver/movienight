/// <reference path="../pb_data/types.d.ts" />
// API-routerna för Filmkväll. Varje handler laddar logiken med require()
// eftersom PocketBase kör handlers isolerat från resten av filen.

routerAdd("GET", "/api/film/config", (e) => {
  const lib = require(`${__hooks}/film_lib.js`);
  return e.json(200, { tmdb: lib.hasTmdb(), genres: lib.genres() });
});

routerAdd("GET", "/api/film/search", (e) => {
  const lib = require(`${__hooks}/film_lib.js`);
  return e.json(200, lib.searchMovies(e.request.url.query().get("q")));
});

routerAdd("POST", "/api/film/rooms", (e) => {
  const lib = require(`${__hooks}/film_lib.js`);
  const body = e.requestInfo().body;
  const r = lib.createRoom(body.name, body.theme);
  return e.json(200, { code: r.room.getString("code"), token: r.me.getString("token") });
});

routerAdd("POST", "/api/film/rooms/{code}/join", (e) => {
  const lib = require(`${__hooks}/film_lib.js`);
  const r = lib.joinRoom(e.request.pathValue("code"), e.requestInfo().body.name);
  return e.json(200, { code: r.room.getString("code"), token: r.me.getString("token") });
});

routerAdd("GET", "/api/film/rooms/{code}", (e) => {
  const lib = require(`${__hooks}/film_lib.js`);
  const room = lib.findRoom(e.request.pathValue("code"));
  return e.json(200, lib.state(room, lib.findMe(room, e)));
});

routerAdd("POST", "/api/film/rooms/{code}/prefs", (e) => {
  const lib = require(`${__hooks}/film_lib.js`);
  const room = lib.findRoom(e.request.pathValue("code"));
  const me = lib.findMe(room, e);
  lib.savePrefs(room, me, e.requestInfo().body);
  return e.json(200, lib.state(room, me));
});

routerAdd("POST", "/api/film/rooms/{code}/theme", (e) => {
  const lib = require(`${__hooks}/film_lib.js`);
  const room = lib.findRoom(e.request.pathValue("code"));
  const me = lib.findMe(room, e);
  lib.setTheme(room, me, e.requestInfo().body.theme);
  return e.json(200, lib.state(room, me));
});

routerAdd("POST", "/api/film/rooms/{code}/start", (e) => {
  const lib = require(`${__hooks}/film_lib.js`);
  const room = lib.findRoom(e.request.pathValue("code"));
  const me = lib.findMe(room, e);
  lib.startSwiping(room, me);
  return e.json(200, lib.state(room, me));
});

routerAdd("POST", "/api/film/rooms/{code}/swipe", (e) => {
  const lib = require(`${__hooks}/film_lib.js`);
  const room = lib.findRoom(e.request.pathValue("code"));
  const me = lib.findMe(room, e);
  lib.swipe(room, me, e.requestInfo().body);
  return e.json(200, { ok: true });
});

routerAdd("POST", "/api/film/rooms/{code}/finish", (e) => {
  const lib = require(`${__hooks}/film_lib.js`);
  const room = lib.findRoom(e.request.pathValue("code"));
  const me = lib.findMe(room, e);
  lib.finish(room, me);
  return e.json(200, lib.state(room, me));
});

cronAdd("filmkvall_cleanup", "*/15 * * * *", () => {
  require(`${__hooks}/film_lib.js`).cleanup();
});
