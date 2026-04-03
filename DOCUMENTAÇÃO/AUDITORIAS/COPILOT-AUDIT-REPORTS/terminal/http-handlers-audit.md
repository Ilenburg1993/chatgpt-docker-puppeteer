# Auditoria — `http-handlers.js`

**Módulo**: `src/copilot/terminal/http-handlers.js` **LOC**: 48 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Arquivo barrel que re-exporta todos os handlers HTTP dos três módulos de handlers: `handlers-agent`,
`handlers-dialog` e `handlers-system`. Ponto único de importação para `route-table.js`.

---

## 2. Exports

| Origem               | Exports re-exportados                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handlers-agent.js`  | `handleGetContext`, `handlePipeline`, `handleInject`, `handleDialogPause`, `handleDialogResume`                                                                                                                                                                                                                                                                                                                                 |
| `handlers-dialog.js` | `handleListSessions`, `handleListTurns`, `handleStoreMemory`, `handleRecallMemories`, `handleDeleteMemory`, `handleHubHealth`                                                                                                                                                                                                                                                                                                   |
| `handlers-system.js` | `handleHealth`, `handleGetConfig`, `handleSetConfig`, `handleGetSkills`, `handleSetSkills`, `handleGetToolsConfig`, `handleSetToolsConfig`, `handleGetCustomTools`, `handleRegisterCustomTool`, `handleDeleteCustomTool`, `handleMetrics`, `handleGhIssues`, `handleGhPrs`, `handleGhCi`, `handleGitStatus`, `handleGitLog`, `handleGetQuota`, `getSseClientSets`, `getInfiniteSessionConfig`, `handleSetInfiniteSessionConfig` |

---

## 3. Achados

### FINDING-P5-1 — Barrel carrega todos os 3 módulos em qualquer import

**Severidade**: P5 — Cosmético

Qualquer arquivo que importa apenas um handler (e.g., `handleHealth`) via `http-handlers.js` força o
carregamento de todos os 3 módulos de handlers. Com ESM e lazy evaluation, esse custo ocorre uma vez
no startup. Para o uso em `route-table.js` (que precisa de todos os handlers), o barrel é correto.

---

## 4. Pontos positivos

- Ponto único de importação para `route-table.js` — sem spaghetti de imports diretos.
- Estrutura simples e previsível.
- Sem lógica de negócio — puramente estrutural.

---

## 5. Score

| Dimensão    | Nota       |
| ----------- | ---------- |
| Organização | 9/10       |
| **Global**  | **9.0/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
