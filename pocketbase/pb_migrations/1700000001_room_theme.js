/// <reference path="../pb_data/types.d.ts" />

// Lägger till tema ("skin") på rummen.
migrate((app) => {
  const rooms = app.findCollectionByNameOrId("rooms");
  rooms.fields.add(new TextField({ name: "theme", max: 20 }));
  app.save(rooms);
}, (app) => {
  const rooms = app.findCollectionByNameOrId("rooms");
  rooms.fields.removeByName("theme");
  app.save(rooms);
});
