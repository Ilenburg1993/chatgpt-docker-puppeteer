# types/index.js — Auditoria

**Módulo**: `src/copilot/types/` **Arquivo**: `index.js` **LOC**: 23 | **Score**: 9.5/10

## Responsabilidade

Barrel de re-exportação para os tipos do protocolo LLM-A ↔ LLM-B. Exporta de
`structured-message.js`:

- `PRIORITY_LEVELS`, `RESPONSE_TYPES` — constantes de enum
- `StructuredMessageSchema` — schema Zod
- `buildStructuredRequest`, `buildStructuredResponse`, `isStructuredMessage`,
  `parseStructuredResponse`, `serializeStructuredMessage` — funções

Nota: também re-exportado via `core/index.js`, tornando tudo acessível via `#copilot/core`.

## Achados

Nenhum.

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
