# AUDIT_ATTACHMENTS_V1 — Auditoria e Refatoração do Canal de Attachments LLM-A/B

**Data**: 2026-03-27 → atualizado 2026-03-27
**Autor**: GitHub Copilot (LLM-A)
**Status**: IMPLEMENTADO — `ATT-01`, `ATT-02`, `ATT-04` (zero-PR), `BUG-A`, `DL-PERM` — ATT-03 REVOGADO
**Nota**: ATT-03 foi revogado pois criava novas PRs via `sendMessage()`, violando a política zero-PR.
**Commit**: (a ser preenchido após push)
**Pré-condição**: `dcc72c80` (TERM-01/02 + GAP-4 + INJECT-01)

---

## 1. Escopo da investigação

Análise completa do fluxo de attachments nos dois sentidos (usuário → LLM-B e LLM-A → LLM-B) com foco em:

- Unificação do bifurcamento `nativeAttachments` vs dialog loop
- Correção de bugs de concorrência e gerenciamento de estado
- Garantia de exclusão mútua independente do caminho de execução

### Arquivos analisados

| Arquivo                                   | Papel                                        |
| ----------------------------------------- | -------------------------------------------- |
| `src/copilot/terminal/commands/attach.js` | Comando `/attach` do usuário                 |
| `src/copilot/terminal/file-context.js`    | Leitura, cache e embed de arquivos           |
| `src/copilot/terminal/state.js`           | `_attachmentQueue`, busy flag                |
| `src/copilot/terminal/dialog.js`          | Motor de diálogo, `sendTurn`, `_executeTurn` |
| `src/copilot/terminal/http-handlers.js`   | `handleInject` — parsing e dispatch          |
| `src/copilot/channel/inject.js`           | API pública `injectToLlmB()`                 |
| `src/copilot/agent/always-alive.js`       | `sendMessage()`, `sendDialogTurn()`          |
| `src/copilot/channel/client.js`           | `LlmBridgeClient`, `dialogTurn()`            |

---

## 2. Arquitetura de attachments pré-refatoração

### Três fontes distintas

```
Flow 1: Usuário terminal
  /attach file.js → _attachmentQueue → _executeTurn → readFileContext → embedMultiple → enrichedMessage

Flow 2: HTTP /inject com attachments nativos (nativeAttachments)
  POST /inject { attachments: [...] }
    → handleInject → tipo file/directory/selection → nativeAttachments[]
    → (FORA da fila sendTurn) → alwaysAliveAgent.sendMessage() direto

Flow 3: HTTP /inject com attachments de conteúdo (inline)
  POST /inject { attachments: [{ type: 'content', content: '...' }] }
    → handleInject → embed como markdown → enrichedMessage
    → sendTurn() (dentro da fila)
```

### Problemas identificados

#### BUG-1 (ATT-03): `nativeAttachments` bypassava o mutex de serialização

O caminho para attachments nativos SDK (`type: file|directory|selection`) em `handleInject` chamava `alwaysAliveAgent.sendMessage()` **diretamente**, fora do `_sendTurnMutex`. Isso criava duas "filas" paralelas e potencial de race condition com o dialog loop.

**Pré-refatoração** (http-handlers.js):
```js
if (nativeAttachments.length > 0) {
    // FORA da fila serializada — race condition potencial
    if (getBusy()) { return 409; }
    setBusy(true);
    try {
        reply = await alwaysAliveAgent.sendMessage(enrichedMessage, { attachments: nativeAttachments });
    } finally {
        setBusy(false);
    }
} else {
    reply = await sendTurn(enrichedMessage, from);  // dentro da fila
}
```

#### BUG-A: Mensagem de erro do pipeline incorreta

`handlePipeline` retornava `"LLM-B ocupada — pipeline interrompido"` quando `sendTurn` retornava `null`. Com TERM-01 (Promise-chain mutex), `null` já não significa "busy" — significa erro interno. A mensagem induzia ao erro.

#### ATT-01/02 (informativo): `dialogTurn` e `sendDialogTurn` não suportam attachments

O protocolo `ask_user` do dialog loop é baseado em strings — não há como passar file attachments nativos SDK via esse protocolo. Isso é uma **limitação de design do SDK**, não um bug. O caminho correto para attachments nativos é sempre via `sendMessage()` (nova PR).

---

## 3. Mudanças implementadas

### ATT-03 — Unificação via `sendTurn()` com `nativeAttachments`

**`src/copilot/terminal/dialog.js`**:

`sendTurn()` e `_executeTurn()` agora aceitam `nativeAttachments` opcional como terceiro parâmetro. Internamente, `_executeTurn` decide o caminho baseado na presença de attachments:

```js
// NOVO: sendTurn unificado
export function sendTurn(message, actor = 'user', nativeAttachments) {
    // backpressure, incrementa _turnQueueDepth
    _turnQueueDepth++;
    const next = _sendTurnMutex.then(() => _executeTurn(message, actor, nativeAttachments)).catch(() => null);
    _sendTurnMutex = next.then(() => null, () => null);
    void next.finally(() => { _turnQueueDepth--; });
    return next;
}

async function _executeTurn(message, actor, nativeAttachments) {
    // ... enriquecimento, setBusy, broadcastSse (invariante mantido)
    if (nativeAttachments && nativeAttachments.length > 0) {
        // Path SDK nativo — sendMessage() abre nova PR com file attachments reais
        reply = await alwaysAliveAgent.sendMessage(enrichedMessage, { attachments: nativeAttachments });
    } else {
        // Path dialog loop — eficiente, zero PRs extras
        await ensureDialogLoop();
        reply = await llmBridgeClient.dialogTurn(enrichedMessage, { timeout: TURN_TIMEOUT_MS });
    }
}
```

**Benefícios:**
- Um único mutex serializa todos os turnos (texto puro, attachments inline e nativos)
- `setBusy(true/false)` gerenciado em um único lugar (`_executeTurn`)
- `broadcastSse('busy', ...)` sempre chamado independente do path
- Hub session tracking funciona para ambos os caminhos

**`src/copilot/terminal/http-handlers.js`**:

`handleInject` simplificado — remove `getBusy()/setBusy()` manual e bifurcamento:

```js
// NOVO: um único ponto de despacho
const reply = await sendTurn(
    enrichedMessage,
    from,
    nativeAttachments.length > 0 ? nativeAttachments : undefined
);
```

`setBusy` removido dos imports de `state.js`.

### BUG-A — Mensagem de erro do pipeline corrigida

```js
// ANTES: "LLM-B ocupada — pipeline interrompido" (incorreto com TERM-01)
// DEPOIS: "erro interno na LLM-B — pipeline interrompido"
error: `Step ${i + 1} retornou null (erro interno na LLM-B) — pipeline interrompido`,
```

### Testes atualizados (Suite 2)

Os testes `TERM-02` foram substituídos pela suite `ATT-03: análise estrutural`, com 4 testes verificando o novo contrato:
1. `http-handlers.js` não importa mais `setBusy`
2. `sendTurn()` recebe `nativeAttachments` como terceiro argumento
3. `handleInject` não chama `alwaysAliveAgent.sendMessage()` diretamente
4. Guard `nativeAttachments.length > 0` presente antes de passar para `sendTurn`

3 novos testes adicionados em Suite 1 (dialog.js):
- `sendTurn` aceita `nativeAttachments` como terceiro parâmetro
- `_executeTurn` usa `sendMessage` quando `nativeAttachments` presentes
- `_executeTurn` usa `dialogTurn` quando `nativeAttachments` ausentes

---

## 4. Resultado dos testes

```
Tests: 769 pass, 0 fail
Lint:  0 warnings, 0 errors
Type:  0 errors
```

---

## 5. Fluxo pós-refatoração

```
sendTurn(message, actor, nativeAttachments?)
  │
  ├─ backpressure ok? → _sendTurnMutex (único mutex para todos os paths)
  │
  └─ _executeTurn(message, actor, nativeAttachments?)
       ├─ enriquece mensagem (_attachmentQueue + plan mode)
       ├─ setBusy(true) + broadcastSse('busy', true)
       │
       ├─ nativeAttachments.length > 0?
       │   YES → alwaysAliveAgent.sendMessage() [nova PR, file attachments nativos]
       │   NO  → ensureDialogLoop() + llmBridgeClient.dialogTurn() [dialog loop]
       │
       └─ setBusy(false) + broadcastSse('busy', false)
```

---

## 7. Revisão arquitetural — ATT-04 (zero-PR) e DL-PERM

### 7.1 Problema identificado em ATT-03

ATT-03 foi revogado porque criava um novo "Premium Request" (PR) via `alwaysAliveAgent.sendMessage()` quando
attachments nativos SDK estavam presentes. Isso violava o princípio de "ficar sempre dentro do dialog loop `ask_user`".

**Billing model do SDK:**
- `session.send()` / `sendAndWait()` = **nova PR** (billable)
- Resposta ao `ask_user` = **dentro da PR existente** (sem custo adicional)
- Dialog loop: **1 PR total** para toda a conversa via protocolo `ask_user`

**Limitação do SDK**: `UserInputResponse` aceita apenas `{ answer: string, wasFreeform: bool }` — não há como passar
attachments nativos ao modelo via `ask_user`. A única solução compatível com zero-PR é converter todos os attachment
types em texto markdown embeddado.

### 7.2 ATT-04: Arquitetura zero-PR

**Princípio**: todos os attachment types são resolvidos em Node.js para texto markdown antes de enviar ao modelo.

```
POST /inject { attachments: [...] }
  → handleInject
  → attachmentToEmbed(att) para cada attachment:
      type 'file'      → readFileContext(path) → bloco markdown com conteúdo do arquivo
      type 'directory' → readDirectoryContext(path) → blocos para cada arquivo do dir
      type 'selection' → att.text como bloco markdown fenced
      type 'content'   → att.content como bloco markdown
  → enrichedMessage = embed blocks + mensagem original
  → sendTurn(enrichedMessage, from)  ← caminho ÚNICO, sem nativeAttachments
  → _executeTurn → dialogTurn() ← dialog loop, zero nova PR
```

**Novo helper em `file-context.js`:**
- `readDirectoryContext(dirPath)` — lê arquivos de um diretório (shallow), respeitando `MAX_EMBED_BYTES`
- `attachmentToEmbed(att)` — dispatcher universal que roteia qualquer tipo para o embed correto

**sendTurn() simplificado**: assinatura `(message, actor)` — sem `nativeAttachments`. Sempre usa dialog loop.

### 7.3 DL-PERM: Dialog loop permanente

**Princípio**: a LLM-B NUNCA deve encerrar o dialog loop sem autorização explícita do usuário.

**Implementação:**

1. **`stopDialogLoop({ authorized? })`** — por padrão recusa o encerramento (apenas loga aviso). Requer
   `{ authorized: true }` para encerrar efetivamente.

2. **`#handleUserInputRequest` — handler STOPPED**: quando o modelo emite `STOPPED`/`STOP_DIALOG`, o sistema NÃO
   encerra mais o loop — apenas emite `dialog.stopped` com `authorized: false`. O listener em `terminal/index.js`
   escuta este evento e reinicia automaticamente via `ensureDialogLoop()`.

3. **`/dialog/stop` endpoint** — protegido por `{ force: true }` no body. Sem force, retorna HTTP 403 explicando
   a política DL-PERM. Com force, delega para `stopDialogLoop({ authorized: true })`.

4. **`LlmBridgeClient.stopDialogMode()`** — delega para `stopDialogLoop({ authorized: true })` pois é chamado
   apenas pelo watchdog (restart legítimo de saúde do sistema).

**Vetores de encerramento autorizados:**
- Watchdog de stall → `llmBridgeClient.stopDialogMode()` → restart (não encerra permanentemente)
- `dialog.stopped` não autorizado → reinicia automaticamente via `ensureDialogLoop()`
- `POST /dialog/stop { force: true }` → encerra permanentemente (apenas com autorização do usuário)

**Vetores bloqueados:**
- Modelo responde `STOPPED` por iniciativa própria → `authorized: false` → restart automático
- `POST /dialog/stop` sem `{ force: true }` → 403 Forbidden
- `alwaysAliveAgent.stopDialogLoop()` sem `{ authorized: true }` → log WARN, retorna sem ação

