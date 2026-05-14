# Mapa canônico de acesso ao `src/copilot/sdk`

**Status**: consolidado para surfaces SDK canônicas
**Última revisão**: 2026-05-14
**Escopo**: pontos de entrada/saída entre `src/copilot/**` e `src/copilot/sdk/**`

## Objetivo

Este mapa consolida os pontos de acesso canônicos ao SDK dentro de `src/copilot`, reduzindo rotas paralelas,
nomes genéricos e superfícies sobrepostas.

A regra-alvo é:

- **entrada canônica**: consumir o SDK por superfícies explícitas e estáveis;
- **saída canônica**: o SDK importar domínios externos apenas pelas superfícies autorizadas (`boot`, `core`, `infra`,
  `events`, `config`, `presentation` quando aplicável);
- **sem caminhos paralelos**: evitar reexportação duplicada em múltiplos níveis quando a superfície canônica já existe.

## Superfícies canônicas de entrada para consumidores de `src/copilot`

### 1. `#copilot/sdk`

Superfície pública estável do SDK. Deve concentrar:

- tipos e constantes centrais expostos no barrel raiz;
- factories e helpers de uso amplo;
- acessos de composição/boot que realmente sejam parte da API canônica;
- runtime comum quando a granularidade não exigir subpath específico.

**Observação**: esta superfície continua ampla por compatibilidade arquitetural, mas não deve ser tratada como rota
padrão quando existir subpath canônico mais específico.

### 2. `#copilot/sdk/session`

Canônica para:

- lifecycle de sessão;
- eventos e listeners de sessão;
- runtime de sessão de alto nível (`send`, `sendAndWait`, `setModel`, `abort`, `dispose`);
- UI/elicitation e permissões associadas à sessão.

### 3. `#copilot/sdk/session-runtime`

Canônica para operações de runtime da sessão quando o consumidor precisa da semântica operacional explícita:

- `sendSession`, `sendSessionAndWait`
- `setSessionModel`
- `abortSession`, `disconnectSessionSafe`, `disposeSession`
- introspecção de mensagens e workspace da sessão

### 4. `#copilot/sdk/rpc`

Canônica para a surface RPC estável:

- `client`, `model`, `mode`, `plan`, `workspace`, `log`
- `server` RPC e health helpers correlatos quando expostos pelo barrel
- operation facades e guards de RPC estáveis

### 5. `#copilot/sdk/telemetry`

Canônica para:

- tracing;
- métricas;
- quota monitor;
- health/diagnostics relacionadas à camada SDK.

### 6. `#copilot/sdk/tools`

Canônica para:

- registry de tools;
- state/custom tools;
- builders e helpers de tools;
- policy de tools quando consumida fora do runtime interno do agent.

### 7. `#copilot/sdk/agents`

Canônica para a modelagem de agentes do SDK:

- criação/listagem/seleção de agentes;
- agente full access/read-only;
- helpers de inferência de agente.

### 8. `#copilot/sdk/models`

Canônica para:

- listagem e cache de modelos;
- seleção automática e auto-policy;
- registry/model selector/stats tracker;
- helpers de capabilities, reasoning e vision.

### 9. `#copilot/sdk/types`

Canônica para JSDoc/type-only:

- tipos públicos do `@github/copilot-sdk`;
- tipos locais do wrapper SDK;
- contratos de métricas, session fs e runtime usados só pelo tsserver.

### 10. `#copilot/sdk/rpc/experimental`

Canônica apenas para os subsistemas experimentais ainda isolados:

- `fleet`
- `skills`
- `mcp`
- `plugins`
- `extensions`

**Regra importante**: `agent.*` não pertence mais a esta surface. Agent virou domínio estável e deve ser consumido
pela surface canônica de RPC estável.

### 11. Micro-surfaces raiz explícitas

Substituem o antigo uso residual do root e o wildcard físico:

- `#copilot/sdk/constants`
- `#copilot/sdk/di`
- `#copilot/sdk/errors`
- `#copilot/sdk/event-helpers`
- `#copilot/sdk/feature-flags`
- `#copilot/sdk/utils`

Essas surfaces existem para que `agent`, `boot`, `config`, `audit`, `server` e `observability` não precisem importar o
barrel raiz apenas para constantes, tokens, classificação de erro ou helpers pequenos.

## Entradas canônicas por camada de `src/copilot`

### Boot / composition

- `src/copilot/boot/runtime-bootstrap.js` → `#copilot/sdk/di`, `#copilot/sdk/session`,
  `#copilot/sdk/telemetry`
- `#copilot/sdk` só é aceito no boot para validação explícita da surface pública

### Config

- `src/copilot/config/sdk-config-port.js` → `#copilot/sdk/constants`, `#copilot/sdk/session`, `#copilot/sdk/tools`
- `src/copilot/config/system-prompt/*` → `#copilot/sdk/session` + `#copilot/sdk/rpc`

### Event handlers

- `src/copilot/event-handlers/*` → `#copilot/sdk/session` para listeners de eventos de sessão

### Agent runtime e facades

- `src/copilot/agent/*` → `#copilot/sdk/session`, `#copilot/sdk/session-runtime`, `#copilot/sdk/rpc`,
  `#copilot/sdk/tools`, `#copilot/sdk/telemetry`, `#copilot/sdk/errors`, `#copilot/sdk/event-helpers`,
  `#copilot/sdk/feature-flags` e `#copilot/sdk/utils` quando a semântica exigir o subdomínio específico
- `src/copilot/agent/*` → `#copilot/sdk/models` para registry, seleção, stats e listagem de modelos

### Hooks / observability / terminal / server

- `src/copilot/hooks/*` → `#copilot/sdk/session`, `#copilot/sdk/models`, `#copilot/sdk/errors`
- `src/copilot/observability/*` → `#copilot/sdk/di`, `#copilot/sdk/session`, `#copilot/sdk/telemetry`
- `src/copilot/terminal/*` → `#copilot/sdk/session`, `#copilot/sdk/rpc`
- `src/copilot/server/routes/sdk/*` → `#copilot/sdk/session`, `#copilot/sdk/rpc`, `#copilot/sdk/tools`,
  `#copilot/sdk/telemetry`, `#copilot/sdk/utils`

### Tools / bridges / runtime

- `src/copilot/tools/*` → `#copilot/sdk/rpc`, `#copilot/sdk/session`
- `src/copilot/tools/*` → `#copilot/sdk/tools` para factories, registry e custom tools
- `src/copilot/runtime-wiring.js` → `#copilot/sdk/session` quando houver seam operacional específico
- `src/copilot/config/session-config.js` é a fronteira canônica para `SessionConfigBuilder`; o SDK não expõe mais
  `sdk/config.js` nem helpers duplicados de config.

## Saídas canônicas do SDK para domínios externos

Quando o SDK precisa importar outros domínios do projeto, os pontos autorizados são:

- `#copilot/core` e `#copilot/core/*`
- `#copilot/boot` e `#copilot/boot/*`
- `#copilot/infra` e `#copilot/infra/*`
- `#copilot/events`
- `#copilot/config`
- `#copilot/presentation` quando a camada for de projection/access e não de policy

## Pontos paralelos que devem ser evitados

### Paralelo 1 — `agent.*` dentro de experimental RPC

Já removido da surface experimental. O domínio agent deve ficar na surface estável de RPC e nas façades
canônicas do agent.

### Paralelo 2 — barrels genéricos demais para wrappers específicos

Ex.: nomes como `agent-sdk-access` ou wrappers intermediários que apenas reexportam outro barrel sem adicionar policy.

### Paralelo 3 — root SDK usado quando o subpath existe

Quando houver subpath canônico (`session`, `rpc`, `telemetry`, `tools`, `agents`), ele deve ser preferido ao root.

### Paralelo 4 — aliases de compatibilidade em `package.json`

Resolvido nesta onda. Aliases folha e wildcard físico foram removidos; `package.json#imports` só expõe surfaces SDK
semânticas e explícitas.

## Consolidações aplicadas nesta onda

- `src/copilot/agent/facades/agent-sdk-access.js` foi renomeado para `sdk-access.js`, reduzindo um nome genérico e
  tornando a surface do agent mais legível.
- `src/copilot/sdk/config.js` foi removido. Configuração de sessão pertence a `#copilot/config` via
  `SessionConfigBuilder`, evitando duplicação L1↔L2.
- `src/copilot/agent/ports/tool-port.js` agora consome `#copilot/sdk/rpc` para `createSessionRpcFacade`.
- `src/copilot/agent/ports/permission-port.js` agora consome `#copilot/sdk/session` para `PermissionController`.
- `src/copilot/agent/ports/hook-port.js` agora consome `attachBus`, `createQueuedElicitationHandler` e `defaultBus` via
  `#copilot/sdk/session`, reservando `#copilot/sdk` raiz apenas para as helpers que ainda não têm subpath explícito.
- `#copilot/sdk/models` e `#copilot/sdk/types` foram promovidos a aliases explícitos em `package.json`, removendo a
  dependência de wildcard implícito.
- `#copilot/sdk/constants`, `#copilot/sdk/di`, `#copilot/sdk/errors`, `#copilot/sdk/event-helpers`,
  `#copilot/sdk/feature-flags` e `#copilot/sdk/utils` foram criados como micro-surfaces estáveis.
- O wildcard `#copilot/sdk/*` e todos os aliases folha de compatibilidade foram removidos de `package.json`.
- `package.json#exports` agora publica as surfaces SDK estáveis sem expor caminhos físicos internos como API pública.
- `src/copilot/sdk/session` deixou de abrir `copilot.sqlite` no import: `hook-bus` e `permission-controller` passaram a
  usar módulos folha de `events` e `config`.
- Consumers operacionais em `terminal`, `event-handlers`, `hooks`, `tools`, `agent/facades` e `server/routes/sdk/deps`
  foram deslocados do root para subpaths canônicos.
- `#copilot/config/tools-state`, `#copilot/config/custom-tools-registry`, `#copilot/config/tools` e
  `#copilot/config/tools/*` foram removidos de `package.json` porque apontavam para arquivos inexistentes.
- Outros aliases históricos quebrados de `package.json` também foram removidos e agora há teste de regressão para
  validar que aliases internos apontam para destinos existentes.
- `config/typing/strict/tsconfig.strict.src.copilot.sdk.json` foi criado para aplicar TypeScript 6/NodeNext estrito ao
  SDK local. `skipLibCheck: false` foi avaliado, mas está bloqueado por declarações externas de `vscode-jsonrpc`; o
  SDK local passa com `skipLibCheck: true` e todas as demais flags rigorosas relevantes.

## Mapa resumido atual por frequência observada

Leitura baseada no inventário de `src/copilot` em 2026-05-14:

- `#copilot/sdk/types` → 420 referências JSDoc/type-only
- `#copilot/sdk/session` → 75 referências
- `#copilot/sdk/rpc` → 20 referências
- `#copilot/sdk/rpc/experimental` → 15 referências
- `#copilot/sdk/tools` → 11 referências
- `#copilot/sdk/telemetry` → 10 referências
- `#copilot/sdk` → 8 referências
- micro-surfaces (`constants`, `di`, `errors`, `event-helpers`, `feature-flags`, `utils`) → 33 referências somadas

## Baseline por camada (inventário real)

Snapshot em `src/copilot/**` (fora de `sdk/`) por camada consumidora:

| Camada              | Alias                           | Usos |
| ------------------- | ------------------------------- | ---: |
| `event-handlers`    | `#copilot/sdk/session`          |   16 |
| `hooks`             | `#copilot/sdk/session`          |   12 |
| `agent`             | `#copilot/sdk/session`          |    8 |
| `agent`             | `#copilot/sdk/rpc`              |    6 |
| `observability`     | `#copilot/sdk/session`          |    6 |
| `terminal`          | `#copilot/sdk/session`          |    6 |
| `config`            | `#copilot/sdk/session`          |    5 |
| `server`            | `#copilot/sdk/session`          |    5 |
| `tools`             | `#copilot/sdk/rpc`              |    4 |
| `agent`             | `#copilot/sdk/session-runtime`  |    3 |
| `agent`             | `#copilot/sdk/models`           |    3 |
| `agent`             | `#copilot/sdk/errors`           |    2 |
| `agent`             | `#copilot/sdk/event-helpers`    |    2 |
| `agent`             | `#copilot/sdk/telemetry`        |    2 |
| `tools`             | `#copilot/sdk/tools`            |    2 |
| `agent`             | `#copilot/sdk/tools`            |    1 |
| `audit`             | `#copilot/sdk/constants`        |    1 |
| `boot`              | `#copilot/sdk`                  |    1 |
| `boot`              | `#copilot/sdk/di`               |    1 |
| `boot`              | `#copilot/sdk/session`          |    1 |
| `boot`              | `#copilot/sdk/telemetry`        |    1 |
| `config`            | `#copilot/sdk/constants`        |    1 |
| `config`            | `#copilot/sdk/rpc`              |    1 |
| `config`            | `#copilot/sdk/tools`            |    1 |
| `events`            | `#copilot/sdk/session`          |    1 |
| `hooks`             | `#copilot/sdk/constants`        |    1 |
| `hooks`             | `#copilot/sdk/errors`           |    1 |
| `hooks`             | `#copilot/sdk/models`           |    1 |
| `observability`     | `#copilot/sdk/di`               |    1 |
| `observability`     | `#copilot/sdk/telemetry`        |    1 |
| `observability`     | `#copilot/sdk/tools`            |    1 |
| `runtime-wiring.js` | `#copilot/sdk/session`          |    1 |
| `server`            | `#copilot/sdk/rpc`              |    1 |
| `server`            | `#copilot/sdk/telemetry`        |    1 |
| `server`            | `#copilot/sdk/utils`            |    1 |
| `tools`             | `#copilot/sdk/rpc/experimental` |    1 |
| `tools`             | `#copilot/sdk/session`          |    1 |
| `types`             | `#copilot/sdk/di`               |    1 |

Leitura: `session` é a superfície dominante; o root agora resta para contrato público/barrel e validação explícita.
Os usos residuais de constantes, erros, helpers e DI foram deslocados para micro-surfaces.

## Próximo passo sugerido

A próxima onda deve:

1. converter gradualmente `src/copilot/sdk` de JS+JSDoc para TS com `erasableSyntaxOnly`;
2. isolar ou atualizar dependências que bloqueiam `skipLibCheck: false` no TypeScript 6;
3. ativar `@typescript-eslint/no-unsafe-*` por subpasta do SDK, começando pelas surfaces puras;
4. manter o guard de aliases explícitos e impedir reintrodução de wildcard ou aliases folha.
