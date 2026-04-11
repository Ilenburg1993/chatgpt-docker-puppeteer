# core/

**Camada**: L0 (mais baixa) — sem dependências de outros módulos `copilot/*`.

Contratos fundamentais, tipos, schemas de validação, constantes e utilitários puros reutilizados
por todas as outras camadas.

## Conteúdo

| Arquivo | Responsabilidade |
|---|---|
| `errors.js` | Hierarquia de erros customizados (`ConfigError`, `SessionError`, etc.) |
| `error-handlers.js` | Handlers centrais para erros swallowed (DI via `registerErrorHandlerDeps`) |
| `events.js` | Constantes de nomes de eventos (`AGENT_EVENTS`, `DIALOG_LOOP_EVENTS`) |
| `schemas.js` | Schemas de validação (Zod-like) para payloads |
| `constants.js` | Re-export de events + constantes globais |
| `timer-registry.js` | Registro de timers para cleanup no shutdown |
| `shared-state.js` | SSOT para estado compartilhado cross-layer (`hubSessionId`) |
| `security/url-validator.js` | SSOT anti-SSRF: `validateUrl`, `validateWebhookUrl`, DNS rebinding |

## Regras de importação

- **Pode importar**: `node:*`, `#copilot/config/env` (variáveis de ambiente)
- **NÃO pode importar**: nenhum outro módulo de `src/copilot/`
- Violações verificáveis via `madge`
