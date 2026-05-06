# Auditoria ponta a ponta — Permissions em `src/copilot`

Data: 2026-05-05 Escopo: `src/copilot/**` relacionado a permissões (SDK, hooks, agent, presentation,
terminal, server, observability)

## 1) Situação atual (diagnóstico factual)

### Arquitetura canônica identificada

Fluxo principal de permission hoje:

1. `PermissionController` (`hooks/permission-controller.js`) governa modo
   (`approve_all|audit_only|selective`) em runtime.
2. Agent (`always-alive` + `AgentContext`) expõe `getPermissionMode`, `setPermissionMode`,
   `getPermissionCapabilitySnapshot`.
3. Sessão SDK recebe `onPermissionRequest` no initializer via `buildAuditingPermissionHandler(...)`.
4. Eventos SDK (`permission.requested/completed`) passam por `event-handlers/interaction-events.js`.
5. Terminal consome via `sdk-session-events.js` + `sdk-interactions.js` + comandos `/permission`,
   `/status`, `/now`, `/menu`, `/sdk waits`.
6. HTTP control também governa permission mode em `/copilot-api/control/permissions`.

### Cobertura de funcionalidades SDK (permissions)

- ✅ `onPermissionRequest` hook de sessão ativo.
- ✅ `permissionsHandlePending` existe na camada agent (`facades/sdk/ui-ops.js`).
- ✅ Capability flags de `pendingPermissionsAvailable` presentes.
- ⚠️ Até esta auditoria, a resposta manual de pending permission **não estava exposta** no terminal.

### Arquiteturas paralelas / drift

1. **Duplicidade de factory de permission handler**
   - `src/copilot/sdk/session/permissions.js`
   - `src/copilot/hooks/permission-handler.js`
   - Risco: drift semântico e divergência futura.

2. **Superfícies de controle duplicadas (HTTP + terminal + tools)**
   - Não é bug por si só, mas exige contrato unificado para evitar inconsistência operacional.

## 2) Bugs e gaps encontrados

## BUG-PERM-001 (Crítico)

**Arquivo:** `src/copilot/audit/pipeline-permission.js`

**Problema:** classificação de decisão no audit wrapper usava `result.kind === 'approved'`.

**Impacto:** decisões válidas de handler SDK (`approve-once`, `approve-for-session`,
`approve-for-location`) eram classificadas como `denied` no audit log/hook.

**Status:** ✅ Corrigido nesta rodada.

---

## BUG-PERM-002 (Médio)

**Arquivo:** `src/copilot/audit/pipeline-permission.js`

**Problema:** criação de diretório via `mkdir(join(file, '..'))` (forma frágil/não canônica).

**Impacto:** risco de inconsistência de caminho em ambientes diferentes.

**Status:** ✅ Corrigido para `mkdir(dirname(file))`.

---

## GAP-PERM-001 (Alto)

**Arquivo(s):** `event-handlers/interaction-events.js` + terminal state

**Problema:** eventos `permission.requested/completed` não propagavam `requestId`/`result` de forma
consistente no payload emitido.

**Impacto:** correlação request→completion degradada e dificuldade para ação manual segura.

**Status:** ✅ Corrigido (payload enriquecido com `requestId`, `permissionType`, `result`).

---

## GAP-PERM-002 (Alto)

**Arquivo(s):** `terminal/commands/sdk.js` + gateways/presentation

**Problema:** funcionalidade SDK de `permissionsHandlePending` existente, mas sem comando terminal
para resposta manual de pending permission.

**Impacto:** operador terminal não conseguia fechar pendência diretamente no fluxo local.

**Status:** ✅ Corrigido (`/permission respond`).

---

## GAP-PERM-003 (Médio)

**Arquivo:** `terminal/sdk-session-events.js`

**Problema:** `permission.mode_changed` não era refletido na UX live do terminal.

**Impacto:** mudança de governança ocorria sem feedback operacional imediato.

**Status:** ✅ Corrigido (activity + stdout + SSE + refresh prompt).

---

## GAP-PERM-004 (Baixo)

**Arquivo:** `terminal/repl-banner.js`

**Problema:** banner com comandos SDK/permission desatualizados.

**Impacto:** UX/documentação inline desalinhada.

**Status:** ✅ Corrigido.

## 3) Situação ideal (target state)

1. **Single semantic policy core** para permission handler (evitar implementação duplicada).
2. **Eventos permission completos e correlacionáveis** (requestId/type/result/granted) em todas as
   camadas.
3. **Operação terminal completa**: observar + governar + responder pendências sem recorrer ao HTTP.
4. **Audit trail semanticamente correto** alinhado à union oficial do SDK.
5. **Capability-first UX**: status/now/menu mostram claramente governança e possibilidades reais da
   sessão.

## 4) Implementações realizadas nesta rodada

- Fix semântico no `buildAuditingPermissionHandler` para reconhecer `approve-*` como approved.
- Fix de path de log (`dirname`).
- Propagação de `requestId/permissionType/result` nos interaction events.
- Exposição de `handleAgentSdkPendingPermission` em presentation/gateway terminal.
- Novo comando terminal: `/permission respond <id|latest> <decision> [json]`.
- Atualização otimista do estado local de permission após respond.
- Listener de `permission.mode_changed` no `sdk-session-events`.
- Help/banner atualizados.
- Testes novos e ajustados:
  - `test_pipeline_permission.spec.js`
  - `test_commands_sdk.spec.js`
  - `test_terminal_sdk_session_events.spec.js`

## 5) Riscos remanescentes

1. **Duplicidade de handlers (`sdk/session/permissions` vs `hooks/permission-handler`)** ainda
   existe.
2. `commands/sdk.js` contém trechos com mojibake textual (não funcional, mas dívida de
   UX/legibilidade).
3. Não há ainda comando terminal dedicado para listar pending permissions direto do RPC da sessão
   (hoje usa estado observado local + respond por requestId).

## 6) Conclusão

A trilha permission agora está funcionalmente fechada no terminal (observação + governança +
resposta), com correções críticas de semântica de auditoria e correlação de eventos.

A próxima fase recomendada é consolidar o núcleo de policy para eliminar arquitetura paralela e
reduzir risco de drift.
