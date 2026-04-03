# api/bridge-tasks.js — Auditoria

**Módulo**: `src/copilot/api/` **Arquivo**: `bridge-tasks.js` **LOC**: 128 | **Score**: 8.3/10

## Responsabilidade

Rotas de tarefas do agente:

- `POST /send` — enfileira mensagem, opcional `waitForResponse=true` para resposta síncrona
- `POST /answer` — responde `question.pending` do modelo

## Achados

### P4 — Falso `ok:true` quando `sendMessage` rejeita com QUEUE_FULL após checagem (TOCTOU + silent swallow) **[FIXED]**

**Localização**: `bridge-tasks.js:81-92` — check de fila +
`agent.sendMessage(...).catch(e => log(...))`

**Descrição**: O `GAP-03 fix` verifica `queueSize >= maxQueueSize` antes de enfileirar — mas entre a
verificação e o `sendMessage()`, a fila pode encher (TOCTOU). Quando isso acontece, `sendMessage`
rejeita com `QUEUE_FULL` — mas o catch silenciosamente só loga. O cliente **já recebeu**
`{ ok: true, taskId }`, mas a mensagem foi descartada.

```js
// ATUAL — o catch swallows a falha silenciosamente
agent.sendMessage(message, { ..., taskId })
    .catch((e) => {
        log('WARN', `[bridge-tasks/send] Tarefa assíncrona falhou: ${e.message}`); // ← swallow!
    });
return res.json({ ok: true, taskId, message: 'Mensagem enfileirada.' }); // ← já enviado!
```

**Impacto**: O chamador perde rastreabilidade da mensagem — não houve entrega, mas não há como
saber. O `taskId` retornado nunca gerará eventos SSE.

**Sugestão**: Usar `waitForResponse=true` (preferred) para enfileiramento confiável, ou documentar
explicitamente que `waitForResponse=false` é fire-and-forget sem garantias de entrega.

---

### P5 — `randomUUID()` como `taskId` pode não coincidir com o taskId interno do agente

**Localização**: `bridge-tasks.js:88` — `const taskId = randomUUID()`

**Descrição**: O `taskId` gerado em `bridge-tasks.js` é passado ao agente via
`agent.sendMessage(message, { ..., taskId })`. Se o agente ignorar o `taskId` externo e gerar o seu
próprio internamente, o `taskId` retornado ao cliente não corresponde aos eventos SSE
(`task.queued`, `task.completed`), tornando o rastreamento ineficaz.

**Status**: Depende de `AlwaysAliveAgent.sendMessage` honrar o `taskId` passado como opção.

---

### P5 — `POST /send` sem limite de tamanho na mensagem

**Localização**: `bridge-tasks.js:50` — validação: `!message || typeof message !== 'string'`

**Descrição**: Nenhum limite máximo de caracteres é verificado para `message`. Uma palyload muito
grande pode causar pressão de memória no agente. Express não tem limite default no app (depende de
`bodyParser` configurado no router pai).

---

## Destaques Positivos

- `G2-API-06`: AbortController para cancelar tarefa em timeout no modo `waitForResponse=true`
- `GAP-03`: verificação proativa de fila cheia antes de retornar `ok:true` (mitigação parcial)
- `G2-API-07`: retorno de `taskId` para correlação SSE
- Input validation na mensagem AND na resposta (`answer`)
- Status 504 para timeout, 429 para QUEUE_FULL, 409 para pergunta não pendente — semântica HTTP
  correta

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
