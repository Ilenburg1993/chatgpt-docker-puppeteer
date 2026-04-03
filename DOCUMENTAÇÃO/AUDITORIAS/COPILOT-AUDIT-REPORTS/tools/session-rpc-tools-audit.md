# Audit: src/copilot/tools/session-rpc-tools.js

**Módulo**: `copilot/tools` **Arquivo**: `src/copilot/tools/session-rpc-tools.js` **LOC**: 281
**Data**: 2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Fornece 8 tools de RPC de sessão SDK: `session_mode_get/set`, `session_plan_read/update/delete`,
`session_agent_list/select` e `session_compact`. Usa injeção via `setSessionRpc()`. Todas as
chamadas são encapsuladas em `wrapRpc()` com try/catch. Dependência explicitamente documentada como
"API interna SDK v0.2.0 sem garantia pública".

**Score**: 7.5/10

---

## Achados

### P4 — Uso Direto de defineTool ao Invés de buildTool

**Localização**: Todas as 8 tools no arquivo.

```js
const sessionModeGetTool = defineTool('session_mode_get', { ... });
```

Este arquivo usa `defineTool` do SDK diretamente, enquanto o padrão do projeto é `buildTool`
(wrapper com logging automático). Isso significa que chamadas a estas tools NÃO são logadas via
`[tool-factory] Invocando tool '...'`.

**Impacto**: Médio — reduz observabilidade para estas 8 tools.

**Recomendação**: Migrar para `buildTool` para observabilidade consistente.

---

### P4 — wrapRpc Usa `any` para o Parâmetro rpc

**Localização**: `wrapRpc()`, parâmetro `fn`.

```js
async function wrapRpc(toolName, fn) {
    // ...
    return await fn(r.rpc);  // r.rpc tipado como { call?: Function }
}
// No handler:
async (rpc) => { const result = await rpc.mode.get(); ... }  // rpc é any
```

O callback `fn` recebe `rpc` como `any` (via `rpc: any` na assinatura interna). Acesso a
`rpc.mode.get()`, `rpc.plan.read()` etc. não tem verificação de tipo.

**Impacto**: Baixo; RPCs de SDK são estáveis mas sem tipos públicos.

---

### P4 — session_agent_select: Assume rpc.agent.deselect() Existe

**Localização**: `sessionAgentSelectTool`, handler com `name === ''`.

```js
if (!name) {
  await rpc.agent.deselect();
  log('INFO', '[session_agent_select] agente deselecionado (padrão)');
  return { selected: null };
}
```

`rpc.agent.deselect()` é assumido como existente mas não é verificado. Se ausente no SDK, lança erro
não tratado (capturado pelo `wrapRpc` try/catch, mas retorna `{ error }` silenciosamente).

**Impacto**: Baixo; `wrapRpc` trata o erro graciosamente.

---

### P5 — Redundância de Casting ZodSchema

**Localização**: Em múltiplas tools.

```js
parameters: /** @type {import('@github/copilot-sdk').ZodSchema<...>} */ (/** @type {unknown} */ (z.object({...})))
```

Double-cast `ZodSchema ← unknown ← ZodObject` é necessário para satisfazer a tipagem do SDK. É
verboso mas tecnicamente correto.

---

## Positivos

- `wrapRpc()` unifica tratamento de erros para todas as 8 tools
- `setSessionRpc()` com log de registro/remoção
- Comentários `SDK-05` documentam instabilidade da API — excelente rastreabilidade
- `session_compact` faz logging de `tokensFreed` e `messagesRemoved`
- `getRpc()` retorna Union type permitindo early-return sem exceção
