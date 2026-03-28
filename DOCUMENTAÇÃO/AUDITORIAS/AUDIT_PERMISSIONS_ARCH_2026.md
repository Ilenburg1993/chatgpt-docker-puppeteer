# AUDIT_PERMISSIONS_ARCH_2026

**Tipo**: Auditoria arquitetural + segurança **Escopo**: Subsistema de permissões e aprovação de
tools do `src/copilot` **Data**: 2026-06-22 **Status**: ✅ Executado — ver itens abaixo

---

## 1. Escopo da Auditoria

Investigação completa do fluxo de `requirePermission`/`PermissionHandler` no Always-Alive Agent,
cobrindo:

- Fluxo de aprovação de tools (SDK → handler → decisão)
- Hardcoding arquitetural de `approveAll`
- Infraestrutura de permissões existente (`lib/permissions.js`) — subutilizada
- Ausência de controle em runtime (sem endpoint HTTP, sem tool)
- Web Search desabilitado por padrão sem justificativa operacional forte
- Migração incompleta para `buildTool` (UPG-N17 — `web-tools.js` ainda em `defineTool`)
- IPv6 SSRF (parcialmente corrigido, escopo de expansão)
- Conformidade com SDK `@github/copilot-sdk` v0.1.32+

---

## 2. Mapa de Arquitetura — Fluxo de Permissões

```
AlwaysAliveAgent.start()
    │
    ├─ initOrResumeSession(client, { onPermissionRequest: approveAll })   ← HARDCODED
    │      │
    │      └─ session-manager.js::buildAuditingPermissionHandler(approveAll)
    │              │
    │              └─ wraps: logs high-risk tools + writes logs/tool-audit.jsonl
    │                        mas APROVA TUDO igualmente (approveAll)
    │
    ├─ bootstrapTools(registry, telemetry, mcpTools)
    │      │
    │      └─ mapeia todos os tools com overridesBuiltInTool: true
    │              │
    │              ├─ code-tools (3) — buildTool, requiresApproval=true
    │              ├─ hook-tools (3) — buildTool
    │              ├─ hub-tools (5) — buildTool
    │              ├─ file-tools: (4 read withSkipPermission, 6 write buildTool)
    │              ├─ shell-tools — defineTool, skipPermission: false  ← não migrado
    │              ├─ web-tools (1-2) — defineTool  ← não migrado (UPG-N17 incompleto)
    │              ├─ git-tools — defineTool
    │              ├─ session-rpc-tools — defineTool
    │              ├─ session-tools — defineTool
    │              ├─ task-tools — defineTool
    │              ├─ todo-tools — defineTool
    │              └─ introspection-tools — defineTool
    │
    └─ reconexão (linha 1221) — também usa approveAll hardcoded
```

**Decisão por tool:**

| skipPermission              | PermissionHandler                            | Resultado                 |
| --------------------------- | -------------------------------------------- | ------------------------- |
| `true` (withSkipPermission) | ignorado                                     | sempre aprovado           |
| `false` (default)           | `approveAll`                                 | aprovado sem perguntar    |
| `false`                     | `createPermissionHandler({allowAll:true})`   | aprovado + audit opcional |
| `false`                     | `createPermissionHandler({denyTools:[...]})` | controle seletivo         |

---

## 3. Achados

### 🔴 CRÍTICO — PERM-01: `approveAll` Hardcoded em Dois Locais

**Arquivo**: `src/copilot/agent/always-alive.js` linhas 326 e 1221

```js
// ANTES (ambos os locais):
onPermissionRequest: approveAll,
```

**Problema**: O SDK `approveAll` é importado diretamente e passado sem possibilidade de troca em
runtime. A rica infraestrutura em `lib/permissions.js` (whitelist, blacklist, callback custom, audit
mode) é completamente ignorada pelo agente principal.

**Impacto**: Impossível alterar o comportamento sem reiniciar o processo. Sem observabilidade das
decisões por padrão (o audit wrapper existe mas o SDK `approveAll` não passa pelo
`lib/permissions`).

**Correção**: Introduzir `#permissionHandler` como campo privado da classe, inicializável via
construtor/`setPermissionMode()`. Ver SEC-PERM-01 no plano de execução.

---

### 🔴 CRÍTICO — PERM-02: Nenhum Controle de Permissão em Runtime

**Problema**: Não existe nenhum endpoint HTTP (`/api/copilot/permissions/*`), nenhuma tool
(`permission_mode_get/set`), nenhum comando terminal capaz de alterar a política de aprovação sem
reiniciar o agente.

**Impacto**: O usuário pediu explicitamente a opção de "autorizar tudo automaticamente". Atualmente
o sistema já aprova tudo (hardcoded), mas o usuário não sabe disso e não tem como ver/mudar esse
comportamento.

**Correção**: Implementar:

1. `permission_mode_get` / `permission_mode_set` tools (expostas à LLM)
2. `GET/POST /api/copilot/permissions` endpoints HTTP
3. Modos suportados: `approve_all`, `audit_only`, `selective` (com whitelist/blacklist configurável)

---

### 🟡 ALTO — UPG-N17-WEB: `web-tools.js` ainda usa `defineTool` direto

**Arquivo**: `src/copilot/tools/web-tools.js`

**Problema**: A migração UPG-N17 foi aplicada a 4 arquivos (code/hook/hub/file-tools), mas
`web-tools.js` ainda usa a API legada com `defineTool` + cast manual de `ZodSchema` + parâmetro
`parameters` sem `buildTool`.

**Correção**: Migrar `webFetchTool` e `webSearchTool` para `buildTool` com `requiresApproval=true`.
Ver UPG-N17-WEB.

---

### 🟡 ALTO — WEB-01: `web_search` desabilitado por padrão sem justificativa operacional

**Arquivo**: `src/copilot/tools/web-tools.js` (última linha)

```js
export const webTools = [
  webFetchTool,
  ...(process.env['WEB_SEARCH_ENABLED'] === 'true' ? [webSearchTool] : []),
];
```

**Arquivo**: `src/copilot/config/session-config.js`

```js
export const DEFAULT_EXCLUDED_TOOLS = ['powershell', 'web_fetch', 'web_search', 'memory'];
```

**Problema**: `web_search` requer `WEB_SEARCH_ENABLED=true` para ser incluído na lista de tools.
Esse flag não está em nenhum `.env` padrão. A exclusão em `DEFAULT_EXCLUDED_TOOLS` é das ferramentas
**built-in do SDK** (que são substituídas pelas custom tools via `overridesBuiltInTool: true`), por
isso não bloqueia as custom tools — mas o env var sim.

**Correção**: Inverter lógica para opt-out (`WEB_SEARCH_DISABLED=true`). Usuário expressamente
solicitou habilitação.

---

### 🟡 ALTO — ARCH-01: `session-config.js::buildAlwaysAliveConfig` não é usado pelo agente

**Arquivo**: `src/copilot/config/session-config.js` e `src/copilot/agent/always-alive.js`

**Problema**: `session-config.js` exporta `buildAlwaysAliveConfig`, `buildReadOnlyConfig`,
`buildFullAccessConfig`, `buildDiagnosticConfig` — mas `always-alive.js` não importa nenhuma dessas
funções. O agente constrói manualmente sua chamada de `initOrResumeSession`, duplicando lógica.

**Correção**: `always-alive.js::start()` deve usar `buildAlwaysAliveConfig()` como base (ou pelo
menos ser consistente com ele). Médio prazo: refatorar para usar a config canônica.

---

### 🟡 MÉDIO — PERM-03: `lib/permissions.js::createSafePermission` não bloqueia tools shell reais

**Arquivo**: `src/copilot/lib/permissions.js`

```js
export function createSafePermission(additionalDenyTools) {
    return createPermissionHandler({
        denyPatterns: [/^shell_exec$/i, /^run_command$/i, /^exec$/i],
        denyTools: ['system_exec', 'shell_run', ...],
    });
}
```

**Problema**: O `createSafePermission` usa nomes genéricos (`shell_exec`, `run_command`) que não
correspondem aos nomes reais das tools do projeto (`run_shell_command`, `run_npm_script`,
`run_node_script`). Se usado, não teria efeito algum sobre as shell-tools reais.

**Correção**: Atualizar `createSafePermission` com os nomes reais das shell-tools do projeto.

---

### 🟡 MÉDIO — SSRF-01: IPv6 parcialmente coberto

**Arquivo**: `src/copilot/tools/web-tools.js`

```js
const h = url.hostname.toLowerCase();
if (h === '::1' || h === '0:0:0:0:0:0:0:1' || h.startsWith('fd') || h === 'fe80') {
  return { safe: false, reason: `IPv6 privado/loopback bloqueado: ${url.hostname}` };
}
```

**Problema**: Não cobre `::ffff:127.0.0.1` (IPv4-mapped IPv6), `fc00::/7` (todo bloco ULA, não
apenas `fd`), `fe80::/10` (link-local, apenas `fe80` exato não é suficiente).

**Correção**: Expandir validação IPv6, ou usar biblioteca como `is-private-ip`.

---

### 🟢 BAIXO — AUDIT-01: Audit log sem rotação

**Arquivo**: `src/copilot/agent/session-manager.js`

```js
await fs.appendFile(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n');
```

**Problema**: `logs/tool-audit.jsonl` cresce indefinidamente sem rotação. Em long-running sessions,
pode atingir tamanho problemático.

**Correção**: Implementar rotação por tamanho (ex: 10MB → rename + novo arquivo).

---

### 🟢 BAIXO — SDK-01: `session-rpc-tools.js` ainda usa `defineTool` direto

**Problema**: `session-rpc-tools.js`, `session-tools.js`, `task-tools.js`, `todo-tools.js`,
`git-tools.js`, `shell/index.js` — todos ainda usam `defineTool` diretamente. Fora do escopo do
commit atual mas registrado para UPG-N18.

---

## 4. Plano de Execução

### Sprint Atual (implementar agora)

| ID          | Prioridade | Descrição                                                               | Arquivo(s)                                           |
| ----------- | ---------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| PERM-01-FIX | 🔴         | Substituir `approveAll` hardcoded por `#permissionHandler` configurável | `always-alive.js`                                    |
| PERM-02-FIX | 🔴         | Criar `permission_mode_get/set` tools + endpoint HTTP                   | `tools/permission-tools.js`, `api/bridge-control.js` |
| WEB-01-FIX  | 🟡         | Habilitar `web_search` por padrão (opt-out via env)                     | `web-tools.js`                                       |
| UPG-N17-WEB | 🟡         | Migrar `web-tools.js` para `buildTool`                                  | `web-tools.js`                                       |
| PERM-03-FIX | 🟡         | Corrigir `createSafePermission` com nomes reais                         | `lib/permissions.js`                                 |
| SSRF-01-FIX | 🟡         | Expandir cobertura IPv6 no SSRF guard                                   | `web-tools.js`                                       |

### Backlog

| ID           | Prioridade | Descrição                                        |
| ------------ | ---------- | ------------------------------------------------ |
| ARCH-01-FIX  | 🟡         | `always-alive.js` usar `buildAlwaysAliveConfig`  |
| AUDIT-01-FIX | 🟢         | Rotação do audit log                             |
| SDK-01-FIX   | 🟢         | UPG-N18: migrar tools restantes para `buildTool` |

---

## 5. Detalhamento das Implementações

### PERM-01-FIX: Campo `#permissionHandler` configurável

```js
// always-alive.js — adicionar campo privado
/** @type {import('@github/copilot-sdk').PermissionHandler} */
#permissionHandler = approveAll;

// Setter público para troca em runtime
setPermissionMode(handler) {
    this.#permissionHandler = handler;
    log('INFO', `[AlwaysAlive] PermissionHandler atualizado.`);
}

// Getter para inspeção
getPermissionMode() {
    return this.#permissionHandler === approveAll ? 'approve_all' : 'custom';
}

// Em start() e reconexão:
onPermissionRequest: this.#permissionHandler,
```

### PERM-02-FIX: Tool `permission_mode_set`

```js
// tools/permission-tools.js (novo arquivo)
export const permissionModeSetTool = buildTool({
  name: 'permission_mode_set',
  description: 'Altera o modo de aprovação de tools do agente em runtime. ...',
  parameters: z.object({
    mode: z.enum(['approve_all', 'audit_only', 'deny_shell', 'selective']),
    allowTools: z.array(z.string()).optional(),
    denyTools: z.array(z.string()).optional(),
  }),
  handler: async ({ mode, allowTools, denyTools }) => {
    // chama alwaysAliveAgent.setPermissionMode(...)
  },
  requiresApproval: false, // lida com permissão, não precisa de aprovação
});
```

### WEB-01-FIX: Lógica opt-out

```js
// web-tools.js — última linha
export const webTools = [
  webFetchTool,
  ...(process.env['WEB_SEARCH_DISABLED'] === 'true' ? [] : [webSearchTool]),
];
```

---

## 6. Restrição DL-PERM (Dialog Loop)

> **IMPORTANTE**: A única coisa que o usuário NÃO pode autorizar automaticamente é sair do dialog
> loop. Isso é garantido pelo protocolo DL-PERM implementado em `bridge-dialog.js`:
>
> ```js
> bridge.post('/dialog/stop', async (req, res) => {
>     const { force } = req.body ?? {};
>     if (!force) { return res.status(403).json({...}); }
>     await agent.stopDialogLoop({ authorized: true });
> });
> ```
>
> O `stopDialogLoop()` não é uma tool — é um método da classe. Portanto, a infraestrutura de
> `PermissionHandler` não se aplica a ele. A proteção é estrutural (requer `force: true` explicit +
> `authorized: true`). Qualquer modo de `approve_all` não afeta essa restrição.

---

## 7. Conformidade com SDK

- **`approveAll`**: API oficial do SDK, sem depreciação conhecida. Adequado para approve_all mode.
- **`PermissionHandler`**: interface estável. `createPermissionHandler` de `lib/permissions.js` é
  100% compatível.
- **`overridesBuiltInTool`**: padrão correto para custom tools que substituem as built-in do SDK.
  Necessário para `web_fetch` e `web_search`.
- **`skipPermission`**: propriedade confirmada pelo SDK para bypass de permission handler em tools
  read-only/seguras.
- **Zod schemas**: `buildTool` suporta tanto Zod v3 (`_def`) quanto v4 (`_zod`) via detecção
  automática — compatível com upgrade futuro do SDK.
