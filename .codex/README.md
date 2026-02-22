# Codex (project config)

This repository keeps a project-scoped Codex config in `.codex/config.toml`.

## Use in terminal

Run Codex with:

`CODEX_HOME=$PWD/.codex codex`

Notes:

- `CODEX_HOME` changes where Codex stores its state (sessions, shell snapshots, etc.).
- If you already logged in using the default home (`~/.codex`), you may need to login again for this
  home, or copy `~/.codex/auth.json` → `.codex/auth.json` (this repo ignores `.codex/*` except
  `config.toml` and this README).

## VS Code integrated terminal

This repo sets `CODEX_HOME` automatically for Linux terminals:

- `.vscode/settings.json` → `terminal.integrated.env.linux.CODEX_HOME`
