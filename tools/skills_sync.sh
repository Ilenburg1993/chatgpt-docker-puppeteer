#!/usr/bin/env bash
set -euo pipefail

# Sincroniza skills pessoais e de projeto para o diretório `skills/` do workspace.
# - Copia `~/.copilot/skills/*` → `skills/personal/*`
# - Copia `.github/skills/*` e `.claude/skills/*` → `skills/project/*`

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/skills"

mkdir -p "$DEST/personal" "$DEST/project"

echo "Workspace: $ROOT"

if [ -d "$HOME/.copilot/skills" ]; then
  echo "Syncing personal skills from $HOME/.copilot/skills"
  for d in "$HOME/.copilot/skills"/*; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    dst="$DEST/personal/$name"
    rm -rf "$dst"
    cp -r "$d" "$dst"
    echo "  - $name"
  done
else
  echo "No personal skills found at $HOME/.copilot/skills"
fi

for src in "$ROOT/.github/skills" "$ROOT/.claude/skills"; do
  if [ -d "$src" ]; then
    echo "Syncing project skills from $src"
    for d in "$src"/*; do
      [ -d "$d" ] || continue
      name="$(basename "$d")"
      dst="$DEST/project/$name"
      rm -rf "$dst"
      cp -r "$d" "$dst"
      echo "  - $name"
    done
  fi
done

echo "Sync complete. To build index run: node tools/generate_skills_index.js"

exit 0
