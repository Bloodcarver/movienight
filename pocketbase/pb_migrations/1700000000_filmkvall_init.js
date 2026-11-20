/// <reference path="../pb_data/types.d.ts" />

// Skapar tabellerna för Filmkväll. Alla regler är null = bara admin kommer åt
// dem direkt; appen går alltid via de egna API-routerna i pb_hooks.
migrate((app) => {
  const rooms = new Collection({
    type: "base",
    name: "rooms",
    fields: [
      { name: "code", type: "text", required: true, max: 12 },
      { name: "status", type: "text", required: true, max: 20 },
      { name: "host", type: "text", max: 40 },
      { name: "candidates", type: "json", maxSize: 2000000 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_rooms_code ON rooms (code)"],
  });
  app.save(rooms);

  const participants = new Collection({
    type: "base",
    name: "participants",
    fields: [
      { name: "room", type: "relation", required: true, collectionId: rooms.id, cascadeDelete: true, maxSelect: 1 },
      { name: "name", type: "text", required: true, max: 40 },
      { name: "token", type: "text", required: true, max: 64, hidden: true },
      { name: "favorites", type: "json", maxSize: 100000 },
      { name: "genres", type: "json", maxSize: 20000 },
      { name: "ready", type: "bool" },
      { name: "done", type: "bool" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_participants_token ON participants (token)"],
  });
  app.save(participants);

  const swipes = new Collection({
    type: "base",
    name: "swipes",
    fields: [
      { name: "room", type: "relation", required: true, collectionId: rooms.id, cascadeDelete: true, maxSelect: 1 },
      { name: "participant", type: "relation", required: true, collectionId: participants.id, cascadeDelete: true, maxSelect: 1 },
      { name: "movie", type: "text", required: true, max: 64 },
      { name: "like", type: "bool" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_swipes_unique ON swipes (participant, movie)"],
  });
  app.save(swipes);
}, (app) => {
  for (const name of ["swipes", "participants", "rooms"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
});
