# hooks.js — Auditoria

**Módulo**: `src/copilot/lib/` **Arquivo**: `hooks.js` **LOC**: 19 | **Score**: 9.0/10

## Responsabilidade

`@deprecated` re-export shim que redireciona para `#copilot/hooks/factory`. Mantido por backward
compat — Fase N.3 do HOOKS-SYSTEM-ANALYSIS-ROADMAP.

## Achados

### C13-D01 — P5

Módulo marcado como `@deprecated` mas sem data de remoção agendada no código. `lib/index.js` não
importa deste arquivo (importa diretamente de `#copilot/hooks/factory`), portanto o shim só é
carregado se alguém importar `lib/hooks.js` diretamente.

## Destaques Positivos

- JSDoc com `@deprecated` visível, instruindo migrar para `#copilot/hooks/factory`
- Não adiciona runtime overhead para callers via `lib/index.js`

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
