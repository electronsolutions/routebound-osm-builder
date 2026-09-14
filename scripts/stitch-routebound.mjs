import fs from "node:fs";
import { once } from "node:events";
import path from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index].replace(/^--/, ""), process.argv[index + 1]);
}
const cityPath = args.get("cities") ?? "cities.json";
const inputDir = args.get("input") ?? "shard-output";
const outputDir = args.get("output") ?? "out";
const locations = JSON.parse(fs.readFileSync(cityPath, "utf8"));
const locationIds = new Set(locations.map((location) => location.id));
const files = [];
function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".jsonl")) files.push(full);
  }
}
walk(inputDir);

const edges = new Map();
const pairRuns = new Map();
for (const file of files) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const edge = JSON.parse(line);
    if (!["walking", "driving"].includes(edge.profile) || edge.routeSource !== "osm") {
      throw new Error("invalid profile/source in " + file);
    }
    if (!locationIds.has(edge.originLocationId) || !locationIds.has(edge.destinationLocationId)) {
      throw new Error("edge references unknown location in " + file);
    }
    if (!edge.routeGeometry || !Number.isFinite(edge.routedDistanceMiles)) {
      throw new Error("edge is missing geometry/distance in " + file);
    }
    if (typeof edge.profileRunId !== "string" || !edge.profileRunId.trim()) {
      throw new Error("edge is missing independent profileRunId in " + file);
    }
    const pair = edge.originLocationId + "\0" + edge.destinationLocationId;
    const runs = pairRuns.get(pair) ?? new Map();
    for (const [otherProfile, otherRun] of runs) {
      if (otherProfile !== edge.profile && otherRun === edge.profileRunId) {
        throw new Error("walking and driving profiles share a profileRunId for " + pair);
      }
    }
    runs.set(edge.profile, edge.profileRunId);
    pairRuns.set(pair, runs);
    edges.set(edge.profile + ":" + edge.originLocationId + ":" + edge.destinationLocationId, edge);
  }
}

function components(profile) {
  const parent = new Map(locations.map((location) => [location.id, location.id]));
  const find = (id) => {
    let root = parent.get(id);
    while (root !== parent.get(root)) root = parent.get(root);
    let current = id;
    while (parent.get(current) !== root) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent.set(a, b);
  };
  for (const edge of edges.values()) {
    if (edge.profile === profile) union(edge.originLocationId, edge.destinationLocationId);
  }
  const groups = new Map();
  for (const location of locations) {
    const root = find(location.id);
    groups.set(root, (groups.get(root) ?? 0) + 1);
  }
  const sizes = [...groups.values()].sort((a, b) => b - a);
  return {
    evaluated: locations.length,
    edgeCount: [...edges.values()].filter((edge) => edge.profile === profile).length,
    componentCount: sizes.length,
    primaryComponentSize: sizes[0] ?? 0,
    unreachableOrDisconnected: sizes.slice(1).reduce((sum, size) => sum + size, 0)
  };
}

fs.mkdirSync(outputDir, { recursive: true });
const routePath = path.join(outputDir, "routebound-osm-routing.jsonl");
const sortedEdges = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
const osmExtractDate = sortedEdges.find((edge) => edge.osmExtractDate)?.osmExtractDate ?? process.env.OSM_EXTRACT_DATE ?? "unknown";
const routingVersion = sortedEdges.find((edge) => edge.routingVersion)?.routingVersion ?? process.env.ROUTING_VERSION ?? "osrm";
const connectivity = {
  source: "OpenStreetMap",
  walking: components("walking"),
  driving: components("driving")
};

async function writeStream(stream, value) {
  if (!stream.write(value)) await once(stream, "drain");
}

async function writeOutputs() {
  const jsonlStream = fs.createWriteStream(routePath, { encoding: "utf8" });
  const jsonStream = fs.createWriteStream(path.join(outputDir, "routebound-osm-routing.json"), { encoding: "utf8" });
  await writeStream(jsonStream, `{"source":${JSON.stringify("OpenStreetMap")},"osmExtractDate":${JSON.stringify(osmExtractDate)},"routingVersion":${JSON.stringify(routingVersion)},"routes":[`);
  for (const edge of sortedEdges) {
    const serialized = JSON.stringify(edge);
    await writeStream(jsonlStream, serialized + "\n");
    await writeStream(jsonStream, (edge === sortedEdges[0] ? "" : ",") + serialized);
  }
  await writeStream(jsonStream, `],"connectivity":${JSON.stringify(connectivity)}}\n`);
  await Promise.all([
    new Promise((resolve, reject) => { jsonlStream.end(resolve); jsonlStream.on("error", reject); }),
    new Promise((resolve, reject) => { jsonStream.end(resolve); jsonStream.on("error", reject); })
  ]);
}

fs.writeFileSync(path.join(outputDir, "connectivity.json"), JSON.stringify(connectivity, null, 2) + "\n");
fs.writeFileSync(path.join(outputDir, "source-manifest.json"), JSON.stringify({
  source: "OpenStreetMap",
  osmExtractDate,
  routingVersion,
  attribution: "© OpenStreetMap contributors",
  license: "ODbL",
  geometryEncoding: "polyline6",
  routeFilesRead: files.length,
  deduplicatedEdgeCount: edges.size,
  locationCount: locations.length,
  routingEngine: "OSRM; see per-edge routingVersion and osmExtractDate"
}, null, 2) + "\n");
await writeOutputs();
console.log(JSON.stringify({ files: files.length, edges: edges.size, locations: locations.length, outputDir }));
