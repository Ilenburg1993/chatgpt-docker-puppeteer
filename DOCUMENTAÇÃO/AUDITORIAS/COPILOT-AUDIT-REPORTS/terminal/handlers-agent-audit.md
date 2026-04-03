# Auditoria — `handlers-agent.js`

**Módulo**: `src/copilot/terminal/handlers-agent.js` **LOC**: 245 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Handlers para endpoints de interação com o agente LLM-B:

- `/inject` — envia mensagem com contexto de arquivos e attachments
- `/pipeline` — executa sequência de turns com `waitMs` entre steps
- `/context` — retorna estado atual da janela de contexto
- `/dialog/pause` e `/dialog/resume` — controle do dialog loop

---

## 2. Fluxo de `/inject`

```
handleInject(body)
 ├── validação de 'from' em ALLOWED_FROM
 ├── context_files → embedMultiple(ctxObjs, body.message)
 │    └── readFileContext(filePath) por arquivo
 ├── attachments → Promise.all(rawAttachments.map(attachmentToEmbed))
 │    └── embed combinado < MAX_EMBED_BYTES total
 └── sendTurn(enrichedMessage, from)
```

---

## 3. Achados

### FINDING-P4-1 — `handlePipeline`: `waitMs` sem limite superior **[FIXED]**

**Severidade**: P4 — Médio **→ CORRIGIDO** (2026-06-XX) **Localização**: `handlePipeline()` linhas
~110-140

**Fix aplicado**: adicionado `MAX_WAIT_MS = 30_000` e `Math.min(step.waitMs ?? 0, MAX_WAIT_MS)` para
limitar o wait máximo por step a 30 segundos.

```js
for (const step of steps) {
    if (step.waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, step.waitMs));
    }
    ...
}
```

O `waitMs` não tem validação de limite máximo. Um step com `waitMs: 9_999_999_999` travaria a
execução por ~115 dias, consumindo a conexão HTTP indefinidamente e bloqueando o processamento de
outros turns do agente (porque o pipeline ocupa `sendTurn`).

**Proposta**:

```js
const MAX_WAIT_MS = 30_000;
const wait = Math.min(step.waitMs ?? 0, MAX_WAIT_MS);
if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
```

---

### FINDING-P4-2 — Attachment errors mascarados como strings inline **[FIXED]**

**Severidade**: P4 — Baixo **→ CORRIGIDO** (2026-06-XX) **Localização**: `handleInject()` linhas
~180-200

**Fix aplicado**: bloco `Promise.all(rawAttachments.map(attachmentToEmbed))` agora envolto em
try/catch que retorna `status:400` com mensagem explícita se qualquer attachment falhar
inesperadamente.

```js
const embeds = await Promise.all(
  rawAttachments.map(async (att) => {
    try {
      return await attachmentToEmbed(att);
    } catch (err) {
      return `*(arquivo não lido: ${att.path ?? att.type})*`;
    }
  }),
);
```

Se um attachment falha (arquivo removido, permissão negada), a mensagem recebe um placeholder
`*(arquivo não lido: ...)*` mas o request continua e a LLM recebe a mensagem incompleta sem aviso
explícito para o chamador. O response body de `/inject` por convenção retorna `{ok: true}`. O caller
não sabe que parte do contexto estava ausente.

**Proposta**: incluir campo `warnings` no response body:

```js
const warnings = [];
const embeds = await Promise.all(
  rawAttachments.map(async (att) => {
    try {
      return await attachmentToEmbed(att);
    } catch (err) {
      warnings.push({ path: att.path ?? att.type, error: err.message });
      return `*(arquivo não lido: ${att.path ?? att.type})*`;
    }
  }),
);
// No response:
return { status: 200, body: { ok: true, warnings: warnings.length ? warnings : undefined } };
```

---

### FINDING-P5-3 — `ALLOWED_FROM` contém ambas formas `'llm-a'` e `'llm_a'`

**Severidade**: P5 — Cosmético **Localização**: linhas ~25-30

```js
const ALLOWED_FROM = new Set(['llm-a', 'user', 'system', 'llm_a']);
```

`'llm_a'` e `'llm-a'` são formas diferentes do mesmo remetente. Isso indica que algum caller usa
underscore e outro usa hífen sem normalização. O Set é funcional mas sugere inconsistência no
protocolo upstream.

**Proposta**: normalizar via canonicalize antes da validação:

```js
const raw = body.from ?? 'user';
const from = raw.replace(/_/g, '-'); // canonicaliza llm_a → llm-a
const ALLOWED_FROM = new Set(['llm-a', 'user', 'system']);
```

---

## 4. Pontos positivos

- Validação de `from` com Set antes de propagar — previne injection de actor inválido.
- `handleGetContext` retorna `warningLevel` (`none`/`moderate`/`high`/`critical`) — bom para
  dashboard.
- `MAX_PIPELINE_STEPS = 20` — limita pipelines excessivos.
- `handlePipeline` para em step com `null` reply com `{ok: false, ...}` — fail-fast correto.
- Separação entre `context_files` (embed via `readFileContext`) e `attachments` (via
  `attachmentToEmbed`): suporta dois fluxos de injeção independentes — clean design.

---

## 5. Score

| Dimensão           | Nota       |
| ------------------ | ---------- |
| Correção lógica    | 9.0/10     |
| Segurança de input | 8.5/10     |
| Feedback ao caller | 8.0/10     |
| **Global**         | **8.5/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
