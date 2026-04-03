# Auditoria: hooks/bus.js

**Módulo**: hooks/ · **Fase**: F06-02 · **Data**: 2026-04-03 **Arquivo**: `src/copilot/hooks/bus.js`
· **LOC**: ~175

## Resumo

`HookBus` estende `EventEmitter` para observação desacoplada dos hooks SDK. `attachBus()` wrapa
handlers existentes, emitindo eventos no bus após execução. Suporta wildcard `'*'`.

## Análise Estrutural

### Imports

- `#copilot/observability/logger` — barrel bypass
- `node:events` — EventEmitter nativo

### Exports

| Export       | Tipo      | Consumidores               |
| ------------ | --------- | -------------------------- |
| `HookBus`    | class     | presets/production, testes |
| `defaultBus` | singleton | index.js re-export         |
| `attachBus`  | function  | factory composition        |

### Estado Interno

- `defaultBus`: module-level singleton HookBus
- `setMaxListeners(50)`: configuração fixa

## Achados

### BUG-HOOK-001 · P3 — `attachBus` não propaga hooks não-wrapped

**Evidência**: L102-165 — se `hooks.onPreToolUse` é undefined, o wrapped não tem esse campo. Mas o
spread `{...hooks, ...wrapped}` preserva os campos originais. OK, sem bug real. **Resolução**: Falso
positivo — o spread merge resolve corretamente.

### ARCH-HOOK-002 · P4 — Barrel bypass: logger import direto

**Evidência**: L14 `import { log } from '#copilot/observability/logger'`

### GAP-HOOK-001 · P3 — `emitHook` swallows erros de listeners silenciosamente

**Evidência**: L78-82 catch genérico loga WARN mas não re-emite **Impacto**: Erros em listeners de
bus são invisíveis para error tracking global. Pode mascarar bugs em observadores.

### UPG-HOOK-002 · P4 — `defaultBus` não tem lifecycle (no dispose/removeAllListeners)

**Evidência**: Singleton criado em module scope sem cleanup **Impacto**: Em hot-reload ou testes,
listeners acumulam. Mitigado por `setMaxListeners(50)`.

## Pontuação de Saúde

| Dimensão                  | Score      |
| ------------------------- | ---------- |
| Correção lógica           | 9/10       |
| Segurança                 | 10/10      |
| Performance               | 9/10       |
| Manutenibilidade          | 8/10       |
| Cobertura de testes       | 6/10       |
| Conformidade arquitetural | 7/10       |
| **Média ponderada**       | **8.2/10** |
