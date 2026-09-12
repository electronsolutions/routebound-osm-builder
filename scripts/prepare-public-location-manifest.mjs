import fs from "node:fs";
import path from "node:path";

const sourcePath = process.argv[2];
const outputPath = process.argv[3] ?? "input/routebound-locations.json";
if (!sourcePath) {
  throw new Error("usage: node prepare-public-location-manifest.mjs WORLD_JSON OUTPUT_JSON");
}

const world = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const locations = Array.isArray(world.locations) ? world.locations : [];
const publicLocations = locations.map((location) => ({
  id: location.id,
  name: location.name,
  region: location.region,
  country: location.country,
  countryCode: location.countryCode,
  latitude: location.latitude,
  longitude: location.longitude
}));

const piedmont = {
  id: "location-piedmont",
  name: "Piedmont",
  region: "California",
  country: "United States",
  countryCode: "US",
  latitude: 37.82437,
  longitude: -122.23164
};
if (!publicLocations.some((location) => location.id === piedmont.id)) {
  publicLocations.push(piedmont);
}

const ids = new Set();
for (const location of publicLocations) {
  if (!location.id || ids.has(location.id)) throw new Error("duplicate or missing location ID");
  ids.add(location.id);
  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    throw new Error("location is missing finite coordinates: " + location.id);
  }
}
if (publicLocations.length !== 1283) {
  throw new Error("expected 1283 locations, found " + publicLocations.length);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(publicLocations) + "\n");
console.log(JSON.stringify({ outputPath, count: publicLocations.length }));

