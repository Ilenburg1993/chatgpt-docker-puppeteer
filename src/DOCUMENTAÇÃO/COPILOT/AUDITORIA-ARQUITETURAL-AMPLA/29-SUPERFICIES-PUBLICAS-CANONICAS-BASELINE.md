# 29 — Superfícies Públicas Canônicas (Baseline do Bloco A)

**Status**: baseline de superfícies públicas **Última atualização**: 2026-04-27 **Escopo desta
etapa**: registrar as superfícies públicas canônicas dos módulos mais críticos de `src/copilot/`
como base para snapshots, contract tests e futuras deprecações.

---

## 1. Objetivo deste documento

Uma revolução arquitetural segura exige saber, com antecedência, quais superfícies públicas estamos
protegendo, remodelando ou descomissionando.

Este documento registra a baseline de superfícies públicas dos módulos que concentram mais risco e
mais impacto sistêmico.

---

## 2. Módulos cobertos nesta baseline inicial

1. `sdk/`
2. `agent/`
3. `presentation/`
4. `hooks/`
5. `tools/`
6. `server/routes/sdk/*`

A baseline é propositalmente inicial. Ela será refinada em waves posteriores.

---

## 3. Baseline por módulo

## 3.1 `sdk/`

### Ponto de entrada canônico

- `#copilot/sdk`

### Tipo de superfície

- barrel L1 do wrapper vanilla.

### Famílias públicas que devem permanecer reconhecíveis

- client/session lifecycle
- session wrapper
- session UI
- RPC wrappers
- tools helpers
- model/catalog helpers
- telemetry/health/quota
- types SSOT
- experimental surfaces explicitamente marcadas

### Observação

A superfície pode crescer, mas não deve deixar de ser compreensível por famílias.

---

## 3.2 `agent/`

### Ponto de entrada canônico

- `#copilot/agent`

### Exports-raiz hoje observados como centrais

- `AlwaysAliveAgent`
- `alwaysAliveAgent`
- `getAgent`
- `resetAgent`
- `runtime-registry` helpers
- façades reexportadas
- DI token `ALWAYS_ALIVE_AGENT`

### Famílias públicas a preservar semanticamente

- runtime lifecycle
- runtime state/status/health
- dialog loop control
- SDK session surfaces promovidas
- runtime registry
- façades e commands

### Observação

A superfície pública do `agent/` já é extensa; a revolução deve organizá-la, não torná-la opaca.

---

## 3.3 `presentation/`

### Ponto de entrada canônico

- `#copilot/presentation`

### Famílias públicas observadas

- `agent-runtime`
- runtime capabilities
- runtime controls
- runtime dialog
- runtime health/status
- runtime models
- runtime ownership
- runtime SDK session
- runtime tools/todos/webhooks
- conversation hub presentation
- system config / system metrics

### Observação

Esta é a superfície mais importante para proteção de borda compartilhada. Ela precisa de contract
coverage progressiva.

---

## 3.4 `hooks/`

### Ponto de entrada canônico

- `#copilot/hooks`

### Famílias públicas observadas

- types
- factory principal
- permission handlers
- session lifecycle hooks
- prompt transformer
- tool interceptors
- user input / elicitation handlers
- bus
- registry
- composer
- presets
- error handlers
- audit helpers
- DI token e logger injection

### Observação

A superfície é rica, mas deve continuar semanticamente agrupável por categoria de hook/policy.

---

## 3.5 `tools/`

### Ponto de entrada canônico

- `#copilot/tools`

### Superfícies públicas observadas

- `getAllTools`
- `allTools`
- `buildTool`
- `withSkipPermission`
- categorias de tool reexportadas
- setters de DI controlados
- logger/metrics injection
- DI tokens

### Observação

A baseline de `tools/` deve proteger a distinção entre:

- factory de tool;
- catálogo de tools;
- categorias de capability;
- hooks auxiliares de DI.

---

## 3.6 `server/routes/sdk/*`

### Superfície pública funcional

Mais do que um barrel único, este subdomínio expõe uma superfície HTTP organizada em:

- `client`
- `sessions`
- `session-crud`
- `session-middleware`
- `session-messaging`
- `agent`
- `hooks`
- `observability`
- `deps`
- `index`

### Observação

A baseline aqui não é de exports JS apenas; é também de família de rotas e responsabilidades HTTP.

---

## 4. Contratos mínimos que o Bloco A já deve vigiar

## 4.1 `sdk/`

- continua sendo importável via `#copilot/sdk`;
- nenhum consumer externo precisa importar o vendor diretamente.

## 4.2 `agent/`

- `#copilot/agent` continua sendo a superfície semântica do runtime;
- bordas não precisam importar internals soltos para obter estado principal.

## 4.3 `presentation/`

- `#copilot/presentation` permanece como edge layer compartilhado;
- `terminal` e `server` devem continuar conseguindo consumi-lo como seam principal.

## 4.4 `hooks/`

- famílias públicas de hook continuam agrupáveis e coerentes.

## 4.5 `tools/`

- a factory e o catálogo central continuam reconhecíveis.

---

## 5. Relação com os contract tests do Bloco A

Este documento fundamenta:

- snapshots conceituais de superfície pública;
- contract tests estruturais por owner;
- futuras deprecações e compat warnings.

Ele não substitui testes automatizados, mas os orienta.

---

## 6. Conclusão desta etapa

Sem baseline de superfície pública, qualquer refatoração profunda parece segura até quebrar todos os
consumers. Este documento existe para evitar exatamente isso: ele congela a leitura inicial das APIs
canônicas antes da cirurgia arquitetural.
