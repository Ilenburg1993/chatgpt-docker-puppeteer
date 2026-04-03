# lib/index.js — Auditoria

**Módulo**: `src/copilot/lib/` **Arquivo**: `index.js` **LOC**: 120 | **Score**: 9.5/10

## Responsabilidade

Barrel centralizado da camada lib. Expõe:

- `sdk-client.js`: 20 funções de lifecycle/registry do CopilotClient
- `#copilot/hooks/factory`: 7 factories de SessionHooks (via barrel)
- `#copilot/hooks/permission`: 5 factories de PermissionHandler
- `session.js`: 7 operações de sessão
- `agents.js`: 8 factories de CustomAgentConfig
- `models.js`: 11 helpers de listagem/roteamento de modelos
- `tools-registry.js`: 16 funções do registry de tools
- `event-helpers.js`: `raceEvents`, `waitForEvent`
- `http-request.js`: `httpRequest`
- `url-validator.js`: `validateUrl`, `validateUrlString`
- `utils.js`: `pickDefined`

## Achados

Nenhum. Barrel correto — importa de caminhos canônicos (não das versões deprecated).

## Destaque

Nota: `lib/index.js` exporta hooks/permissions via `#copilot/hooks/factory` e
`#copilot/hooks/permission` diretamente, **não** via os wrappers deprecated `lib/hooks.js` e
`lib/permissions.js` — correto.

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
