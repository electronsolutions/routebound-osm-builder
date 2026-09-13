import fs from "node:fs";

const profile = process.env.PROFILE;
const osrmUrl = process.env.OSRM_URL;
const outputPath = process.env.OUTPUT;
const cityPath = process.env.CITY_INPUT ?? "cities.json";
const selectors = JSON.parse(process.env.SELECTORS ?? "[]");
const groups = JSON.parse(process.env.GROUPS ?? "[]");
const cityIds = new Set(JSON.parse(process.env.CITY_IDS ?? "[]"));
const groupCityIds = JSON.parse(process.env.GROUP_CITY_IDS ?? "[]") ?? [];
const crossOnly = process.env.CROSS_ONLY === "1";
const extractDate = process.env.OSM_EXTRACT_DATE ?? "unknown";
const routingVersion = process.env.ROUTING_VERSION ?? "osrm-unpinned";
if (!["walking", "driving"].includes(profile) || !osrmUrl || !outputPath) {
  throw new Error("PROFILE, OSRM_URL, and OUTPUT are required");
}

const locations = JSON.parse(fs.readFileSync(cityPath, "utf8"));
const matches = (location, selector) =>
  location.countryCode === selector.countryCode &&
  (!selector.region || location.region === selector.region);
const selectGroup = (group) =>
  locations.filter((location) => group.some((selector) => matches(location, selector)));
const selected = selectors.length
  ? locations.filter((location) => selectors.some((selector) => matches(location, selector)))
  : locations;
const selectedById = cityIds.size ? selected.filter((location) => cityIds.has(location.id)) : selected;

function milesBetween(a, b) {
  const rad = Math.PI / 180;
  const lat1 = a.latitude * rad;
  const lat2 = b.latitude * rad;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const pairs = new Map();
function addCandidates(origins, destinations) {
  for (const origin of origins) {
    const ranked = destinations
      .filter((destination) => destination.id !== origin.id)
      .map((destination) => ({ destination, distance: milesBetween(origin, destination) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8);
    for (const item of ranked) {
      pairs.set(origin.id + ">" + item.destination.id, { origin, destination: item.destination });
    }
  }
}

if (crossOnly && (groupCityIds.length === 2 || groups.length === 2)) {
  const first = groupCityIds.length === 2 ? locations.filter((location) => new Set(groupCityIds[0]).has(location.id)) : selectGroup(groups[0]);
  const second = groupCityIds.length === 2 ? locations.filter((location) => new Set(groupCityIds[1]).has(location.id)) : selectGroup(groups[1]);
  addCandidates(first, second);
  addCandidates(second, first);
} else {
  addCandidates(selectedById, selectedById);
}

async function route(origin, destination) {
  const coordinates = origin.longitude + "," + origin.latitude + ";" + destination.longitude + "," + destination.latitude;
  const url = osrmUrl + "/route/v1/driving/" + coordinates + "?overview=full&geometries=polyline6&steps=false";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const body = await response.json();
      const routed = body.routes?.[0];
      if (!routed || body.code !== "Ok" || !Number.isFinite(routed.distance) || !routed.geometry) return null;
      return { routed, waypoints: body.waypoints ?? [] };
    } catch {
      if (attempt === 2) return null;
    }
  }
  return null;
}

const lines = [];
for (const { origin, destination } of pairs.values()) {
  const routedResult = await route(origin, destination);
  if (!routedResult) continue;
  const { routed, waypoints } = routedResult;
  const [originWaypoint, destinationWaypoint] = waypoints;
  const snap = (waypoint, location) => {
    const [longitude, latitude] = waypoint?.location ?? [location.longitude, location.latitude];
    return { latitude, longitude, name: waypoint?.name ?? location.name };
  };
  lines.push(JSON.stringify({
    id: profile + ":" + origin.id + ":" + destination.id,
    originLocationId: origin.id,
    destinationLocationId: destination.id,
    profile,
    routedDistanceMiles: Number((routed.distance / 1609.344).toFixed(3)),
    routeGeometry: routed.geometry,
    accessRules: JSON.stringify({ profile, engine: "osrm", independentProfileRun: true, source: "OpenStreetMap" }),
    originSnap: snap(originWaypoint, origin),
    destinationSnap: snap(destinationWaypoint, destination),
    profileRunId: routingVersion + ":" + profile,
    corridorLabel: "OpenStreetMap routed city connection",
    routeSource: "osm",
    osmExtractDate: extractDate,
    routingVersion
  }));
}
fs.writeFileSync(outputPath, lines.length ? lines.join("\n") + "\n" : "");
console.log(JSON.stringify({ profile, candidates: pairs.size, routed: lines.length, outputPath }));

