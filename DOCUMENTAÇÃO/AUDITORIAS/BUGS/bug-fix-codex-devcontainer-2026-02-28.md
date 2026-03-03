# Bug Fix: Codex + DevContainer + WSL (2026-02-28)

## Sintoma

- Codex ficava carregando indefinidamente quando o projeto era aberto no DevContainer.
- Em WSL, alguns comandos (`npm run ...`) podiam cair em `CMD.EXE` e falhar com caminhos UNC.

## Causas encontradas

- O workspace forçava `chatgpt.runCodexInWindowsSubsystemForLinux=true`, o que é correto em WSL
  direto, mas incorreto dentro do DevContainer.
- O processo remoto do VS Code no DevContainer não tinha `CODEX_HOME` alinhado com o terminal
  integrado.
- Havia logs de debug residuais em `.devcontainer/scripts/post-attach.sh`.
- O healthcheck tratava qualquer estado `degraded` do `post-start` como falha crítica, contrariando
  o contrato do próprio script.
- A configuração do `.codex` carregava o feature flag removido `remote_models`.

## Correções aplicadas

- `devcontainer.json`: override explícito para desativar `runCodexInWindowsSubsystemForLinux` no
  container e injetar `CODEX_HOME` no `remoteEnv`.
- `post-attach.sh`: remoção de logs `DEBUG ...` e alerta quando `node/npm` resolvem para binários do
  Windows (`/mnt/<drive>/...`).
- `healthcheck.sh`: estados advisory (`degraded`) passaram a gerar apenas aviso; só estados críticos
  falham o healthcheck.
- `scripts/env/check-env.mjs`: agora exibe `node`/`npm` efetivos e alerta quando o runtime vem do
  Windows dentro de um ambiente Linux.
- `.codex/config.toml`: removido `remote_models = false` (flag obsoleta/removida).

## Risco residual

- Se o WSL continuar usando `node` ou `npm` do Windows no PATH global, comandos fora do container
  ainda podem falhar. O repositório agora detecta isso com mais clareza, mas a correção definitiva
  depende do ambiente do usuário.
