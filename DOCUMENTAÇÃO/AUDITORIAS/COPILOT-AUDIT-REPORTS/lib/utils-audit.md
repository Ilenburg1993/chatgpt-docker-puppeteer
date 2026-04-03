# utils.js — Auditoria

**Módulo**: `src/copilot/lib/` **Arquivo**: `utils.js` **LOC**: 37 | **Score**: 10/10

## Responsabilidade

`pickDefined(obj: T): Partial<T>` — remove propriedades `undefined` de um `Record` antes de passá-lo
para APIs que seguem `exactOptionalPropertyTypes`.

## Achados

Nenhum.

## Destaques Positivos

- Genérico com constraint `extends Record<string, unknown>` — tipagem correta
- Uso canônico para evitar violações de `exactOptionalPropertyTypes`
- Sem mutação: retorna novo objeto via `Object.fromEntries`

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
