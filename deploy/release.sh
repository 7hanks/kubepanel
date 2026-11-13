#!/usr/bin/env bash
# Standalone Docker deployment. Root privileges, Docker, Python 3.8+, curl, flock.
# Source must be a clean manifest.py stage output. Publishes app as a release symlink.
set -Eeuo pipefail
umask 077
source_dir=$(realpath -e -- "${1:?Usage: release.sh SOURCE_DIR}")
BASE_DIR="${BASE_DIR:-/opt/kubepanel}"
CONTAINER="${CONTAINER:-kubepanel}"
BIND_ADDRESS="${BIND_ADDRESS:-0.0.0.0}"
HOST_PORT="${HOST_PORT:-9090}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-kubepanel}"
CANDIDATE_CHECK="${CANDIDATE_CHECK:-}"
if [[ -n "$CANDIDATE_CHECK" && (! -f "$CANDIDATE_CHECK" || ! -x "$CANDIDATE_CHECK") ]]; then
  echo 'CANDIDATE_CHECK must name an executable file' >&2
  exit 2
fi
docker_env=()
if [[ -n ${ENV_FILE:-} ]]; then
  # Explicit legacy compatibility only; no environment file is auto-loaded.
  [[ -f "$ENV_FILE" ]] || { echo 'Selected ENV_FILE is unavailable' >&2; exit 2; }
  docker_env+=(--env-file "$ENV_FILE")
else
  [[ -n ${DASHBOARD_PASSWORD:-} ]] || { echo 'Set DASHBOARD_PASSWORD for docker run deployment' >&2; exit 2; }
  for name in DASHBOARD_USERNAME DASHBOARD_PASSWORD DASHBOARD_SECRET DASHBOARD_TOKEN_TTL DASHBOARD_AUTH_ENABLED DASHBOARD_COOKIE_SECURE TRUST_PROXY KUBE_REQUEST_TIMEOUT TERMINAL_IDLE_MS TERMINAL_MAX_MS KUBE_CONFIG_B64 KUBECONFIG TZ; do
    if [[ -v "$name" ]]; then
      export "$name"
      # Docker reads the exported value; do not expand secrets into its argv.
      docker_env+=(-e "$name")
    fi
  done
fi
mkdir -p -- "$BASE_DIR/releases"
base=$(realpath -e -- "$BASE_DIR")
exec 9>"$base/.release.lock"
flock -n 9 || { echo 'Another release is running' >&2; exit 2; }
manifest_sha=$(python3 "$source_dir/deploy/manifest.py" verify "$source_dir")
revision=$(cat "$source_dir/RELEASE")
release_minute=$(TZ=Asia/Shanghai date +%Y%m%d-%H%M)
image="$IMAGE_REPOSITORY:$release_minute"
existing_revision=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image" 2>/dev/null || true)
if [[ -n "$existing_revision" && "$existing_revision" != "$revision" ]]; then
  echo "Image tag $image already belongs to another release; retry in the next minute" >&2
  exit 2
fi
destination="$base/releases/$revision"
[[ ! -e "$destination" ]] || { echo 'Immutable release already exists; use a new revision' >&2; exit 2; }
[[ -d "$base/data" && -d "$base/clusters" ]] || { echo 'Missing runtime directories' >&2; exit 2; }
if [[ -n ${ENV_FILE:-} ]]; then
  [[ $(realpath -e -- "$ENV_FILE") != "$base/app/"* ]] || { echo 'Move ENV_FILE outside app before publishing the source pointer' >&2; exit 2; }
fi
[[ ! -e "$base/app" || -d "$base/app" ]] || { echo 'app must be a directory or directory symlink' >&2; exit 2; }
[[ "$source_dir" != "$base/data"* && "$source_dir" != "$base/clusters"* ]] || exit 2
cp -a -- "$source_dir" "$destination"
python3 "$destination/deploy/manifest.py" verify "$destination" >/dev/null
# Run tests/build in a disposable image; source staging remains byte-identical.
docker build --target verification -t "$image-verification" "$destination"
docker build --build-arg BUILD_REVISION="$revision" --build-arg SOURCE_MANIFEST_SHA256="$manifest_sha" -t "$image" "$destination"
[[ $(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") == "$revision" ]] || exit 1
backup=$(BASE_DIR="$base" CONTAINER="$CONTAINER" ENV_FILE="${ENV_FILE:-}" bash "$destination/deploy/backup.sh")
work=$(mktemp -d "$base/.candidate-XXXXXX")
candidate="$CONTAINER-candidate-${revision:0:12}"
previous="$CONTAINER-rollback-$(date -u +%Y%m%dT%H%M%SZ)"
old_renamed=0
old_was_running=0
new_started=0
success=0
source_archive="$base/source-rollback-$(date -u +%Y%m%dT%H%M%SZ)-$$"
source_moved=0
source_published=0
old_source_link=''
if [[ -L "$base/app" ]]; then old_source_link=$(readlink -- "$base/app"); fi
cleanup() {
  status=$?
  trap - EXIT INT TERM
  docker rm -f "$candidate" >/dev/null 2>&1 || true
  if ((success == 0)); then
    if ((source_published)); then
      if [[ -n "$old_source_link" ]]; then
        ln -s -- "$old_source_link" "$base/.app-restore-$$"
        mv -Tf -- "$base/.app-restore-$$" "$base/app"
      else
        rm -f -- "$base/app"
      fi
    fi
    if ((source_moved)); then mv -- "$source_archive" "$base/app"; fi
  fi
  rm -f -- "$base/.app-next-$$"
  if ((success == 0 && new_started)); then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  if ((success == 0 && old_renamed)); then
    docker rename "$previous" "$CONTAINER"
  fi
  if ((success == 0 && old_was_running)); then
    docker start "$CONTAINER" >/dev/null
    echo 'Release failed; previous container restarted with unchanged runtime mounts' >&2
  fi
  # Deliberately retain private candidate snapshot for diagnosis; no recursive delete.
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
tar -xzf "$backup/runtime.tar.gz" -C "$work" data clusters
chown -R 10001:10001 "$work/data" "$work/clusters"
docker run -d --name "$candidate" --cap-drop ALL --security-opt no-new-privileges:true --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  "${docker_env[@]}" -e BUILD_REVISION="$revision" -e SOURCE_MANIFEST_SHA256="$manifest_sha" \
  -p 127.0.0.1::8080 -v "$work/data:/app/data" -v "$work/clusters:/app/kube/clusters" "$image" >/dev/null
candidate_port=$(docker port "$candidate" 8080/tcp | awk -F: '{print $NF}')
wait_ready() {
  for attempt in $(seq 1 30); do
    if bash "$destination/deploy/verify.sh" "$destination" "$1" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo 'Health/version/source verification timed out' >&2
  return 1
}
candidate_url="http://127.0.0.1:$candidate_port"
wait_ready "$candidate_url"
if [[ -n "$CANDIDATE_CHECK" ]]; then
  if ! "$CANDIDATE_CHECK" "$candidate_url" >/dev/null 2>&1; then
    echo 'Candidate acceptance hook failed; production promotion cancelled' >&2
    exit 1
  fi
  echo 'Candidate acceptance hook passed'
else
  echo 'Candidate verified by health/version/source checks only; no acceptance hook configured'
fi
docker rm -f "$candidate" >/dev/null
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  if [[ $(docker inspect -f '{{.State.Running}}' "$CONTAINER") == true ]]; then
    old_was_running=1
    docker stop --time 30 "$CONTAINER" >/dev/null
  fi
  docker rename "$CONTAINER" "$previous"
  old_renamed=1
fi
# Take the authoritative final backup with the old writer stopped.
backup=$(BASE_DIR="$base" CONTAINER="$previous" ENV_FILE="${ENV_FILE:-}" bash "$destination/deploy/backup.sh")
new_started=1
docker run -d --name "$CONTAINER" --restart unless-stopped --cap-drop ALL --security-opt no-new-privileges:true \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m "${docker_env[@]}" \
  -e BUILD_REVISION="$revision" -e SOURCE_MANIFEST_SHA256="$manifest_sha" \
  -p "$BIND_ADDRESS:$HOST_PORT:8080" -v "$base/data:/app/data" -v "$base/clusters:/app/kube/clusters" "$image" >/dev/null
wait_ready "http://127.0.0.1:$HOST_PORT"
# Publish only after the running image is verified. Keep the legacy source privately
# for recovery; subsequent releases atomically replace this symlink.
ln -s -- "$destination" "$base/.app-next-$$"
if [[ -d "$base/app" && ! -L "$base/app" ]]; then
  mv -- "$base/app" "$source_archive"
  source_moved=1
  chmod 700 "$source_archive"
fi
source_published=1
mv -Tf -- "$base/.app-next-$$" "$base/app"
success=1
# Keep the old container only until promotion is healthy; persistent data and
# recovery backups remain on disk, so successful upgrades leave no exited copy.
if ((old_renamed)); then docker rm "$previous" >/dev/null; fi
python3 "$destination/deploy/prune_containers.py" "$CONTAINER"
docker image rm "$image-verification" >/dev/null 2>&1 || true
printf 'Released %s\nImage: %s\nContainer: %s\nSource: %s\nBackup: %s\n' "$revision" "$image" "$CONTAINER" "$destination" "$backup"
