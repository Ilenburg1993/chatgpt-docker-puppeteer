# Auditoria — `gh-bridge.js`

**Módulo**: `src/copilot/bridges/gh-bridge.js` **LOC**: 42 **Data**: 2026-06-10 **Auditor**: Copilot
Full-Audit MF-II

---

## 1. Propósito

Barrel de compatibilidade retroativa para o módulo `gh/`. Toda a implementação real foi migrada para
`./gh/index.js` (módulo dividido em subpastas por domínio). Este arquivo re-exporta todas as funções
para manter o import path `./gh-bridge.js` funcionando sem alteração nos callers.

---

## 2. Exports re-exportados

| Grupo    | Funções                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Issues   | `createIssue`, `closeIssue`, `commentIssue`, `listIssues`, `viewIssue`, `searchIssues`                                                  |
| PRs      | `listPrs`, `viewPr`, `mergePr`, `diffPr`                                                                                                |
| CI/Runs  | `listRuns`, `viewRun`, `rerunRun`, `cancelRun`, `watchRun`, `getStatus`                                                                 |
| Releases | `listReleases`, `viewRelease`                                                                                                           |
| Utils    | `rawApi`, `searchCode`, `fmtDate`, `formatIssueList`, `formatPrList`, `formatReleaseList`, `formatRunList`, `getDefaultRepo`, `runIcon` |

---

## 3. Achados

Nenhum achado. Arquivo de compatibilidade puro — sem lógica de negócio.

---

## 4. Pontos positivos

- Mantém backward-compat sem copiar código.
- Comentário explícito `@see module:copilot/bridges/gh` direciona para a implementação real.

---

## 5. Score

| Dimensão   | Nota        |
| ---------- | ----------- |
| Correção   | 10/10       |
| **Global** | **10.0/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
