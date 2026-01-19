#!/usr/bin/env bash
set -euo pipefail
# Rotate GitHub Actions secrets for this repository.
# Requires: `gh` CLI authenticated as repo owner, and `jq`.

REPO="Rajude/chatgpt-docker-puppeteer"

usage(){
  cat <<EOF
Usage: $0 [--from-file FILE]

Interactive: will list secrets and prompt to set new values (read from stdin).
--from-file FILE: file with lines SECRET_NAME=VALUE to set non-interactively.
EOF
}

if [ "${1-}" = "--help" ]; then usage; exit 0; fi

if [ "${1-}" = "--from-file" ]; then
  FILE="$2"
  if [ ! -f "$FILE" ]; then echo "File not found: $FILE"; exit 1; fi
  while IFS="=" read -r name val; do
    [ -z "$name" ] && continue
    echo "Setting secret: $name"
    echo -n "$val" | gh secret set "$name" -R "$REPO" --body -
  done < "$FILE"
  exit 0
fi

echo "Listing repository secrets for $REPO"
gh secret list -R "$REPO"

echo "Enter secret names to rotate (space-separated), or press Enter to quit:" 
read -r input
[ -z "$input" ] && echo "No secrets selected; exiting." && exit 0

for name in $input; do
  echo "Provide new value for secret '$name' (will be read from stdin, end with CTRL-D):"
  value=$(cat)
  if [ -z "$value" ]; then echo "Empty value; skipping $name"; continue; fi
  echo -n "Setting secret $name... "
  echo -n "$value" | gh secret set "$name" -R "$REPO" --body - && echo "OK"
done

echo "Done. Verify in repository Settings → Secrets and variables → Actions."
