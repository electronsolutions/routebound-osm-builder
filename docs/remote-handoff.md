# Remote handoff

Create a dedicated repository named routebound-osm-builder and place this
bundle at its root. Repository visibility is an owner decision: public is
appropriate only if the owner accepts publishing the public-data-only
pipeline and compact non-sensitive city coordinate manifest.

Before the first run, inspect every file and confirm that no production
secrets, player data, PINs, financial records, or private application source
is present. Do not add Cloudflare credentials to this repository.

The workflow creates 65 regional jobs and 134 geographic-boundary jobs, then
stitches only compact JSONL route outputs. It never uploads PBFs, tiles, or
OSRM preprocessing files. Importing the final artifact into the existing
Routebound Site must use the existing authorized deployment/import process.

