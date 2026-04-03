# permissions.js — Auditoria

**Módulo**: `src/copilot/lib/` **Arquivo**: `permissions.js` **LOC**: 17 | **Score**: 9.0/10

## Responsabilidade

`@deprecated` re-export shim que redireciona para `#copilot/hooks/permission`. Mantido por backward
compat — Fase N.4 do HOOKS-SYSTEM-ANALYSIS-ROADMAP.

## Achados

### C13-D02 — P5

Mesma situação de `hooks.js`: deprecado sem data de remoção. `lib/index.js` importa diretamente de
`#copilot/hooks/permission`, não deste shim.

## Destaques Positivos

- `@deprecated` no JSDoc bem documentado com destino canônico
- Shim transparente — zero consequência para callers via `lib/index.js`

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
