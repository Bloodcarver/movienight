/// <reference path="../pb_data/types.d.ts" />

// Sparad TMDB-metadata per film (genrer + svensk beskrivning). Fylls på i
// bakgrunden av ett cron-jobb, så att inga TMDB-anrop behövs när man spelar.
migrate((app) => {
  const meta = new Collection({
    type: "base",
    name: "movie_meta",
    fields: [
      { name: "tmdb", type: "text", required: true, max: 20 },
      { name: "genres", type: "json", maxSize: 5000 },
      { name: "overview_sv", type: "text", max: 2000 },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_movie_meta_tmdb ON movie_meta (tmdb)"],
  });
  app.save(meta);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("movie_meta")); } catch (_) {}
});
