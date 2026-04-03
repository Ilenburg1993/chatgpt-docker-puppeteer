# Audit: src/copilot/tools/task-tools.js

**Módulo**: `copilot/tools` **Arquivo**: `src/copilot/tools/task-tools.js` **LOC**: 154 **Data**:
2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Fornece 4 tools que delegam ao servidor local via HTTP: `get_tasks`, `add_task`, `get_session_state`
e `get_system_health`. `get_tasks`, `get_session_state` e `get_system_health` têm
`withSkipPermission`. `add_task` usa POST ao servidor. `get_session_state` lê arquivos de estado via
`readFileSync`.

**Score**: 7.5/10

---

## Achados

### P3 — add_task: HTTP POST Local Sem Autenticação

**Localização**: `addTaskTool`, handler.

```js
const response = await httpRequest('POST', `http://127.0.0.1:${PORT}/api/queue`, task);
```

POST para a API local sem token de autenticação. Qualquer processo rodando no mesmo host que possa
fazer conexão TCP para `127.0.0.1:PORT` pode injetar tarefas na fila.

**Impacto**: Médio em ambientes multi-usuário ou containerizados; baixo em desenvolvimento local
solo.

**Recomendação**: Adicionar um token de autenticação compartilhado entre o servidor e este cliente,
mesmo que seja apenas um Bearer token gerado no startup.

---

### P4 — get_session_state usa readFileSync — Bloqueia Event Loop

**Localização**: `getSessionStateTool`, handler.

```js
const briefing = fs.readFileSync(path.join(STATE_DIR, 'session-briefing.md'), 'utf8');
const context = fs.readFileSync(path.join(STATE_DIR, 'session-context.json'), 'utf8');
const pending = fs.readFileSync(path.join(STATE_DIR, 'pending-tasks.md'), 'utf8');
```

Três `readFileSync` consecutivos. O tamanho dos arquivos é tipicamente pequeno, mas o padrão é
inconsistente com o uso de async em `httpRequest`.

**Impacto**: Muito baixo; arquivos de estado são pequenos.

**Recomendação**: Migrar para `fs.promises.readFile` para consistência.

---

### P4 — get_tasks: URL Construída com String Interpolation (Status Não Validado)

**Localização**: `getTasksTool`, handler.

```js
const url = `http://127.0.0.1:${PORT}/api/queue${status ? `?status=${encodeURIComponent(status)}` : ''}`;
```

`encodeURIComponent(status)` é aplicado — HTTP injection está protegido. Zod valida `status` como
string, mas sem enum de valores válidos. Um valor inesperado como `../etc` seria aprovado pelo Zod
mas rejeitado pela API downstream.

**Impacto**: Muito baixo; `encodeURIComponent` protege a URL construction.

---

## Positivos

- `encodeURIComponent(status)` aplicado à query string — correto
- `get_tasks`, `get_session_state`, `get_system_health` com `withSkipPermission` — baixo risco
- `httpRequest` abstrai o mecanismo HTTP — fácil de mockar em testes
- `get_session_state` retorna objeto estruturado com seções separadas
