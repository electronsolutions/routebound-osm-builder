# Routebound OSM builder

This repository is a public-data-only build pipeline for Routebound's compact
city routing artifacts. It contains no players, accounts, PINs, production
secrets, finance data, or application source.

The GitHub Actions workflow runs each regional and boundary job on a clean
ephemeral Linux runner. Raw Geofabrik extracts and OSRM preprocessing files
stay inside the runner workspace and are never uploaded as artifacts. Only
compact JSONL route-profile output and validation reports are retained.

Walking and Driving are separate OSRM preprocessing and routing runs. Walking
uses the pedestrian profile; Driving uses the motor-vehicle profile. Geometry,
distance, access rules, and connectivity are kept separate. Walking is the
only playable Routebound mode.

The final data is OpenStreetMap-derived and must retain the attribution:
© OpenStreetMap contributors, available under the Open Database License
(ODbL). The workflow records source URLs, checksums when published, and the
extract date in the compact output manifest.

Repository setup requires an owner-created repository named
routebound-osm-builder. Do not add production credentials to this repository.

