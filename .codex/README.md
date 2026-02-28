# Codex (project config)

This repository keeps a project-scoped Codex config in `.codex/config.toml`.

_⚠️ Atualização:_ desde a migração de skills, a pasta `.codex/skills/` não é mais a fonte canônica.
Novas skills e upgrades reais devem ser feitos em `.github/skills/`. Os arquivos em `.codex/skills/`
devem existir apenas como stubs curtos de compatibilidade, quando ainda necessários.

## Use in terminal

Run Codex with:

`CODEX_HOME=$PWD/.codex codex`

Notes:

- `CODEX_HOME` changes where Codex stores its state (sessions, shell snapshots, etc.).
- If you already logged in using the default home (`~/.codex`), you may need to login again for this
  home, or copy `~/.codex/auth.json` → `.codex/auth.json` (this repo ignores `.codex/*` except
  `config.toml` and this README).

## Compatibility contract

To avoid Codex getting stuck loading inside the DevContainer, keep these three surfaces aligned to
the same project-scoped home:

- `.codex/config.toml`
- `.devcontainer/devcontainer.json` → `remoteEnv.CODEX_HOME`
- `.vscode/settings.json` → `terminal.integrated.env.linux.CODEX_HOME`

Do not point the in-container workspace back to `~/.codex`.
Do not reintroduce the removed `remote_models` feature flag in `.codex/config.toml`.
Keep `.github/skills` and `.github/instructions` as the canonical shared sources for Copilot and
other agents.

## VS Code integrated terminal

This repo sets `CODEX_HOME` automatically for Linux terminals:

- `.vscode/settings.json` → `terminal.integrated.env.linux.CODEX_HOME`
