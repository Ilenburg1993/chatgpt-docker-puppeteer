# tools/state.js — Auditoria

**Módulo**: `src/copilot/config/tools/` **Arquivo**: `tools/state.js` **LOC**: 99 | **Score**:
8.5/10

## Responsabilidade

Estado compartilhado de allow/denylist de ferramentas. Persiste em `tools-config.json`. API:
`loadToolsConfig`, `getToolsConfig`, `patchToolsConfig`.

## ACHADO C12-08 — P5

**`persistToolsConfig` usa `writeFileSync` não-atômico**

Mesmo risco de C12-04 (registry.js). Crash durante write pode corromper `tools-config.json`. Em caso
de corrupção, o try/catch na inicialização ignora silenciosamente o erro e mantém defaults em
memória — o que evita crash mas apaga configuração customizada.

## Destaques Positivos

- `getToolsConfig()` retorna cópia defensiva (spread) — sem mutação acidental do estado interno
- `patchToolsConfig` com `'allowlist' in updates` check — distingue `undefined` de `null`
  corretamente
- `loadToolsConfig` valida schema antes de aplicar (tipo, Array.isArray) — robusto para arquivos
  corrompidos
- `_toolsConfig` module-level isolado — sem exports diretos do estado mutável

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
