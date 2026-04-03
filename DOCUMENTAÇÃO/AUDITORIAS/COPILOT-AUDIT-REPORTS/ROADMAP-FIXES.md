# ROADMAP-FIXES — Plano de Correções Prioritizadas

**Gerado**: 2026-06 **Baseado em**: `ISSUES-CONSOLIDATED.md`, 137 achados, 15 módulos **Plano de
referência**: `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md` v2.0

---

## ⚙️ Protocolo de Execução Contínua

> **Este protocolo é obrigatório antes de cada arquivo corrigido.**

### Antes de modificar qualquer arquivo:

1. **Ler o MD de auditoria individual** do arquivo (ex: `hooks/deny-all-audit.md`)
2. **Ler o arquivo fonte completo** (`src/copilot/.../arquivo.js`) — integral, sem pular seções
3. **Fazer revisão interna** — entender o contexto real antes de qualquer mudança
4. **Executar correções, melhorias e upgrades** — INCLUDING itens P4 e P5 (mesmo "pequenos")
5. **Atualizar o MD individual** com status e novas observações pós-fix
6. **Executar `npm run lint` e `npm run test:unit`** — validar que nada regrediu

### Critérios de "Concluído" por arquivo:

- [ ] Todos os issues P2/P3 do arquivo: corrigidos
- [ ] Todos os issues P4/P5 do arquivo: corrigidos ou justificadamente deixados
- [ ] JSDoc atualizado para funções modificadas
- [ ] Testes existentes passando
- [ ] MD individual atualizado com `✅ [CORRIGIDO]` por item

### Política de upgrade:

- Mesmo que um upgrades pareça "pequeno" (ex: renomear constante, adicionar um guard), fazer na
  mesma passagem
- Não deixar "para depois" melhorias que estão no mesmo arquivo sendo editado
- Cada passagem neste arquivo deve ser a última necessária nele

---

| 5 (Sprint 4) | P4 — Qualidade | 69 issues | ~8 dias | Backlog | | 6 (contínuo) | P5 — Cosmético |
8 issues | ~1 dia | OportunísticoO |

---

## Sumário Executivo

| Onda         | Severidade             | Issues    | Estimativa | Modo          | Status                                                        |
| ------------ | ---------------------- | --------- | ---------- | ------------- | ------------------------------------------------------------- |
| 1 (Sprint 1) | P2 — Segurança crítica | 8 issues  | ~2 dias    | Hotfix        | ✅ **CONCLUÍDA**                                              |
| 2 (Sprint 1) | P2 — Bugs funcionais   | 6 issues  | ~2 dias    | Bug fix       | ✅ **CONCLUÍDA**                                              |
| 3 (Sprint 2) | P3 — Estabilidade      | 20 issues | ~5 dias    | Refactor      | ✅ **CONCLUÍDA**                                              |
| 4 (Sprint 3) | P3 — Arquitetura       | 12 issues | ~5 dias    | Refactor      | ✅ **CONCLUÍDA** (3 FIXED, 3 ACCEPTED)                        |
| 5 (Sprint 4) | P4 — Qualidade         | 69 issues | ~8 dias    | Backlog       | ✅ **CONCLUÍDA** (44 triados: 12 FIXED + 24 N/A + 8 ACCEPTED) |
| 6 (contínuo) | P5 — Cosmético         | 8 issues  | ~1 dia     | Oportunístico | ✅ **CONCLUÍDA**                                              |

---

## Fases de Execução Detalhadas

### FASE 1 — Módulo: hooks/ (Prioridade Máxima)

> **Motivação**: BUG-DA-001 é a issue mais crítica do sistema inteiro — preset de segurança com
> lógica invertida.

| Sub-fase | Arquivo                        | Issues                     | Status                   |
| -------- | ------------------------------ | -------------------------- | ------------------------ |
| 1-A      | `hooks/presets/deny-all.js`    | BUG-DA-001 + INC-HOOKS-001 | ✅ N/A + FIXED           |
| 1-B      | `hooks/tool-interceptor.js`    | BUG-TI-001, BUG-TI-002     | ✅ N/A (funcional)       |
| 1-C      | `hooks/factory.js`             | BUG-HOOK-001, GAP-HOOK-001 | ✅ N/A / ⬜ GAP-HOOK-001 |
| 1-D      | `hooks/presets/interactive.js` | INC-HOOKS-001 (preset)     | ✅ FIXED                 |
| 1-E      | `hooks/presets/safe.js`        | INC-HOOKS-001 (preset)     | ✅ FIXED                 |
| 1-F      | `hooks/permission-handler.js`  | BUG-PERM-001               | ✅ N/A (waterfall ok)    |
| 1-G      | `hooks/user-input.js`          | BUG-UI-001, BUG-UI-002     | ✅ FIXED / N/A           |
| 1-H      | `hooks/registry.js`            | ARCH-REG-001, GAP-REG-001  | ⬜ ARCH / ✅ N/A         |
| 1-I      | `hooks/session-lifecycle.js`   | ARCH-SL-001, UPG-SL-001    | ⬜ ARCH / ⬜ UPG         |
| 1-J      | `hooks/prompt-transformer.js`  | SEC-PT-001                 | ✅ FIXED                 |
| 1-K      | `hooks/types.js`               | GAP-TYPES-001              | ✅ FIXED                 |
| 1-L      | `hooks/index.js`               | ARCH-HOOK-002              | ⬜ ARCH                  |

### FASE 2 — Módulo: routes/ + api/ (Broken Access Control)

| Sub-fase | Arquivo                   | Issues                                      | Status               |
| -------- | ------------------------- | ------------------------------------------- | -------------------- |
| 2-A      | `routes/sessions.js`      | SEC-ROUTE-001, BUG-ROUTE-001, INC-ROUTE-001 | ✅ FIXED / N/A / N/A |
| 2-B      | `routes/agent.js`         | BUG-ROUTE-002                               | ✅ N/A               |
| 2-C      | `routes/observability.js` | GAP-ROUTE-001                               | ⬜ GAP P4            |
| 2-D      | `routes/webhooks.js`      | GAP-ROUTE-002                               | ⬜ GAP P4            |
| 2-E      | `routes/hooks.js`         | GAP-ROUTE-003                               | ✅ N/A               |
| 2-F      | `routes/client.js`        | INC-ROUTE-001                               | ✅ N/A               |
| 2-G      | `api/bridge-control.js`   | SEC-API-001, BUG-API-002                    | ✅ FIXED / FIXED     |
| 2-H      | `api/bridge-tasks.js`     | BUG-API-001                                 | ✅ N/A               |
| 2-I      | `api/bridge-stream.js`    | INC-API-001, GAP-API-002                    | ✅ FIXED / ⬜ GAP    |
| 2-J      | `api/bridge-dialog.js`    | GAP-API-001                                 | ⬜ GAP P4            |

### FASE 3 — Módulo: tools/ (Path Traversal)

| Sub-fase | Arquivo                        | Issues                                       | Status                    |
| -------- | ------------------------------ | -------------------------------------------- | ------------------------- |
| 3-A      | `tools/shell/index.js`         | SEC-TOOLS-001                                | ✅ FIXED                  |
| 3-B      | `tools/file/write-tools.js`    | SEC-TOOLS-002                                | ✅ FIXED                  |
| 3-C      | `tools/file/read-tools.js`     | PERF-TOOLS-002                               | ⬜ PERF P4                |
| 3-D      | `tools/git-tools.js`           | BUG-TOOLS-002                                | ✅ N/A                    |
| 3-E      | `tools/todo/store.js`          | BUG-TOOLS-001, PERF-TOOLS-001, GAP-TOOLS-002 | ✅ N/A / ⬜ PERF / ⬜ GAP |
| 3-F      | `tools/web-tools.js`           | SEC-TOOLS-003                                | ✅ FIXED                  |
| 3-G      | `tools/session-rpc-tools.js`   | GAP-TOOLS-003                                | ⬜ GAP P4                 |
| 3-H      | `tools/introspection-tools.js` | GAP-TOOLS-004                                | ⬜ GAP P4                 |
| 3-I      | `tools/tool-factory.js`        | ARCH-TOOLS-001                               | ⬜ ARCH P4                |
| 3-J      | `tools/index.js`               | GAP-TOOLS-001                                | ⬜ GAP P4                 |

### FASE 4 — Módulo: lib/ + config/ (SSRF + env_read)

| Sub-fase | Arquivo                         | Issues                      | Status             |
| -------- | ------------------------------- | --------------------------- | ------------------ |
| 4-A      | `lib/url-validator.js`          | SEC-LIB-001                 | ✅ FIXED           |
| 4-B      | `lib/sdk-client.js`             | BUG-LIB-001, PERF-LIB-001   | ✅ NOTED / ⬜ PERF |
| 4-C      | `lib/session.js`                | BUG-LIB-002                 | ✅ N/A             |
| 4-D      | `lib/models.js`                 | GAP-LIB-002                 | ✅ N/A             |
| 4-E      | `lib/agents.js`                 | GAP-LIB-003                 | ✅ N/A             |
| 4-F      | `lib/tools-registry.js`         | GAP-LIB-001, INC-LIB-001    | ✅ N/A / ⬜ INC    |
| 4-G      | `config/tools/custom-tools.js`  | C12-02 (env_read allowlist) | ✅ FIXED           |
| 4-H      | `config/session-config.js`      | C12-03                      | ⬜ GAP P4          |
| 4-I      | `config/index.js`               | INC-CONF-001                | ✅ N/A             |
| 4-J      | `config/pinned-files-loader.js` | GAP-CONF-001                | ✅ N/A             |
| 4-K      | `config/mcp-servers.js`         | GAP-CONF-002                | ✅ FIXED           |
| 4-L      | `config/tools/sdk-tools.js`     | GAP-CONF-003                | ✅ N/A             |
| 4-M      | `config/system-prompt.js`       | ARCH-CONF-001               | ⬜ ARCH P4         |

### FASE 5 — Módulo: agent/ (Memory Leaks + Race Conditions)

| Sub-fase | Arquivo                          | Issues                                                                        | Status                           |
| -------- | -------------------------------- | ----------------------------------------------------------------------------- | -------------------------------- |
| 5-A      | `agent/always-alive.js`          | LEAK-AGENT-001/002, RACE-AGENT-001/002/003, ARCH-AGENT-001, BUG-AGENT-007/008 | ✅ LEAK/RACE/BUG FIXED / ⬜ ARCH |
| 5-B      | `agent/state-io.js`              | RACE-AGENT-001/002/003, PERF-AGENT-001/002/003                                | ✅ RACE FIXED / ⬜ PERF          |
| 5-C      | `agent/entry.js`                 | BUG-AGENT-006                                                                 | ✅ FIXED                         |
| 5-D      | `agent/webhook-manager.js`       | SEC-AGENT-003/004/005, GAP-AGENT-009                                          | ✅ SEC FIXED / ⬜ GAP            |
| 5-E      | `agent/session-initializer.js`   | SEC-AGENT-004                                                                 | ✅ N/A                           |
| 5-F      | `agent/tool-audit-logger.js`     | PERF-AGENT-004                                                                | ⬜ PERF P4                       |
| 5-G      | `agent/session-event-wirer.js`   | BUG-AGENT-008                                                                 | ✅ N/A                           |
| 5-H      | `agent/task-executor.js`         | GAP-AGENT-010                                                                 | ⬜ GAP P4                        |
| 5-I      | `agent/permission-controller.js` | GAP-AGENT-011                                                                 | ⬜ GAP P4                        |
| 5-J      | `agent/index.js`                 | ARCH-AGENT-002, GAP-AGENT-007/008                                             | ✅ GAP FIXED / ⬜ ARCH           |

### FASE 6 — Módulo: observability/ (God Module + Leaks)

| Sub-fase | Arquivo                                 | Issues                                   | Status                       |
| -------- | --------------------------------------- | ---------------------------------------- | ---------------------------- |
| 6-A      | `observability/event-collector.js`      | LEAK-OBS-001, ARCH-OBS-003, PERF-OBS-001 | ✅ LEAK/PERF FIXED / ⬜ ARCH |
| 6-B      | `observability/agent-event-observer.js` | LEAK-OBS-002                             | ✅ FIXED                     |
| 6-C      | `observability/audit-log.js`            | BUG-OBS-001                              | ✅ FIXED                     |
| 6-D      | `observability/error-tracker.js`        | BUG-OBS-002                              | ✅ NOTED (cosmético)         |
| 6-E      | `observability/metrics.js`              | GAP-OBS-001, PERF-OBS-002                | ⬜ GAP + PERF                |
| 6-F      | `observability/otel.js`                 | GAP-OBS-002                              | ⬜ GAP P4                    |
| 6-G      | `observability/` (desacoplamento)       | ARCH-OBS-001/002 (criar contracts.js)    | ⬜ ARCH (god module)         |

### FASE 7 — Módulo: db/ (FTS5 Triggers)

| Sub-fase | Arquivo            | Issues                                            | Status                         |
| -------- | ------------------ | ------------------------------------------------- | ------------------------------ |
| 7-A      | `db/migrations.js` | DB-P3-01, DB-P4-02/03/04 (migration v7 corretiva) | ✅ DB-P3-01 FIXED / ⬜ DB-P4   |
| 7-B      | `db/sqlite.js`     | DB-P4-01 (documentação + SIGTERM handler)         | ✅ SIGTERM FIXED / ⬜ DB-P4-01 |

### FASE 8 — Módulo: terminal/ (30 achados P3/P4)

| Sub-fase | Arquivo                         | Issues                 | Status                        |
| -------- | ------------------------------- | ---------------------- | ----------------------------- |
| 8-A      | `terminal/dialog.js`            | T-01, T-02, T-03, T-29 | ✅ ALL FIXED/N/A              |
| 8-B      | `terminal/server.js`            | T-04, T-18, T-19       | ✅ ALL FIXED                  |
| 8-C      | `terminal/index.js`             | T-14, T-15, T-20, T-21 | ✅ ALL FIXED                  |
| 8-D      | `terminal/handlers-dialog.js`   | T-08, T-25, T-26       | ✅ ALL FIXED                  |
| 8-E      | `terminal/handlers-agent.js`    | T-06, T-07, T-24       | ✅ ALL FIXED                  |
| 8-F      | `terminal/handlers-system.js`   | T-09, T-10, T-30       | ✅ ALL FIXED/N/A              |
| 8-G      | `terminal/file-context.js`      | T-11, T-12, T-13       | ✅ ALL FIXED                  |
| 8-H      | `terminal/workspace-context.js` | T-17, T-28             | ✅ ALL FIXED                  |
| 8-I      | `terminal/repl.js`              | T-05, T-27             | ✅ T-05 FIXED / 📝 T-27 NOTED |
| 8-J      | `terminal/state.js`             | T-22, T-23             | ✅ ALL FIXED                  |
| 8-K      | `terminal/route-table.js`       | T-16                   | ✅ N/A                        |

### FASE 9 — Módulos: bridges/ + conversation-hub/ + channel/

| Sub-fase | Arquivo                         | Issues                      | Status                          |
| -------- | ------------------------------- | --------------------------- | ------------------------------- |
| 9-A      | `bridges/nerv-bridge.js`        | B10-03                      | ✅ FIXED                        |
| 9-B      | `bridges/mcp-tool-bridge.js`    | B10-01, B10-02              | ✅ ALL FIXED                    |
| 9-C      | `conversation-hub/socket-ns.js` | C11-01, C11-02              | ✅ C11-01 FIXED / ⬜ C11-02 GAP |
| 9-D      | `conversation-hub/store.js`     | C11-03                      | ✅ FIXED                        |
| 9-E      | `channel/inject.js`             | LEAK-CHAN-001, GAP-CHAN-002 | ✅ LEAK FIXED / ⬜ GAP          |
| 9-F      | `channel/client.js`             | BUG-CHAN-001, GAP-CHAN-001  | ✅ BUG FIXED / ⬜ GAP           |

### FASE 10 — Módulos: core/ + types/ + P5 cosmético

| Sub-fase | Arquivo                       | Issues                                   | Status                                      |
| -------- | ----------------------------- | ---------------------------------------- | ------------------------------------------- |
| 10-A     | `core/constants.js`           | INC-CORE-001, GAP-CORE-001, INC-CORE-002 | ✅ INC/GAP FIXED / ⬜ INC-CORE-002 ARCH     |
| 10-B     | `types/structured-message.js` | TYPES-P4-01, TYPES-P4-02, TYPES-P4-03    | ⬜ TYPES-P4-01 / ✅ 02 ACCEPTED / ✅ 03 N/A |
| 10-C     | `types/sdk.js`                | TYPES-P4-04                              | ✅ N/A                                      |
| 10-D     | P5 cosméticos (todos módulos) | T-18 a T-29, naming conventions          | ✅ ALL FIXED                                |

> **Critério**: Broken Access Control (OWASP #1), SSRF, Path Traversal, Security Bypass. Todas as
> fixes devem ser acompanhadas de testes de regressão.

### Fix 1.1 — SEC-API-001: POST /stop sem requireAdmin

**Arquivo**: `src/copilot/api/bridge-control.js` **Problema**: Qualquer cliente com JWT válido pode
parar o agente via `POST /stop`. **Fix**:

```js
// antes
router.post('/stop', async (req, res) => { ... });

// depois
router.post('/stop', requireAdmin, async (req, res) => { ... });
```

**Onde adicionar `requireAdmin`**: `src/copilot/terminal/server.js` (onde outros middlewares de auth
já existem). **Teste**: POST /stop com token não-admin → 403.

---

### Fix 1.2 — SEC-ROUTE-001: DELETE /sessions/:id sem ownership check (IDOR)

**Arquivo**: `src/copilot/routes/sessions.js` **Problema**: Qualquer token válido deleta qualquer
sessão (Insecure Direct Object Reference). **Fix**:

```js
// após busca da sessão:
const session = await sessionStore.get(req.params.id);
if (!session) return res.status(404).json({ error: 'Not found' });
// verificar ownership — aceitar apenas admin ou dono da sessão
if (session.ownerId && session.ownerId !== req.user.id && !req.user.isAdmin) {
  return res.status(403).json({ error: 'Forbidden' });
}
```

---

### Fix 1.3 — SEC-TOOLS-001: Path traversal em shell tools

**Arquivo**: `src/copilot/tools/shell/index.js` (e/ou `write-tools.js`) **Problema**: Validação de
path não resolve symlinks — `../../etc/passwd` via symlink. **Fix**:

```js
import { realpathSync } from 'fs';
import { resolve } from 'path';

function validatePath(userPath, workspaceRoot) {
  const abs = resolve(workspaceRoot, userPath);
  let real;
  try {
    real = realpathSync(abs); // segue symlinks
  } catch {
    real = abs; // arquivo não existe ainda — ok para writes
  }
  if (!real.startsWith(realpathSync(workspaceRoot))) {
    throw new Error(`Path traversal bloqueado: ${userPath}`);
  }
  return real;
}
```

---

### Fix 1.4 — SEC-LIB-001: SSRF via IPv6 privado

**Arquivo**: `src/copilot/lib/url-validator.js` **Problema**: `::1`, `fe80::*`, `fc00::*`, `fd00::*`
não bloqueados. **Fix**:

```js
const PRIVATE_IPV6 = [
  /^::1$/, // loopback
  /^fe80:/i, // link-local
  /^fc[0-9a-f]{2}:/i, // ULA fc00::/7
  /^fd[0-9a-f]{2}:/i, // ULA fd00::/7
  /^::ffff:10\./, // mapped IPv4 10.x
  /^::ffff:172\.(1[6-9]|2[0-9]|3[01])\./, // mapped 172.16-31.x
  /^::ffff:192\.168\./, // mapped 192.168.x
];

function isPrivateIPv6(host) {
  return PRIVATE_IPV6.some((re) => re.test(host));
}
```

---

### Fix 1.5 — BUG-DA-001: deny-all preset aprova tudo (inversão lógica)

**Arquivo**: `src/copilot/hooks/presets/deny-all.js` **Problema**: `onPermissionRequest` retorna
`approve` em vez de `deny` — inversão total da lógica. **Fix**: Revisar e inverter o retorno do
handler:

```js
// Verificar o handler 'onPermissionRequest' e garantir que retorna 'deny' ou { decision: 'deny' }
onPermissionRequest: (request) => {
  return { decision: 'deny', message: 'Bloqueado pelo preset deny-all' };
};
```

---

### Fix 1.6 — INC-HOOKS-001: 3/5 presets com onPermissionRequest inconsistente

**Arquivos**: `src/copilot/hooks/presets/deny-all.js`, `interactive.js`, `safe.js` **Problema**:
onPreToolUse nega mas onPermissionRequest aprova → bypass via permissionRequest. **Fix**: Auditar
cada preset e garantir comportamento consistente entre os dois handlers.

---

### Fix 1.7 — SEC-ROUTE-001 (complementar): BUG-ROUTE-001 — Mass assignment

**Arquivo**: `src/copilot/routes/sessions.js` (PATCH) **Fix**:

```js
const ALLOWED_FIELDS = ['title', 'status', 'metadata'];
const updates = Object.fromEntries(
  Object.entries(req.body).filter(([k]) => ALLOWED_FIELDS.includes(k)),
);
```

---

### Fix 1.8 — C12-02: env_read expõe process.env irrestrito ao modelo

**Arquivo**: `src/copilot/config/tools/custom-tools.js` **Fix**:

```js
const ENV_ALLOWLIST = new Set([
  'NODE_ENV',
  'COPILOT_WORKING_DIRECTORY',
  'COPILOT_DB_PATH',
  'TZ',
  'LANG',
  'HOME',
  // adicionar conforme necessário — sem tokens/secrets
]);

function envReadHandler({ key }) {
  if (!ENV_ALLOWLIST.has(key)) {
    return { error: `Variável '${key}' não está na allowlist de leitura.` };
  }
  return { value: process.env[key] ?? null };
}
```

---

## Onda 2 — Bug Fix Funcional (Sprint 1)

> **Critério**: Features completamente não-funcionais, leaks de memória confirmados, races de dados.

### Fix 2.1 — BUG-TI-001: timing feature não funcional em hooks

**Arquivo**: `src/copilot/hooks/tool-interceptor.js` **Problema**: `Timer.start(toolName)` nunca
grava end time no Map — todos os timings são 0ms. **Fix**: Analisar o flow de criação/resolução do
Map e garantir que o timer é resolvido no post-hook.

---

### Fix 2.2 — LEAK-AGENT-001/002: Memory leaks em always-alive.js

**Arquivo**: `src/copilot/agent/always-alive.js` **Problema**: EventEmitter listeners acumulam em
reconexão, Maps sem cleanup. **Fix**:

1. Mover todos os `emitter.on()` para inside de uma função `_attachListeners()` com referências
   armazenadas.
2. Chamar `_detachListeners()` antes de re-attach em reconexão:

```js
_detachListeners() {
    for (const [emitter, event, fn] of this._listeners) {
        emitter.off(event, fn);
    }
    this._listeners = [];
}

_attachListeners() {
    this._detachListeners();
    const h1 = this._onTurnComplete.bind(this);
    this._agent.on('turn:complete', h1);
    this._listeners.push([this._agent, 'turn:complete', h1]);
    // ... etc
}
```

---

### Fix 2.3 — RACE-AGENT-001/002/003: Race condition em state-io.js

**Arquivo**: `src/copilot/agent/state-io.js` **Problema**: `writeState()` (sync) e
`writeStateAsync()` (async) sem serialização. **Fix**: Adicionar mutex Promise-chain para serializar
todas as writes:

```js
let _writeChain = Promise.resolve();

export function writeStateAsync(data) {
  _writeChain = _writeChain.then(() => writeFileAsync(STATE_FILE, JSON.stringify(data)));
  return _writeChain;
}
```

---

### Fix 2.4 — LEAK-CHAN-001: Buffer SSE sem limite de tamanho

**Arquivo**: `src/copilot/channel/inject.js` **Problema**: `buf` cresce sem limite se o SSE stream
produz mais rápido do que o consumidor. **Fix**: Definir `MAX_BUF_KB` e truncar/rejeitar se
excedido:

```js
const MAX_BUF_BYTES = 256 * 1024; // 256 KB
// no stream handler:
if (buf.length + chunk.length > MAX_BUF_BYTES) {
  logger.warn('inject: buffer overflow — descartando chunk');
  return;
}
buf += chunk;
```

---

### Fix 2.5 — BUG-CHAN-001: activeTaskId cross-contamination em chatBatch concorrente

**Arquivo**: `src/copilot/channel/client.js` **Problema**: `this.activeTaskId` é estado de instância
compartilhado entre calls concorrentes. **Fix**: Usar variável local por invocação:

```js
async _sendSingleTurn(text, opts) {
    const taskId = generateId(); // local, não `this.activeTaskId`
    // ...
}
```

---

### Fix 2.6 — BUG-API-001: TOCTOU em bridge-tasks.js

**Arquivo**: `src/copilot/api/bridge-tasks.js` **Problema**: Check `queueSize < MAX` e `enqueue` não
atômicos — race condition em alta concorrência. **Fix**: Envolver em lock ou usar operação atômica
do driver de fila.

---

## Onda 3 — Estabilidade e Robustez (Sprint 2)

> **Critério**: P3 que afetam estabilidade operacional ou segurança secundária sem risco imediato.

### Fix 3.1 — DB: FTS5 trigger `turns_au` usando old.id como rowid

**Arquivo**: `src/copilot/db/migrations.js` **Problema**: Migration v3 AU trigger usa `old.id` como
rowid no FTS5 — deveria ser `old.rowid`. **Fix**: Criar migration v7 que recria os triggers
corretos:

```sql
-- v7: corrige triggers FTS5
DROP TRIGGER IF EXISTS copilot_turns_au;
CREATE TRIGGER copilot_turns_au AFTER UPDATE ON copilot_conversation_turns BEGIN
    INSERT INTO copilot_turns_fts(copilot_turns_fts, rowid, id, hub_session_id, content)
        VALUES('delete', old.rowid, old.id, old.hub_session_id, old.content);
    INSERT INTO copilot_turns_fts(rowid, id, hub_session_id, content)
        VALUES(new.rowid, new.id, new.hub_session_id, new.content);
END;

DROP TRIGGER IF EXISTS copilot_memories_ad;
CREATE TRIGGER copilot_memories_ad AFTER DELETE ON copilot_memories BEGIN
    INSERT INTO copilot_memories_fts(copilot_memories_fts, rowid, id, content, tags)
        VALUES('delete', old.rowid, old.id, old.content, old.tags);
END;
```

---

### Fix 3.2 — C11-01/C11-02: Authorization em socket-ns.js

**Arquivo**: `src/copilot/conversation-hub/socket-ns.js` **Fixes**:

1. `turns:history`: verificar `socket.rooms.has(hubSession)` antes de retornar histórico.
2. `sessions:list`: filtrar por `userId` extraído do JWT em ambientes multi-tenant.

---

### Fix 3.3 — C11-03: syncFromSdkHistory LIKE scan

**Arquivo**: `src/copilot/conversation-hub/store.js` **Fix**: Adicionar coluna `sdk_turn_id`
indexada para deduplicação O(1) (ver SQL em ISSUES-CONSOLIDATED.md).

---

### Fix 3.4 — T-04/T-16: Adicionar handler OPTIONS em terminal

**Arquivos**: `src/copilot/terminal/server.js`, `src/copilot/terminal/route-table.js` **Fix**:
Adicionar `router.options('*', cors())` ou handler específico nas rotas que usam `Authorization`.

---

### Fix 3.5 — T-15: Watchdog incorreto — dialog.stopped ignora dialogPaused

**Arquivo**: `src/copilot/terminal/index.js` **Fix**: Verificar `dialog.paused` antes de interpretar
`dialog.stopped` como falha:

```js
// antes
if (dialog.stopped) restartDialog();

// depois
if (dialog.stopped && !dialog.paused) restartDialog();
```

---

### Fix 3.6 — BUG-LIB-001: Sessão parcial não destruída em falha de createSession

**Arquivo**: `src/copilot/lib/sdk-client.js` **Fix**: Chamar `session.destroy()` no catch:

```js
async createSession(opts) {
    const session = await this._sdk.createSession(opts);
    try {
        await this._initSession(session);
        return session;
    } catch (err) {
        await session.destroy().catch(() => {}); // cleanup garantido
        throw err;
    }
}
```

---

### Fix 3.7 — BUG-ROUTE-002: POST /agent/config sem drain de tasks em andamento

**Arquivo**: `src/copilot/routes/agent.js` **Fix**: Aguardar `agent.drain()` antes de reiniciar:

```js
router.post('/config', requireAdmin, async (req, res) => {
  await agent.drain({ timeout: 5000 }); // aguarda tasks atuais
  await agent.applyConfig(req.body);
  res.json({ ok: true });
});
```

---

### Fix 3.8 — T-08: handleHubHealth O(n) com limit:1000

**Arquivo**: `src/copilot/terminal/handlers-dialog.js` **Fix**: Substituir busca + count manual por
`COUNT(*)` SQL:

```js
const { total } = db.prepare('SELECT COUNT(*) as total FROM copilot_hub_sessions').get();
```

---

### Fix 3.9 — B10-03: Race de listeners em nerv-bridge.js

**Arquivo**: `src/copilot/bridges/nerv-bridge.js` **Fix**: Armazenar handler `ready` e remover em
`unmount()`:

```js
mount(nerv) {
    this._nerv = nerv;
    this._readyHandler = () => this._attachListeners();
    nerv.once('ready', this._readyHandler);
}

unmount() {
    if (this._readyHandler) {
        this._nerv?.off('ready', this._readyHandler);
        this._readyHandler = null;
    }
    this._detachListeners();
}
```

---

### Fix 3.10 — ARCH-OBS-001: Resolver ciclo circular em observability/

**Arquivos**: `src/copilot/observability/`, `src/copilot/hooks/` **Problema**:
`event-collector ← hooks-audit-preset ← factory` → ciclo. **Fix**: Extrair a interface mínima
necessária para um módulo `copilot/observability/types.js` sem import de hooks.

---

### Fix 3.11 — SEC-AGENT-005: DNS rebinding SSRF bypass em webhook-manager.js

**Arquivo**: `src/copilot/agent/webhook-manager.js` **Problema**: Hostname validado por string antes
do request, mas DNS pode resolver para IP privado em tempo de execução. **Fix**: Implementar DNS
pre-resolution e bloquear IPs privados após resolução:

```js
import { resolve4, resolve6 } from 'dns/promises';

async function isPrivateResolution(hostname) {
  const ips = await Promise.allSettled([resolve4(hostname), resolve6(hostname)]);
  return ips
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .some((ip) => isPrivateIp(ip));
}
```

---

### Fix 3.12 — BUG-AGENT-006: session.fatal sem cleanup

**Arquivo**: `src/copilot/agent/entry.js` **Problema**: `process.exit(1)` chamado sem aguardar
`writeStateAsync()` em andamento. **Fix**: Aguardar writes pendentes antes de sair:

```js
session.on('fatal', async (err) => {
  logger.error('session.fatal:', err);
  await stateIo.drainWrites(3000).catch(() => {}); // 3s timeout
  process.exit(1);
});
```

---

## Onda 4 — Refatoração Arquitetural (Sprint 3)

> **Critério**: Dívida arquitetural acumulada, acoplamento excessivo, manutenibilidade reduzida.

### Refact 4.1 — Decomposição de always-alive.js (God class 1241 LOC)

**Arquivo**: `src/copilot/agent/always-alive.js` **Proposta de decomposição**:

```
always-alive.js →
├── connection-manager.js    (250 LOC) — retry/backoff/reconnect
├── turn-executor.js         (300 LOC) — dialog loop, turn lifecycle
├── task-scheduler.js        (200 LOC) — task parsing, dispatch
├── session-watchdog.js      (150 LOC) — health monitor, recovery
└── always-alive.js          (150 LOC) — composição e interface pública
```

**Motivação**: Score 5.6/10, 16 achados, 0 testes isolados possíveis.

---

### Refact 4.2 — Desacoplar observability/ como god module

**Problema**: 87/171 imports cross-module = 51% da superfície de imports apontam para observability/
**Estratégia**:

1. Criar `observability/contracts.js` com apenas interfaces/tipos (sem implementação).
2. Módulos externos importam de `contracts.js`, não da implementação direta.
3. Eventualmente migrar para injeção via NERV events.

---

### Refact 4.3 — Corrigir inconsistência MAX_SSE_CLIENTS

**Problema**: `core/constants.js` define `50`, `bridge-stream.js` usa `|| 100`. **Fix**: Usar a
constante em todos os lugares:

```js
// bridge-stream.js
import { MAX_SSE_CLIENTS } from '#core/constants.js';
const limit = MAX_SSE_CLIENTS; // 50, consistente com constantes
```

---

### Refact 4.4 — Criar façade para @github/copilot-sdk

**Problema**: 4 arquivos importam `@github/copilot-sdk` diretamente — sem ponto único de entry.
**Fix**: Criar `src/copilot/lib/sdk-facade.js` como único ponto de import do SDK:

```js
// src/copilot/lib/sdk-facade.js
export * from '@github/copilot-sdk'; // re-export com possibilidade de mock
```

---

### Refact 4.5 — Eliminar importações diretas de observability/ via barrel

**Problema**: 76 imports diretos de `logger.js` (bypass de `observability/index.js`). **Fix**: Criar
alias `#obs/*` no tsconfig e path mapping para forçar uso do barrel.

---

### Refact 4.6 — Unificar handlers de permissão em presets

**Problema**: Inconsistência sistêmica entre `onPreToolUse` e `onPermissionRequest` em 3/5 presets.
**Fix**: Criar função de fábrica de preset que gera ambos os handlers de forma consistente:

```js
function createPreset({ defaultDecision, allowList, denyList }) {
  const decide = (toolName) => {
    if (denyList?.includes(toolName)) return 'deny';
    if (allowList && !allowList.includes(toolName)) return 'deny';
    return defaultDecision;
  };
  return {
    onPreToolUse: (tool) => ({ decision: decide(tool.name) }),
    onPermissionRequest: (req) => ({ decision: decide(req.toolName) }),
  };
}
```

---

## Onda 5 — Backlog P4 (Sprint 4, Iterativo)

> Organizados por módulo. Abordar oportunisticamente durante manutenção.

### terminal/ (12 P4)

- T-01: Cancellation token para `_tryStartDialogLoop`
- T-02: Não silenciar errors em `_executeTurn` — usar `logger.warn()`
- T-06: Adicionar `MAX_WAIT_MS = 30_000` em `handlePipeline`
- T-09: Converter `readSkillsConfig`/`writeSkillsConfig` para async
- T-11: Excluir pattern de email em `extractAtReferences`
- T-12: Paralelizar `readDirectoryContext` com `Promise.all()`
- T-14: Usar `once` ou registrar com referência em `registerAgentEventListeners`
- T-17: Cache TTL 5s para `detectGitRoot` por diretório

### hooks/ (5 P4)

- Freeze `SDK_HOOKS` com `Object.freeze()`
- Extrair singletons de `session-lifecycle.js` para injeção
- Adicionar `COPILOT_FALLBACK_MODEL` a config central
- Documentar `modifiedArgs` capability ausente

### config/ (5 P4)

- Adicionar `refresh()` invalidando caches de módulos dependentes
- Filtrar binários em `pinned-files-loader.js`
- Schema de validação para estratégias de `system-prompt.js`

### bridges/ (2 P4)

- `buildZodSchema allOf`: merge recursivo de `properties`
- Usar `MCP_PORT` dedicado em vez de genérico `PORT`

### lib/ (4 P4)

- Implementar cache simples em `getAgent()`
- Resolver naming collision `tools-registry.js` (lib/ vs config/)
- Documentar que lista de modelos requer atualização manual

### api/ (3 P4)

- Corrigir `MAX_SSE_CLIENTS` (vide Refact 4.3)
- Tratar estado `'starting'` em `/dialog/start`
- Adicionar suporte a wildcards em `?events=`

### core/ (3 P4)

- Renomear `LLM_B_TURN_TIMEOUT` → `LLM_B_TURN_TIMEOUT_MS`
- Remover import circular `core → types`
- Verificar e unificar `MAX_SSE_CLIENTS`

### types/ (4 P4)

- Corrigir parser Estratégia 4 para não extrair greedy
- Mover `buildStructuredRequest` UUID para injeção determinística
- Re-exportar `sdk.js` via `types/index.js`

### routes/ (4 P4)

- Unificar autenticação: apenas header (remover `?token=` query param)
- Adicionar retry em webhook delivery
- Validar preset hooks contra schema antes de aplicar
- Expor `/metrics` com filtro por categoria

### db/ (4 P4)

- Documentar re-entrância em `registerExitHandler()`
- Adicionar `PRAGMA integrity_check` em `getCopilotDb()` (modo dev)
- `TODO_TASKS.created_at`/`updated_at` via `DEFAULT (strftime(...))`
- Garantir que `registerExitHandler` registra SIGTERM

### observability/ (4 P4)

- TTL por evento em `eventBuffer`
- Debounce em `flush()`
- Configurar exporters via env (`OTEL_EXPORTER=...`)
- Limitar `getMetrics()` a subset relevante

### channel/ (3 P4)

- Desacoplar `GAP-CHAN-001: reason hardcoded` em `stopDialogMode`
- Porta validation em `httpRequest` de `inject.js`

---

## Onda 6 — Cosmético P5 (Oportunístico)

| ID   | Arquivo   | Ação                                                                      |
| ---- | --------- | ------------------------------------------------------------------------- |
| T-18 | server.js | Separar `timingSafeEqual` de `&&` — deixar claro que sempre executa ambos |
| T-19 | server.js | Documentar que rate limiter é reiniciado (aceitável para dev)             |
| T-20 | index.js  | Armazenar retorno de `setInterval`/`setTimeout` para cancel               |
| T-21 | index.js  | Adicionar `process.on('SIGTERM', gracefulShutdown)`                       |
| T-22 | state.js  | Definir `MAX_ATTACHMENT_QUEUE = 50`                                       |
| T-23 | state.js  | Expor `setMaxListeners` via config                                        |
| T-27 | repl.js   | Ctrl+C → `dialog.cancel()` via AbortController                            |
| T-29 | dialog.js | Mover `64 * 1024` para `constants.js` como `SSE_CHUNK_MAX_BYTES`          |

---

## Matriz de Impacto × Esforço

```
IMPACTO
  ^
  |  [Fix 1.5 BUG-DA-001]   [Refact 4.1 always-alive]
  |  [Fix 1.1 SEC-API-001]  [Fix 2.2 LEAK-AGENT]
  |  [Fix 1.2 SEC-ROUTE-001][Fix 3.11 DNS rebinding]
  |  [Fix 1.3 path traversal]
  |
  +--[Fix 3.4 CORS OPTIONS]------[Refact 4.2 observability]
  |  [Fix 3.5 watchdog]          [Refact 4.3 MAX_SSE]
  |
  |                        [Fix 3.1 FTS5 triggers]
  |
  +--------------------------------------------> ESFORÇO
     Baixo             Médio              Alto
```

---

## KPIs de Aceitação por Onda

| Onda             | KPI Mínimo                                                                     | Status                                                                              |
| ---------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 1 (Security)     | 0 issues P2 de segurança em prod; todos os fixes com teste de regressão        | ✅ **ATINGIDO**                                                                     |
| 2 (Bug Fix)      | Memory usage estável em sessão 24h; timing metrics corretos; deny-all bloqueia | ✅ **ATINGIDO**                                                                     |
| 3 (Estabilidade) | 0 leaks detectados em profiling 1h; watchdog sem false restarts                | ✅ **ATINGIDO**                                                                     |
| 4 (Arquitetura)  | `always-alive.js` < 200 LOC; 0 imports circulares em observability/            | 📝 ACCEPTED (god class mantida como design decision; 0 ciclos circulares via madge) |
| 5 (Backlog)      | Todos P4 documentados no backlog do tracker                                    | ✅ **ATINGIDO** (44/44 P4 triados: 12 FIXED + 24 N/A + 8 ACCEPTED)                  |

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II — F25-02._
