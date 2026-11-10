#!/usr/bin/env bash
# Run as root. A brief stop makes the JSON/session/credential snapshot consistent.
set -Eeuo pipefail
umask 077
BASE_DIR="${BASE_DIR:-/opt/kubepanel}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/kubepanel-backups}"
CONTAINER="${CONTAINER:-kubepanel}"
base=$(realpath -e -- "$BASE_DIR")
mkdir -p -- "$BACKUP_ROOT"
backup_root=$(realpath -e -- "$BACKUP_ROOT")
case "$backup_root/" in "$base/app/"*|"$base/data/"*|"$base/clusters/"*|"$base/releases/"*) echo 'Backup location overlaps source/runtime storage' >&2; exit 2;; esac
target=$(mktemp -d "$backup_root/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
chmod 700 "$backup_root" "$target"
if [[ -n ${ENV_FILE:-} && ! -f "$ENV_FILE" ]]; then
  echo 'Selected ENV_FILE is unavailable; refusing incomplete backup' >&2
  exit 2
fi
restart=0
finish() { if ((restart)); then docker start "$CONTAINER" >/dev/null; fi; }
trap finish EXIT
if docker inspect "$CONTAINER" >"$target/container-inspect.json" 2>/dev/null; then
  chmod 600 "$target/container-inspect.json"
  if [[ $(docker inspect -f '{{.State.Running}}' "$CONTAINER") == true ]]; then
    restart=1
    docker stop --time 30 "$CONTAINER" >/dev/null
  fi
fi
entries=()
for item in data clusters .env docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
  if [[ -e "$base/$item" ]]; then entries+=("$item"); fi
done
# Some installations keep their Compose file/environment beside the source.
for item in app/.env app/docker-compose.yml app/docker-compose.yaml app/compose.yml app/compose.yaml; do
  if [[ -f "$base/$item" ]]; then entries+=("$item"); fi
done
[[ -d "$base/data" && -d "$base/clusters" ]] || { echo 'Both runtime directories must exist; refusing partial backup' >&2; exit 2; }
tar --numeric-owner -czf "$target/runtime.tar.gz" -C "$base" -- "${entries[@]}"
if [[ -n ${ENV_FILE:-} ]]; then cp -- "$ENV_FILE" "$target/deployment.env"; fi
files=(runtime.tar.gz)
for file in deployment.env container-inspect.json; do
  if [[ -f "$target/$file" ]]; then files+=("$file"); fi
done
(cd "$target" && sha256sum "${files[@]}" > SHA256SUMS)
chmod 600 "$target"/*
printf '%s\n' "$target"
