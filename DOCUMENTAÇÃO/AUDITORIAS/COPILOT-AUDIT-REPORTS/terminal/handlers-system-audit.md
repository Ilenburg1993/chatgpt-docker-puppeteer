# Auditoria — `handlers-system.js`

**Módulo**: `src/copilot/terminal/handlers-system.js` **LOC**: 484 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Handlers para endpoints de sistema do terminal HTTP LLM-B: health, configuração, métricas
Prometheus, git, gh CLI, skills, tools config, custom tools e quota.

---

## 2. Endpoints mapeados

| Handler                    | Endpoint                            | Observação                                                |
| -------------------------- | ----------------------------------- | --------------------------------------------------------- |
| `handleHealth`             | `GET /health`                       | Inclui hub, contextWindow, cacheStats, uptime             |
| `handleGetConfig`          | `GET /config`                       | model, effort, planMode, contextWindow, infinite session  |
| `handleSetConfig`          | `PUT /config`                       | Proxy para alwaysAliveAgent setters (model, effort, etc.) |
| `handleGetSkills`          | `GET /config/skills`                | Lê `skills.json` root do workspace                        |
| `handleSetSkills`          | `PUT /config/skills`                | Escreve `skills.json`                                     |
| `handleGetToolsConfig`     | `GET /config/tools`                 | allowlist / denylist runtime                              |
| `handleSetToolsConfig`     | `PUT /config/tools`                 | Atualiza allowlist / denylist                             |
| `handleGetCustomTools`     | `GET /config/tools/custom`          | BUILTIN_HANDLER_MAP                                       |
| `handleRegisterCustomTool` | `POST /config/tools/custom`         | Adiciona handler                                          |
| `handleDeleteCustomTool`   | `DELETE /config/tools/custom/:name` | Remove handler                                            |
| `handleMetrics`            | `GET /metrics`                      | Prometheus text format                                    |
| `handleGhIssues/Prs/Ci`    | `GET /gh/*`                         | gh CLI bridge                                             |
| `handleGitStatus/Log`      | `GET /git/*`                        | git bridge                                                |
| `handleGetQuota`           | `GET /quota`                        | send count + last PR cost                                 |

---

## 3. Achados

### FINDING-P4-1 — `readSkillsConfig` / `writeSkillsConfig` usam sync I/O **[FIXED]**

**Severidade**: P4 — Médio **→ CORRIGIDO** (2026-06-XX) **Localização**: `readSkillsConfig()` e
`writeSkillsConfig()` linhas ~168-190

**Fix aplicado**: convertidas para `async function` usando `readFile`/`writeFile` de
`node:fs/promises`. Handlers `handleGetSkills`/`handleSetSkills` tornados `async` com
`@returns {Promise<HandlerResult>}`. Rotas correspondentes em `route-table.js` marcadas com
`async: true`. `cmdSkills` em `commands/skills.js` convertsão para `async` com `await`.

```js
function readSkillsConfig() {
  try {
    return JSON.parse(readFileSync(SKILLS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}
function writeSkillsConfig(data) {
  writeFileSync(SKILLS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}
```

`readFileSync` e `writeFileSync` bloqueiam o event loop. Para o padrão do server (`async/await` em
todos os handlers), esta é uma inconsistência. Em uso normal (chamada ocasional do dashboard), o
impacto é negligível, mas bloqueia qualquer outro request incoming durante a escrita.

**Proposta** (async):

```js
async function readSkillsConfig() {
  try {
    return JSON.parse(await readFile(SKILLS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}
async function writeSkillsConfig(data) {
  await writeFile(SKILLS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}
```

---

### FINDING-P4-2 — `_infiniteSessionConfig` não é persistido entre restarts

**Severidade**: P4 — Médio **Localização**: `_infiniteSessionConfig`, linhas ~65-70

```js
let _infiniteSessionConfig = { backgroundCompactionThreshold: 0.75 };
```

Configurado via `PUT /config/infinite-session` pelo usuário mas redefinido em cada reinicialização.
Isso contrasta com `skills.json` que é persisted. O usuário que definiu `threshold: 0.6` perde a
configuração no próximo restart.

**Proposta**: persistir em `skills.json` ou em um `config/terminal-state.json` no workspace root. Na
inicialização, ler o valor salvo; no `handleSetInfiniteSessionConfig`, escrever o arquivo.

---

### FINDING-P5-3 — `handleHealth`: chamada a DB (`listHubSessions`) em cada health check

**Severidade**: P5 — Baixo **Localização**: `handleHealth()` linhas ~175-190

```js
const hubInfo = await conversationStore
  .listHubSessions({ status: 'active', limit: 10 })
  .then((sessions) => ({ activeSessions: sessions.length }))
  .catch(() => null);
```

`GET /health` pode ser chamado a cada poucos segundos por health probes. Embora só busque 10
registros, é uma query DB em toda chamada. Para p95 de latência, um cache TTL de 5s seria mais
adequado.

---

### FINDING-P5-4 — `gh` e `git` handlers: output não sanitizado passado diretamente ao caller

**Severidade**: P5 — Cosmético **Localização**: `handleGitStatus()`, `handleGhIssues()`, etc.,
linhas ~390-450

O output dos CLIs `gh` e `git` é retornado diretamente como string. Se o repositório tiver dados
mal-formados ou ANSI escape codes, eles serão enviados para o dashboard. Para exibição em HTML, o
caller deve fazer escape. Como é retornado como JSON string, o cliente é responsável.

---

## 4. Pontos positivos

- **handleMetrics**: Prometheus format com métricas bem escolhidas (contextUsage, tokenLimit,
  queueSize, sendCount, sseClients).
- **handleGetConfig**: expõe `contextWindow` com `{tokens, limit, pct}` — bom para dashboarding.
- **handleDeleteCustomTool**: valida que tool existe antes de deletar (evita erros silenciosos).
- **handleSetInfiniteSessionConfig**: validação estrita `0.1 ≤ threshold ≤ 1.0`.
- `getSseClientSets()`: exposta como API — não expõe o Set diretamente, retorna wrapper.

---

## 5. Score

| Dimensão                | Nota       |
| ----------------------- | ---------- |
| Completude de endpoints | 9/10       |
| Correção lógica         | 8/10       |
| Async/performance       | 7.0/10     |
| **Global**              | **8.0/10** |

---

## 6. Status de Correção

### [FIXED] FINDING P5 (T-30) — `handleHealth`: scan O(n) substituído por `countHubSessions`

`handleHealth()` em vez de `listHubSessions({ status: 'active' })` (scan com `Array.length`), agora
chama `conversationStore.countHubSessions({ status: 'active' })` que executa `COUNT(*)` via índice
SQLite. Eliminado full table scan desnecessário no hot-path de health check.

**Pontuação atualizada: 8.5/10**

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
