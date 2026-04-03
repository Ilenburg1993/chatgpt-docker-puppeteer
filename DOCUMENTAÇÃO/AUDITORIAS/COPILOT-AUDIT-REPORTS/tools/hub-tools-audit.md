# Audit: src/copilot/tools/hub-tools.js

**Módulo**: `copilot/tools` **Arquivo**: `src/copilot/tools/hub-tools.js` **LOC**: 344 **Data**:
2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Fornece as 5 hub tools para interação LLM-A ↔ LLM-B via `ConversationHub`: `hub_create_session`,
`hub_send_message`, `hub_poll_user_messages`, `hub_read_history` e `hub_list_sessions`. Usa injeção
de dependência (`setHub`) para evitar importação implícita circular. Sanitização de payloads grandes
com truncamento explícito.

**Score**: 8.0/10

---

## Achados

### P4 — requireHub() Verifica Propriedade isReady Não Tipada

**Localização**: Função `requireHub()`.

```js
return _injectedHub.isReady ? _injectedHub : null;
```

`isReady` não está definida no typedef `ConversationHub` importado. O acesso funciona em runtime se
o hub implementar essa propriedade, mas o type checker pode reportar erro.

**Impacto**: Segurança operacional baixa; mas pode suprimir erros de tipagem legítimos.

**Recomendação**: Adicionar `isReady: boolean` ao typedef de `ConversationHub`.

---

### P4 — hub_read_history: Truncamento Silencioso do Conteúdo de Turns

**Localização**: `hubReadHistoryTool`, mapeamento de turns.

```js
content: t.content.slice(0, 500) + (t.content.length > 500 ? '...' : ''),
```

Cada turn é truncado para 500 chars. Para turns longos (código, análises), o conteúdo retornado pode
ser insuficiente para LLM-A retomar contexto.

**Impacto**: Funcional — pode comprometer qualidade do contexto recuperado.

**Recomendação**: Tornar o limite configurável via parâmetro `maxContentLength` do tool.

---

### P4 — hub_send_message: Validação de timeoutMs Depois de Truthy Check

**Localização**: `hubSendMessageTool`, handler, bloco `resolvedTimeout`.

```js
const resolvedTimeout =
  typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(Math.max(timeoutMs, 5_000), 300_000)
    : 120_000;
```

A validação clampeia entre 5s e 300s. Porém, a conversão é aplicada **depois** de já aceitar o
parâmetro via Zod com `.default(120000)`. Se Zod já garantiu `number`, os checks de `typeof` e
`Number.isFinite` são redundantes (não prejudiciais).

**Impacto**: Zero (defensive coding redundante mas inofensivo).

---

## Positivos

- `setHub()` injection pattern — sem importação circular
- `MAX_MSG_CHARS = 32_000` aplicado ao `message`, `context` e `intent` — proteção contra payloads
  gigantes
- `hub_poll_user_messages` marca mensagens como lidas — semântica correta
- `hub_list_sessions` suporta filtro por status — flexível
- JSDoc completo em todas as 5 tools
