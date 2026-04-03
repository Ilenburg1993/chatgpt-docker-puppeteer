# types/sdk.js — Auditoria

**Módulo**: `src/copilot/types/` **Arquivo**: `sdk.js` **LOC**: 112 | **Score**: 9.5/10

## Responsabilidade

Barrel de tipos puro (runtime: nenhum). Centraliza 15 `@typedef` do `@github/copilot-sdk`, evitando
strings de importação repetidas em toda a base de código. Exporta `{}` vazio.

Tipos cobertos: `CopilotClient`, `CopilotSession`, `SessionConfig`, `SessionEvent`,
`SessionEventType`, `SessionEventHandler`, `Tool`, `PermissionHandler`, `PermissionRequest`,
`PermissionRequestResult`, `MessageOptions`, `CopilotClientOptions`, `InfiniteSessionConfig`,
`ResumeSessionConfig`, `ToolInvocation`, `ZodSchema<T>`.

## Achados

### P5 — `sdk.js` não é re-exportado via `types/index.js` nem `core/index.js`

**Localização**: `types/index.js` — não importa de `./sdk.js`

**Descrição**: Para usar os tipos do SDK, um módulo precisa importar diretamente de
`'../types/sdk.js'` (ou por alias se existir). O barrel `index.js` não re-exporta sdk.js. Em prática
não há impacto em runtime (arquivo é puro typedef), mas quebra a convenção de acesso único via
barrel.

**Sugestão**: Como sdk.js exporta `{}`, adicionar `export * from './sdk.js'` ao `types/index.js` não
teria efeito em runtime mas tornaria os typedefs consistentemente acessíveis via barrel.

---

## Destaques Positivos

- Arquivo puramente documental: zero runtime, apenas JSDoc
- Cobertura completa da API pública do SDK em uso (15 typedefs)
- `export {}` explícito para manter o módulo como ES module válido

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
