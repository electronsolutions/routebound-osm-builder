import fs from "node:fs";

const config = JSON.parse(fs.readFileSync("config/regions.json", "utf8"));
const boundaryPairs = JSON.parse(fs.readFileSync("config/boundary-pairs.json", "utf8"));
const mode = process.argv[2];

function regionRecord(countryCode, pair) {
  const slug = pair[0];
  const label = pair[1];
  const base = countryCode === "US" ? "us" : "canada";
  return {
    id: countryCode.toLowerCase() + "-" + slug,
    countryCode,
    label,
    selectors: [{ countryCode, region: label }],
    pbfUrls: ["https://download.geofabrik.de/north-america/" + base + "/" + slug + "-latest.osm.pbf"]
  };
}

const regions = [
  ...config.us.map((pair) => regionRecord("US", pair)),
  ...config.canada.map((pair) => regionRecord("CA", pair)),
  {
    id: "mx-mexico",
    countryCode: "MX",
    label: "Mexico",
    selectors: [{ countryCode: "MX" }],
    pbfUrls: ["https://download.geofabrik.de/north-america/mexico-latest.osm.pbf"]
  }
];
const byId = new Map(regions.map((region) => [region.id, region]));

if (mode === "regions") {
  process.stdout.write(JSON.stringify({ include: regions }));
} else if (mode === "boundaries") {
  const include = boundaryPairs.map(([leftId, rightId]) => {
    const left = byId.get(leftId);
    const right = byId.get(rightId);
    if (!left || !right) throw new Error("unknown boundary region");
    return {
      id: leftId + "__" + rightId,
      selectors: [...left.selectors, ...right.selectors],
      groups: [left.selectors, right.selectors],
      pbfUrls: [...left.pbfUrls, ...right.pbfUrls]
    };
  });
  process.stdout.write(JSON.stringify({ include }));
} else {
  throw new Error("usage: node scripts/matrix.mjs regions|boundaries");
}

