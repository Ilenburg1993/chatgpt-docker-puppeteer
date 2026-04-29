# core/

**Camada**: L0 (mais baixa) — sem dependências de outros módulos `copilot/*`.

Contratos fundamentais, tipos, schemas de validação, constantes e utilitários puros reutilizados por
todas as outras camadas.

## Conteúdo

| Arquivo                     | Responsabilidade                                                           |
| --------------------------- | -------------------------------------------------------------------------- |
| `errors.js`                 | Hierarquia de erros customizados (`ConfigError`, `SessionError`, etc.)     |
| `error-handlers.js`         | Handlers centrais para erros swallowed (DI via `registerErrorHandlerDeps`) |
| `events.js`                 | Constantes de nomes de eventos (`AGENT_EVENTS`, `DIALOG_LOOP_EVENTS`)      |
| `schemas.js`                | Schemas de validação (Zod-like) para payloads                              |
| `constants.js`              | Re-export de events + constantes globais                                   |
| `timer-registry.js`         | Registro de timers para cleanup no shutdown                                |
| `shutdown.js`               | Shutdown central single-flight, reports e eventos de lifecycle             |
| `shutdown-priorities.js`    | Prioridades canônicas para handlers de shutdown                            |
| `shared-state.js`           | SSOT para estado compartilhado cross-layer (`hubSessionId`)                |
| `security/url-validator.js` | SSOT anti-SSRF: `validateUrl`, `validateWebhookUrl`, DNS rebinding         |

## Shutdown

`runShutdown()` é single-flight: chamadas concorrentes compartilham a mesma promise e nenhum handler
roda duas vezes. Cada execução produz `ShutdownReport`, lido por `getLastShutdownReport()`, e cada
handler registrado aparece em `listShutdownHandlers()`.

Prioridades canônicas vivem em `SHUTDOWN_PRIORITY`:

| Prioridade | Constante                              | Uso                                                    |
| ---------- | -------------------------------------- | ------------------------------------------------------ |
| 0          | `COMPAT_RUNTIME_HOST`                  | camada compat que precisa observar tudo desde o início |
| 5          | `TIMERS_EARLY` / `RUNTIME_STATE_DRAIN` | timers e drains que não devem disparar durante cleanup |
| 10         | `RUNTIME_CRITICAL`                     | agent/session/client e recursos críticos de runtime    |
| 15         | `TERMINAL_RESOURCE` / `DATABASE`       | loaders, recursos locais e banco                       |
| 16         | `TERMINAL_ACTIVITY`                    | listeners/emitters de UX do terminal                   |
| 20         | `NETWORK`                              | HTTP/Socket.IO                                         |
| 40-46      | `OBSERVABILITY_*`                      | bus, tracker e detach de observabilidade               |
| 50         | `DEFAULT`                              | cleanup comum                                          |
| 90         | `AUDIT_FINALIZER`                      | flush final de auditoria/logs                          |

Checklist para novo handler:

- nome estável e único;
- prioridade via `SHUTDOWN_PRIORITY`, não número mágico;
- timeout explícito quando a operação puder bloquear;
- handler idempotente;
- se falhar, não deve impedir handlers seguintes.

## Regras de importação

- **Pode importar**: `node:*`, `#copilot/config/env` (variáveis de ambiente)
- **NÃO pode importar**: nenhum outro módulo de `src/copilot/`
- Violações verificáveis via `madge`
