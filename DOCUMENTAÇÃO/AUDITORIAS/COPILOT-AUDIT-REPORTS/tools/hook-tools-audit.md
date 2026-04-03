# Audit: src/copilot/tools/hook-tools.js

**Módulo**: `copilot/tools` **Arquivo**: `src/copilot/tools/hook-tools.js` **LOC**: 329 **Data**:
2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Fornece 3 hook tools: `hook_get_audit_tail`, `request_user_input` e `hook_get_pending_tasks`. O
`request_user_input` implementa suspensão real via Promise + Map de resolvers com limite de 5
requests simultâneos e auto-cleanup de 10min. `hook_get_audit_tail` tem dual-source (ring buffer
SDK + fallback audit.jsonl). Injeção de `broadcastSse` via `configureHookTools()` evita import
circular.

**Score**: 8.0/10

---

## Achados

### P3 — \_pendingInputResolvers: autoCleanupTimer Pode Vazar em Shutdown Abrupto

**Localização**: `requestUserInputTool` handler, `autoCleanupTimer`.

```js
const autoCleanupTimer = setTimeout(() => { ... }, 600_000);
autoCleanupTimer.unref();
```

`unref()` impede que o timer segure o processo, mas em shutdown abrupto (SIGKILL) os resolvers
pendentes nunca se resolvem. O Map `_pendingInputResolvers` fica em estado inconsistente para a
próxima chamada (raro, pois o processo teria encerrado).

**Impacto**: Negligível — `unref()` já mitiga o principal problema. O limite de 5 pendentes previne
acúmulo.

---

### P4 — request_user_input: Status 'timeout' Requer Tratamento Específico pelo Caller

**Localização**: `requestUserInputTool`, callback do autoCleanupTimer.

```js
resolve({ ..., status: 'timeout', answer: '', instruction: 'Timeout: ...' });
```

O handler retorna `status: 'timeout'` com `answer: ''`. Callers que não distinguem
`status === 'resolved'` vs `status === 'timeout'` procedem com resposta vazia.

**Impacto**: Baixo; a instrução no campo `instruction` guia o modelo, mas o campo `status` deve ser
verificado pelo modelo.

**Recomendação**: Garantir que o system prompt do LLM-B instrua verificação de `status` antes de
usar `answer`.

---

### P4 — hook_get_audit_tail: Fallback para Subprocess tail

**Localização**: `hookGetAuditTailTool`, bloco de fallback `compliance`.

```js
const { stdout: raw } = await execFileAsync('tail', ['-n', String(n), auditPath], ...);
```

Usa o utilitário externo `tail`. Em sistemas sem `tail` ou se `auditPath` não existir, cai para
`{ entries: [], total: 0 }` — comportamento correto mas sem indicação clara ao caller de qual foi o
problema.

**Impacto**: Baixo em ambientes Linux padrão.

---

## Positivos

- Limite de 5 requests simultâneos com rejeição explícita (RF-029)
- `_broadcastSse` injetado via `configureHookTools()` — sem import dinâmico circular (ARCH-03)
- `resolveUserInput()` suporta `requestId` específico ou FIFO — flexível
- `getPendingInputIds()` exportado para diagnóstico externo
- `autoCleanupTimer.unref()` — não segura o processo Node.js
- Ring buffer SDK como source primária no `hook_get_audit_tail` — isolamento correto (Gap 10)
