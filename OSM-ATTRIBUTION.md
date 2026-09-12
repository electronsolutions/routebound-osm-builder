# OpenStreetMap attribution

This pipeline downloads current regional extracts from the Geofabrik
OpenStreetMap download server during ephemeral GitHub Actions jobs.

Generated route metadata must retain:

- source: OpenStreetMap
- attribution: © OpenStreetMap contributors
- license: Open Database License (ODbL)
- exact Geofabrik URL and checksum when published
- extract timestamp and routing-engine version

The pipeline does not redistribute raw PBF files as repository or workflow
artifacts.

