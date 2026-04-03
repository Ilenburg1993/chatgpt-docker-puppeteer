# Auditoria — `hooks-audit-preset.js`

**Módulo**: `src/copilot/observability/hooks-audit-preset.js` **LOC**: 120 **Data**: 2026-06-10
**Auditor**: Copilot Full-Audit MF-II

---

## 1. Propósito

Preset de auditoria para hooks — substituto de `hooks/presets/audit.js`. Registra toda atividade de
hook no `defaultAuditLog` centralizado (ring buffer compartilhado) em vez de um trail local
separado.

Retorna:

- `hooks: SessionHooks` — 6 hooks com registro em `defaultAuditLog`
- `onPermissionRequest: PermissionHandler` — via `createPermissionHandler()`
- `getAuditTrail()` / `clearAuditTrail()` — delegates para `defaultAuditLog`

---

## 2. Arquitetura interna

```
createHooksAuditPreset(options)
├── options.allowAll?: boolean        ← controla createPermissionHandler; default false (seguro)
├── options.permissionHandler?        ← override direto do handler
├── record(hookName, sessionId, summary) → defaultAuditLog.record()
├── hooks.onPreToolUse()    → permissionDecision: 'allow' (sempre)
├── hooks.onPostToolUse()   → record apenas
├── hooks.onUserPromptSubmitted() → record
├── hooks.onSessionStart()  → record
├── hooks.onSessionEnd()    → record (void)
└── hooks.onErrorOccurred() → record + errorHandling: 'skip'
```

---

## 3. Achados

### FINDING-P4-1 (SEGURANÇA) — `onPreToolUse` sempre retorna `'allow'`

**Severidade**: P4 — Médio / Segurança **Localização**: `hooks` object, `onPreToolUse()` (~linha 88)

```js
async onPreToolUse(input, invocation) {
    record('onPreToolUse', invocation.sessionId, { tool: input.toolName });
    return { permissionDecision: 'allow' };  // ← hardcoded, nunca nega
},
```

O hook `onPreToolUse` controla se uma ferramenta é permitida em nível de hook. Este preset sempre
retorna `'allow'` independentemente de `options.allowAll` ou do estado do `createPermissionHandler`.
Isso significa que, mesmo que `createPermissionHandler({ allowAll: false })` esteja configurado,
qualquer ferramenta alcançando `onPreToolUse` será permitida pelo preset.

**O `onPermissionRequest`** (que usa o `PermissionHandler`) é um hook diferente para aprovação
interativa — não é equivalente ao `onPreToolUse`.

Na prática, este preset é designado para auditoria (não para controle de acesso real), mas o retorno
hardcoded de `'allow'` pode criar falsa sensação de segurança se usado em contextos onde se
esperaria que `allowAll: false` tivesse efeito sobre pré-execução de ferramentas.

**Proposta**: Documentar explicitamente que `onPreToolUse` neste preset é audit-only e sempre
permite, e que controle real de acesso deve ser implementado em outro preset. Alternativamente:

```js
async onPreToolUse(input, invocation) {
    record('onPreToolUse', invocation.sessionId, { tool: input.toolName });
    // Não bloquear — somente auditar. Para controle de acesso, usar permission-handler.js diretamente.
    return { permissionDecision: 'allow' };
},
```

---

### FINDING-P4-2 — `onErrorOccurred` sempre retorna `{ errorHandling: 'skip' }`

**Severidade**: P4 — Médio **Localização**: `hooks.onErrorOccurred()` (~linha 105)

```js
async onErrorOccurred(input, invocation) {
    record('onErrorOccurred', invocation.sessionId, {
        ctx: input.errorContext,
        recoverable: input.recoverable,
    });
    return { errorHandling: 'skip' };  // ← sempre skip
},
```

Retornar `'skip'` diz ao SDK para ignorar o erro e continuar. Para erros não-recuperáveis
(`recoverable: false`), isso pode mascarar falhas críticas que mereceriam `'throw'` ou `'abort'`. O
preset não distingue `recoverable` true/false — trata todos os erros da mesma forma.

**Proposta**:

```js
async onErrorOccurred(input, invocation) {
    record('onErrorOccurred', invocation.sessionId, {
        ctx: input.errorContext,
        recoverable: input.recoverable,
    });
    // Para erros não-recuperáveis, não swallow silenciosamente
    return { errorHandling: input.recoverable ? 'skip' : 'throw' };
},
```

---

### FINDING-P5-3 — Sem método `detach()` — hooks não podem ser removidos

**Severidade**: P5 — Baixo **Localização**: return value de `createHooksAuditPreset()`

O objeto retornado pelo preset (`{ hooks, onPermissionRequest, getAuditTrail, clearAuditTrail }`)
não inclui método de cleanup. Uma vez que `hooks` for registrado numa sessão, não há como removê-lo
via preset. Limitação da API em si, mas vale anotar para sessões de longa duração com mudança de
preset.

---

### FINDING-P5-4 — Warning de `allowAll` em produção usa `NODE_ENV !== 'test'`

**Severidade**: P5 — Cosmético **Localização**: ~linha 54

```js
if (options.allowAll === true && process.env['NODE_ENV'] !== 'test') {
  log('WARN', '...');
}
```

Verificação de `NODE_ENV` é correta para ambientes de teste. Mas em produção com `NODE_ENV`
indefinido (comum em containers sem NODE_ENV explícito), `!== 'test'` é `true`, então o WARN aparece
— correto. Se alguém setar `NODE_ENV=staging` com `allowAll: true`, o WARN também aparece.
Comportamento adequado.

---

## 4. Pontos positivos

- **Fase BE hardening**: adição de warning explícito para `allowAll=true` fora de teste — boa
  prática de segurança.
- **`createPermissionHandler({ allowAll: false })`** por padrão — seguro para produção.
- **Delegate para `defaultAuditLog`**: o trail de auditoria é centralizado, não isolado por preset —
  facilita análise consolidada.
- **API compatível** com o antigo `createAuditPreset()` de `hooks/presets/audit.js`.
- **Pequeno e focado**: 120 LOC fazem exatamente o que propõem — auditoria de hooks.

---

## 5. Score

| Dimensão                     | Nota       |
| ---------------------------- | ---------- |
| Correção lógica              | 8/10       |
| Segurança (allowAll default) | 8/10       |
| API e JSDoc                  | 8/10       |
| Completude                   | 7/10       |
| **Global**                   | **7.8/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
