import fs from "node:fs";

const config = JSON.parse(fs.readFileSync("config/regions.json", "utf8"));
const mexicoShards = JSON.parse(fs.readFileSync("config/mexico-shards.json", "utf8"));
const boundaryPairs = JSON.parse(fs.readFileSync("config/boundary-pairs.json", "utf8"));
const locations = JSON.parse(fs.readFileSync("input/routebound-locations.json", "utf8"));
const mode = process.argv[2];
const mexicoUrl = "https://download.geofabrik.de/north-america/mexico-latest.osm.pbf";

function regionRecord(countryCode, pair) {
  const slug = pair[0];
  const label = pair[1];
  const base = countryCode === "US" ? "us" : "canada";
  return {
    id: countryCode.toLowerCase() + "-" + slug,
    countryCode,
    label,
    cityIds: [],
    subshardBbox: "",
    subshardIndexes: [],
    selectors: [{ countryCode, region: label }],
    pbfUrls: ["https://download.geofabrik.de/north-america/" + base + "/" + slug + "-latest.osm.pbf"]
  };
}

const baseRegions = [
  ...config.us.map((pair) => regionRecord("US", pair)),
  ...config.canada.map((pair) => regionRecord("CA", pair))
];
const mexicoById = new Map(mexicoShards.map((shard) => [shard.id, shard]));

function inBbox(location, bbox) {
  return location.longitude >= bbox[0] && location.longitude <= bbox[2] &&
    location.latitude >= bbox[1] && location.latitude <= bbox[3];
}

const assignedMexico = new Map();
for (const location of locations.filter((candidate) => candidate.countryCode === "MX")) {
  const shard = mexicoShards.find((candidate) => inBbox(location, candidate.bbox));
  if (!shard) throw new Error(`Mexico location is outside all shard bboxes: ${location.id}`);
  assignedMexico.set(location.id, shard.id);
}

function cityIds(shardId) {
  return [...assignedMexico.entries()].filter(([, id]) => id === shardId).map(([id]) => id);
}

const mexicoRegions = mexicoShards.map((shard) => ({
  id: shard.id,
  countryCode: "MX",
  label: shard.label,
  selectors: [{ countryCode: "MX" }],
  cityIds: cityIds(shard.id),
  subshardBbox: shard.bbox.join(","),
  pbfUrls: [mexicoUrl]
}));
const regions = [...baseRegions, ...mexicoRegions];
const byId = new Map(regions.map((region) => [region.id, region]));

function bboxUnion(first, second) {
  return [
    Math.min(first.bbox[0], second.bbox[0]), Math.min(first.bbox[1], second.bbox[1]),
    Math.max(first.bbox[2], second.bbox[2]), Math.max(first.bbox[3], second.bbox[3])
  ].join(",");
}

function standardBoundary(leftId, rightId) {
  const left = byId.get(leftId);
  const right = byId.get(rightId);
  if (!left || !right) throw new Error("unknown boundary region");
  const boundary = {
    id: leftId + "__" + rightId,
    selectors: [...left.selectors, ...right.selectors],
    groups: [left.selectors, right.selectors],
    groupCityIds: [],
    subshardBbox: "",
    subshardIndexes: [],
    pbfUrls: [...left.pbfUrls, ...right.pbfUrls]
  };
  if (rightId.startsWith("mx-") && leftId.startsWith("us-")) {
    boundary.groupCityIds = [left.cityIds ?? [], right.cityIds ?? []];
    boundary.subshardBbox = mexicoById.get(rightId).bbox.join(",");
    boundary.subshardIndexes = [1];
  }
  if (leftId.startsWith("mx-") && rightId.startsWith("mx-")) {
    boundary.groupCityIds = [left.cityIds ?? [], right.cityIds ?? []];
  }
  return boundary;
}

const usMexicoShardMap = {
  "us-california": ["mx-northwest"],
  "us-arizona": ["mx-northwest"],
  "us-new-mexico": ["mx-north"],
  "us-texas": ["mx-north", "mx-northeast"]
};
const expandedBoundaries = [];
for (const [leftId, rightId] of boundaryPairs) {
  if (rightId !== "mx-mexico") expandedBoundaries.push(standardBoundary(leftId, rightId));
  else for (const mexicoId of usMexicoShardMap[leftId] ?? []) expandedBoundaries.push(standardBoundary(leftId, mexicoId));
}

const mexicoNeighbors = [
  ["mx-northwest", "mx-north"], ["mx-northwest", "mx-west"], ["mx-north", "mx-northeast"],
  ["mx-north", "mx-central-west"], ["mx-north", "mx-central-east"], ["mx-northeast", "mx-gulf"],
  ["mx-west", "mx-central-west"], ["mx-west", "mx-south"], ["mx-central-west", "mx-central-east"],
  ["mx-central-east", "mx-gulf"], ["mx-central-west", "mx-south"], ["mx-central-east", "mx-south"],
  ["mx-gulf", "mx-southeast"], ["mx-south", "mx-southeast"]
];
for (const [leftId, rightId] of mexicoNeighbors) {
  const boundary = standardBoundary(leftId, rightId);
  boundary.subshardBbox = bboxUnion(mexicoById.get(leftId), mexicoById.get(rightId));
  boundary.subshardIndexes = [0];
  boundary.pbfUrls = [mexicoUrl];
  expandedBoundaries.push(boundary);
}

if (mode === "regions") process.stdout.write(JSON.stringify({ include: regions }));
else if (mode === "boundaries") process.stdout.write(JSON.stringify({ include: expandedBoundaries }));
else if (mode === "mexico-tests") process.stdout.write(JSON.stringify({ include: mexicoRegions.filter((region) => ["mx-northwest", "mx-central-west", "mx-central-east"].includes(region.id)) }));
else throw new Error("usage: node scripts/matrix.mjs regions|boundaries|mexico-tests");
