#!/usr/bin/env bash
# No login, resource mutation, kubeconfig contents or secret output.
set -Eeuo pipefail
source_dir=$(realpath -e -- "${1:?Usage: verify.sh SOURCE_DIR [BASE_URL]}")
base_url="${2:-http://127.0.0.1:9090}"
manifest_sha=$(python3 "$source_dir/deploy/manifest.py" verify "$source_dir")
revision=$(cat "$source_dir/RELEASE")
for endpoint in livez readyz; do
  curl --fail --silent --show-error --noproxy '*' --max-time 10 "$base_url/$endpoint" |
    python3 -c 'import json,sys; x=json.load(sys.stdin); assert x.get("revision")==sys.argv[1], "revision mismatch"; assert x.get("sourceManifestSha256")==sys.argv[2], "source manifest mismatch"' "$revision" "$manifest_sha"
done
printf 'Verified revision=%s source_manifest=%s\n' "$revision" "$manifest_sha"
