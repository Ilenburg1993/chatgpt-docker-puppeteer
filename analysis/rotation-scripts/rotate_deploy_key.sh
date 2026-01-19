#!/usr/bin/env bash
set -euo pipefail
# Replace a repository deploy key. Requires `gh` CLI authenticated as repo owner.

REPO="Rajude/chatgpt-docker-puppeteer"

usage(){
  cat <<EOF
Usage: $0 <existing-key-id-or-title>

Generates an SSH keypair (ephemeral files), uploads the public key as a new deploy key, and removes the existing key identified by id or title.
You will be shown the private key path to distribute to systems that need it.
EOF
}

if [ "${1-}" = "" ]; then usage; exit 1; fi
TARGET="$1"

tmpdir=$(mktemp -d)
priv="$tmpdir/deploy_key"
pub="$priv.pub"
ssh-keygen -t ed25519 -f "$priv" -N "" -C "deploy-key-$(date -u +%Y%m%dT%H%M%SZ)"

echo "Uploading new deploy key (read-only=false)"
res=$(gh api -X POST "/repos/$REPO/keys" -f title="deploy-key-$(date -u +%Y%m%dT%H%M%SZ)" -f key="$(cat $pub)" -f read_only=false)
new_id=$(echo "$res" | jq -r .id)
echo "Uploaded new deploy key id=$new_id"

echo "Looking up existing keys to remove: $TARGET"
gh api "/repos/$REPO/keys" | jq -c '.[]' > "$tmpdir/keys.json"
match=$(jq -r --arg t "$TARGET" 'map(select(.id|tostring == $t or .title == $t)) | .[0] // empty' "$tmpdir/keys.json")
if [ -n "$match" ]; then
  old_id=$(echo "$match" | jq -r .id)
  echo "Removing old deploy key id=$old_id"
  gh api -X DELETE "/repos/$REPO/keys/$old_id"
else
  echo "No exact match found for target '$TARGET'. Review keys in repo settings and remove manually if needed."
fi

echo "Private key path: $priv"
echo "Remember to secure $priv (delete after provisioning)."
