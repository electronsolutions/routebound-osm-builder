#!/usr/bin/env bash
set -euo pipefail

: "${JOB_ID:?}"
: "${PBF_URLS:?}"
: "${SELECTORS:?}"
: "${OUTPUT_DIR:?}"

WORK_DIR="${RUNNER_TEMP}/routebound-${JOB_ID}"
IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:latest}"
OSMIUM_IMAGE="${OSMIUM_IMAGE:-ghcr.io/osmcode/osmium-tool:latest}"
FOOT_URL="${OSRM_FOOT_URL:-https://raw.githubusercontent.com/Project-OSRM/osrm-backend/master/profiles/foot.lua}"
mkdir -p "$WORK_DIR" "$OUTPUT_DIR"

free_kb() {
  df -Pk "$WORK_DIR" | awk 'NR==2 {print $4}'
}
guard_disk() {
  test "$(free_kb)" -ge 4194304 || { echo "less than 4 GiB free on ephemeral runner"; exit 70; }
}
guard_disk

IFS=',' read -r -a URLS <<< "$PBF_URLS"
PBF_FILES=()
for index in "${!URLS[@]}"; do
  url="${URLS[$index]}"
  file="$WORK_DIR/input-${index}.osm.pbf"
  curl --fail --location --retry 5 --retry-all-errors --continue-at - --output "$file" "$url"
  if curl --fail --location --retry 3 --output "$file.md5" "${url}.md5"; then
    expected="$(awk '{print $1}' "$file.md5")"
    actual="$(md5sum "$file" | awk '{print $1}')"
    test "$expected" = "$actual"
  fi
  PBF_FILES+=("$file")
done

if [ "${#PBF_FILES[@]}" -eq 1 ]; then
  cp "${PBF_FILES[0]}" "$WORK_DIR/input.osm.pbf"
else
  args=()
  for file in "${PBF_FILES[@]}"; do args+=(/data/"$(basename "$file")"); done
  docker run --rm -v "$WORK_DIR:/data" "$OSMIUM_IMAGE" osmium merge "${args[@]}" -o /data/input.osm.pbf
fi
curl --fail --location --retry 3 --output "$WORK_DIR/foot.lua" "$FOOT_URL"
docker pull "$IMAGE" >/dev/null
docker image inspect "$IMAGE" --format '{{index .RepoDigests 0}}' > "$WORK_DIR/osrm-image-digest.txt" || true

build_profile() {
  profile="$1"
  port="$2"
  profile_file="$3"
  base="$WORK_DIR/${profile}"
  cp "$WORK_DIR/input.osm.pbf" "${base}.osm.pbf"
  docker run --rm -v "$WORK_DIR:/data" "$IMAGE" osrm-extract -p "$profile_file" "/data/${profile}.osm.pbf"
  docker run --rm -v "$WORK_DIR:/data" "$IMAGE" osrm-partition "/data/${profile}.osrm"
  docker run --rm -v "$WORK_DIR:/data" "$IMAGE" osrm-customize "/data/${profile}.osrm"
  container="routebound-${JOB_ID}-${profile}"
  docker run --rm -d --name "$container" -p "${port}:5000" -v "$WORK_DIR:/data" "$IMAGE" \
    osrm-routed --algorithm mld "/data/${profile}.osrm" >/dev/null
  for attempt in $(seq 1 60); do
    if curl --fail --silent "http://127.0.0.1:${port}/route/v1/driving/0,0;0.001,0.001?overview=false" >/dev/null; then break; fi
    sleep 2
  done
  curl --fail --silent "http://127.0.0.1:${port}/route/v1/driving/0,0;0.001,0.001?overview=false" >/dev/null
  PROFILE="$profile" OSRM_URL="http://127.0.0.1:${port}" OUTPUT="${OUTPUT_DIR}/${JOB_ID}-${profile}.jsonl" \
    CITY_INPUT="${CITY_INPUT}" SELECTORS="${SELECTORS}" GROUPS="${GROUPS:-[]}" CROSS_ONLY="${CROSS_ONLY:-0}" \
    OSM_EXTRACT_DATE="${OSM_EXTRACT_DATE:-unknown}" ROUTING_VERSION="${ROUTING_VERSION:-osrm}" \
    node scripts/route-candidates.mjs
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -f "${base}.osm.pbf" "${base}.osrm" "${base}.osrm."*
}

build_profile walking "$((5000 + RANDOM % 500))" /data/foot.lua
build_profile driving "$((5500 + RANDOM % 500))" /opt/car.lua
guard_disk
rm -rf "$WORK_DIR"
