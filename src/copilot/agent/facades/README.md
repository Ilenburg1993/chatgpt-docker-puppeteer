# agent/facades/

Fachadas finas do `AlwaysAliveAgent`.

## Pergunta que esta pasta responde

> Quais capabilities públicas do runtime do agente precisamos expor sem obrigar cada caller a
> conhecer `AgentContext`, sessão SDK ou wiring interno?

## Arquivos

| Arquivo                         | Owner semântico | Função                                                                                                                                                          |
| ------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-dialog-runtime.js`       | lifecycle       | operações de diálogo runtime (`start/send/stop/recover`)                                                                                                        |
| `agent-health-access.js`        | query           | leitura canônica dos sinais de health                                                                                                                           |
| `agent-model-config.js`         | mutation        | modelo, reasoning e listagem de modelos                                                                                                                         |
| `agent-runtime-capabilities.js` | projection      | mapa canônico das capabilities públicas atuais do runtime                                                                                                       |
| `agent-runtime-controls.js`     | mutation        | controles e mutações auxiliares do runtime                                                                                                                      |
| `agent-runtime-event-bridge.js` | infra           | wiring dos emitters internos para o EventBus                                                                                                                    |
| `agent-runtime-ownership.js`    | mutation        | vínculo entre sessão SDK ativa e hub session                                                                                                                    |
| `agent-runtime-state.js`        | mutation        | persistência semântica do estado vivo do runtime                                                                                                                |
| `agent-runtime-status.js`       | query           | snapshots/status/health compatíveis do runtime                                                                                                                  |
| `agent-runtime-todos.js`        | query           | projections da capacidade TODO                                                                                                                                  |
| `agent-runtime-tools.js`        | query           | tools disponíveis no runtime do agent                                                                                                                           |
| `agent-runtime-webhooks.js`     | mutation        | operações de webhook do runtime                                                                                                                                 |
| `agent-sdk-access.js`           | infra           | façade pública compat que agrega `sdk/*.js` por domínio (client, models, tools, quota, sessions, workspace, UI) e preserva a borda canônica do runtime             |
| `agent-sdk-runtime.js`          | infra           | operações de sessão SDK ativa dentro do runtime                                                                                                                 |
| `agent-sdk-session.js`          | mutation        | operações vanilla de sessão SDK (`mode` e `plan`)                                                                                                               |
| `agent-session-ops.js`          | lifecycle       | operações diretas de sessão (abort, log, watchdog, histórico)                                                                                                   |
| `agent-webhook-ops.js`          | mutation        | operações de webhook/integração expostas pela fachada do agente                                                                                                 |
| `index.js`                      | barrel          | barrel canônico das façades modernas reexportadas por `agent/index.js`                                                                                          |

### Subárvore `sdk/`

- `sdk/client.js` — client, lifecycle e handles/health
- `sdk/models.js` — catálogo/model stats/experimental flags
- `sdk/tools.js` — registry/config/load de tools
- `sdk/quota.js` — quota monitor e recovery policy
- `sdk/sessions.js` — CRUD/foreground/list/resume de sessões
- `sdk/workspace-ops.js` — workspace files, shell e custom agents
- `sdk/ui-ops.js` — elicitation, session.ui e pendências SDK

`agent-sdk-access.js` permanece como **façade pública canônica** para callers do runtime; a pasta
`sdk/` existe para evitar monólito interno, não para reabrir bypasss arbitrários.

Os owners acima são protegidos por `tests/unit/copilot/contracts/test_facade_bypass_matrix.spec.js`.
Qualquer import cruzado entre facades precisa estar declarado na matriz executável antes de ser
aceito.

## Regra de uso

- `always-alive.js` deve delegar aqui em vez de carregar lógica operacional densa.
- novas bordas devem preferir imports de façades/projections nomeadas, não crescer o barrel amplo de
  `agent/index.js`.
- Toda capability análoga ao SDK deve nascer de `sdk/` e ser exposta aqui só quando fizer sentido
  como API pública do runtime.
- Esta pasta não é lugar para UI, REPL ou formatting.

## Heurística prática

- Se o caller diz “quero pedir algo ao agent”, provavelmente passa por uma facade.
- Se o código diz “quero abrir o `ctx` e sair mexendo”, provavelmente ainda falta uma facade ou
  helper semântico.
