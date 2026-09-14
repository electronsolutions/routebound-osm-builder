import fs from "node:fs";
import readline from "node:readline";

const artifactDir = process.env.ROUTING_ARTIFACT_DIR ?? "routing-artifact";
const endpoint = `${process.env.PRODUCTION_URL ?? "https://routebound.electronsolutions.us"}/api/internal/route-profiles-import`;
const token = process.env.ROUTE_PROFILE_IMPORT_TOKEN;
if (!token) throw new Error("ROUTE_PROFILE_IMPORT_TOKEN is required");

const manifest = JSON.parse(fs.readFileSync(`${artifactDir}/source-manifest.json`, "utf8"));
const routePath = `${artifactDir}/routebound-osm-routing.jsonl`;
const adjacency = new Map([["walking", new Map()], ["driving", new Map()]]);
const oaklandPiedmont = new Map();
const usMexicoPairs = new Map();
const profileRuns = new Map();
let sent = 0;
let inserted = 0;
let batches = 0;
let walking = 0;
let driving = 0;
let lineNumber = 0;

function validateRoute(route) {
  const id = typeof route.id === "string" ? route.id : "";
  const origin = typeof route.originLocationId === "string" ? route.originLocationId : "";
  const destination = typeof route.destinationLocationId === "string" ? route.destinationLocationId : "";
  const profile = route.profile === "walking" || route.profile === "driving" ? route.profile : null;
  const distance = Number(route.routedDistanceMiles);
  const geometry = typeof route.routeGeometry === "string" ? route.routeGeometry : "";
  if (!id || !origin || !destination || origin === destination || !profile || !Number.isFinite(distance) || distance <= 0 || !geometry) {
    throw new Error(`invalid route profile at JSONL line ${lineNumber}: ${JSON.stringify({
      id,
      origin,
      destination,
      profile,
      distance,
      geometryLength: geometry.length,
      sameLocation: origin === destination
    })}`);
  }
}

function routeMeta(route) {
  return {
    id: route.id,
    origin: route.originLocationId,
    destination: route.destinationLocationId,
    profile: route.profile,
    distanceMiles: route.routedDistanceMiles,
    geometryPresent: Boolean(route.routeGeometry),
    geometryLength: route.routeGeometry.length,
    profileRunId: route.profileRunId
  };
}

function addToGraph(route) {
  const graph = adjacency.get(route.profile);
  const outgoing = graph.get(route.originLocationId) ?? [];
  outgoing.push({
    id: route.id,
    destination: route.destinationLocationId,
    distanceMiles: route.routedDistanceMiles,
    geometryLength: route.routeGeometry.length
  });
  graph.set(route.originLocationId, outgoing);
}

function findPath(profile, start, end) {
  const graph = adjacency.get(profile);
  const distances = new Map([[start, 0]]);
  const previous = new Map();
  const remaining = new Set([start, end, ...graph.keys()]);
  while (remaining.size) {
    let current = null;
    let best = Infinity;
    for (const candidate of remaining) {
      const distance = distances.get(candidate) ?? Infinity;
      if (distance < best) {
        best = distance;
        current = candidate;
      }
    }
    if (current === null || best === Infinity) break;
    remaining.delete(current);
    if (current === end) break;
    for (const edge of graph.get(current) ?? []) {
      const nextDistance = best + edge.distanceMiles;
      if (nextDistance < (distances.get(edge.destination) ?? Infinity)) {
        distances.set(edge.destination, nextDistance);
        previous.set(edge.destination, { current, edge });
        remaining.add(edge.destination);
      }
    }
  }
  if (!distances.has(end)) return null;
  const edges = [];
  let current = end;
  while (current !== start) {
    const step = previous.get(current);
    if (!step) return null;
    edges.push(step.edge);
    current = step.current;
  }
  edges.reverse();
  return {
    profile,
    origin: start,
    destination: end,
    distanceMiles: distances.get(end),
    walkingMinutesAt3Mph: profile === "walking" ? Math.round(distances.get(end) / 3 * 60) : null,
    edgeCount: edges.length,
    geometrySegments: edges.filter((edge) => edge.geometryLength > 0).length,
    routeIds: edges.map((edge) => edge.id)
  };
}

async function sendBatch(routes) {
  if (!routes.length) return;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      source: manifest.source,
      osmExtractDate: manifest.osmExtractDate,
      routingVersion: manifest.routingVersion,
      routes
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    throw new Error(`import batch ${batches + 1} failed with HTTP ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  sent += body.received ?? routes.length;
  inserted += body.inserted ?? 0;
  batches += 1;
}

const input = readline.createInterface({ input: fs.createReadStream(routePath), crlfDelay: Infinity });
let batch = [];
for await (const line of input) {
  lineNumber += 1;
  if (!line.trim()) continue;
  const route = JSON.parse(line);
  validateRoute(route);
  batch.push(route);
  addToGraph(route);
  if (route.profile === "walking") walking += 1;
  if (route.profile === "driving") driving += 1;
  const pair = `${route.originLocationId}\0${route.destinationLocationId}`;
  const pairProfiles = profileRuns.get(pair) ?? new Map();
  pairProfiles.set(route.profile, route.profileRunId);
  profileRuns.set(pair, pairProfiles);
  if (route.originLocationId === "location-oakland" && route.destinationLocationId === "location-piedmont") {
    oaklandPiedmont.set(route.profile, routeMeta(route));
  }
  if (route.originLocationId.startsWith("location-us-") && route.destinationLocationId.startsWith("location-mx-")) {
    const existing = usMexicoPairs.get(pair) ?? new Map();
    existing.set(route.profile, routeMeta(route));
    usMexicoPairs.set(pair, existing);
  }
  if (batch.length === 100) {
    await sendBatch(batch);
    batch = [];
  }
}
await sendBatch(batch);

const requiredRoutes = [...oaklandPiedmont.values()].map((route) => ({
  ...route,
  walkingMinutesAt3Mph: route.profile === "walking" ? Math.round(route.distanceMiles / 3 * 60) : null
}));
const oaklandTorontoPaths = ["walking", "driving"].map((profile) => findPath(profile, "location-oakland", "location-ca-toronto-6167865"));
const usMexico = [...usMexicoPairs.entries()].find(([, pair]) => pair.has("walking") && pair.has("driving"));
const usMexicoRoutes = usMexico
  ? [...usMexico[1].values()].map((route) => ({
      ...route,
      walkingMinutesAt3Mph: route.profile === "walking" ? Math.round(route.distanceMiles / 3 * 60) : null
    }))
  : [];
const independentProfiles = [...profileRuns.values()]
  .filter((pair) => pair.has("walking") && pair.has("driving"))
  .every((pair) => pair.get("walking") !== pair.get("driving"));

if (manifest.locationCount !== 1283 || sent !== manifest.deduplicatedEdgeCount) {
  throw new Error("imported artifact counts do not match the stitched manifest");
}
if (requiredRoutes.length !== 2 || oaklandTorontoPaths.some((path) => !path) || usMexicoRoutes.length !== 2 || !independentProfiles) {
  throw new Error(`required route/profile verification failed: ${JSON.stringify({
    oaklandPiedmontProfiles: requiredRoutes.length,
    oaklandTorontoProfiles: oaklandTorontoPaths.map((path) => path?.profile ?? null),
    usMexicoProfiles: usMexicoRoutes.length,
    independentProfiles
  })}`);
}
console.log(JSON.stringify({
  ok: true,
  source: manifest.source,
  osmExtractDate: manifest.osmExtractDate,
  routingVersion: manifest.routingVersion,
  routesSent: sent,
  inserted,
  batches,
  walking,
  driving,
  requiredRoutes,
  oaklandTorontoPaths,
  usMexicoRoutes,
  independentProfiles
}));
