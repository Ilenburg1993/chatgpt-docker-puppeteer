---
name: llm-b-comms
description: >-
  Protocolo oficial de comunicação de LLM-A com LLM-B via Terminal Permanente. Cobre como
  inicializar o terminal, verificar saúde, enviar mensagens, interpretar respostas, e lidar com
  todos os casos especiais (terminal offline, loop não pronto, ocupado, stall etc.). Use quando
  precisar se comunicar com LLM-B, verificar seu estado, ou quando as instruções de comunicação
  LLM-A ↔ LLM-B não estiverem claras.
user-invocable: true
---

# LLM-B Comms — Protocolo Oficial de Comunicação LLM-A → LLM-B

## Visão Geral

A LLM-B é um agente de raciocínio contínuo que opera em um **Terminal Permanente** (processo Node.js
separado, porta 3009). A comunicação se dá **exclusivamente via HTTP** usando o arquivo
`src/copilot/channel/inject.js` (ou seu equivalente de API pública em
`src/copilot/channel/index.js`).

**Regra fundamental**: Você (LLM-A) NUNCA fala diretamente com a LLM-B — toda comunicação é
intermediada pelo Terminal Permanente ativo na porta 3009.

---

## Passo 1: Verificar se o Terminal está Ativo

Antes de qualquer comunicação, verifique se o terminal está rodando:

```javascript
import { checkLlmBHealth } from '#copilot/channel';
// ou diretamente:
// import { checkLlmBHealth } from './src/copilot/channel/inject.js';

const health = await checkLlmBHealth();
// health = { ok: boolean, ready: boolean, busy: boolean, hubSessionId: string|null, agentStatus: string }
```

Interpretação:

- `ok: false` → Terminal offline. Precisa ser iniciado antes de qualquer comunicação.
- `ok: true, ready: false` → Terminal online mas dialog loop não inicializado ainda. Use
  `waitForLlmBReady()`.
- `ok: true, ready: true, busy: false` → Pronto para receber mensagem.
- `ok: true, ready: true, busy: true` → Ocupado processando outra mensagem. `injectToLlmB()` tentará
  automaticamente (retry com backoff).

---

## Passo 2: Iniciar o Terminal (se necessário)

> **CRÍTICO — Regra de inicialização**: O terminal **DEVE** ser sempre iniciado via **Task do VS
> Code** (`terminal:llm-b`), não via `run_in_terminal` com `isBackground=true`. Apenas a task abre
> um painel visível para o usuário. Rodar em background oculto priva o usuário do terminal
> interativo.

**No VSCode** (método recomendado — integração nativa com workspace):

Usar a Task VSCode criada especificamente para isso:

```
Ctrl+Shift+P → "Tasks: Run Task" → "terminal:llm-b"
```

Ou pelo painel de tasks (Explorer → Run and Debug não — usar Terminal → Run Task).

O VSCode abrirá um painel dedicado chamado "Terminal LLM-B" e aguardará o pattern `LLM-B pronta` no
output antes de marcar a task como concluída.

**Via linha de comando direta**:

```bash
npm run terminal:llm-b
```

**Via PM2 (produção)**:

```bash
COPILOT_TERMINAL_ENABLED=true npx pm2 start ecosystem.config.cjs --only llm-b-terminal
```

**Verificar se já está rodando**:

```bash
curl -s http://127.0.0.1:3009/health | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d))"
```

---

## Passo 3: Aguardar Prontidão (se acabou de iniciar)

```javascript
import { waitForLlmBReady } from '#copilot/channel';
// Espera até 30s (padrão) pelo dialog loop ficar ativo
await waitForLlmBReady({ maxWaitMs: 30_000, pollIntervalMs: 2_000 });
```

---

## Passo 4: Enviar Mensagem e Receber Resposta

### Caso simples (mensagem única):

```javascript
import { injectToLlmB } from '#copilot/channel';

const result = await injectToLlmB(
  'Analise o arquivo src/copilot/agent/always-alive.js e identifique possíveis race conditions.',
);
// result = { ok: true, reply: "...", durationMs: 18500, from: "llm-a" }

console.log(result.reply); // resposta completa da LLM-B
console.log(result.durationMs); // ex: 18500 (esperado: 15-25s por turno)
```

### Com attachments (arquivos):

```javascript
import { injectToLlmB } from '#copilot/channel';
import { readFileSync } from 'node:fs';

// Método 1: embed o conteúdo diretamente na mensagem (recomendado para arquivos pequenos)
const code = readFileSync('src/copilot/agent/always-alive.js', 'utf-8');
const result = await injectToLlmB(
  `Analise este arquivo e identifique todos os métodos que emitem eventos:\n\n\`\`\`js\n${code}\n\`\`\``,
);

// Método 2: usar o campo attachments (API do Copilot SDK — para arquivos via SDK)
// (somente quando executando dentro do contexto do Copilot SDK)
```

### Pipeline (sequência de mensagens):

```javascript
import { injectPipeline } from '#copilot/channel';

const { ok, results } = await injectPipeline([
  { prompt: 'Você está disponível para uma análise longa?' },
  {
    prompt:
      'Analise todas as classes em src/copilot/agent/ e liste os eventos emitidos por cada uma.',
    waitMs: 2000,
  },
  { prompt: 'Agora, identifique possíveis vazamentos de listeners (missing off() calls).' },
  { prompt: 'Gere um resumo executivo com os 3 problemas mais críticos encontrados.' },
]);

for (const r of results) {
  console.log(`Step ${r.step}: ${r.prompt.slice(0, 50)}...`);
  console.log(`Resposta (${r.durationMs}ms): ${r.reply.slice(0, 200)}...`);
}
```

---

## Passo 5: Observar Eventos em Tempo Real (opcional)

Para monitorar respostas da LLM-B sem bloquear:

```javascript
import { subscribeLlmB } from '#copilot/channel';

const sub = subscribeLlmB((evt) => {
  switch (evt.type) {
    case 'reply':
      console.log('[LLM-B]', evt.data.content);
      break;
    case 'ready':
      console.log('[LLM-B] Pronta para próxima mensagem');
      break;
    case 'stalled':
      console.warn('[LLM-B] Dialog loop travado — watchdog vai reiniciar');
      break;
    case 'busy':
      console.log('[LLM-B] Ocupada:', evt.data.busy);
      break;
  }
});

// Após uso:
sub.unsubscribe();
```

Para apenas eventos críticos (stall, fatal, system) sem overhead de replies:

```javascript
import { subscribeLlmBCritical } from '#copilot/channel';
const sub = subscribeLlmBCritical((evt) => {
  /* ... */
});
```

---

## Tratamento de Erros

| Código de Erro           | Causa                                           | Ação                                                |
| ------------------------ | ----------------------------------------------- | --------------------------------------------------- |
| `LLM_B_TIMEOUT`          | Resposta demorou > `timeoutMs` (padrão: 130s)   | Aumentar `timeoutMs` ou dividir a pergunta          |
| `LLM_B_BUSY`             | LLM-B ocupada após todos os retries (padrão: 3) | Aguardar e tentar novamente; aumentar `retries`     |
| `LLM_B_UNAVAILABLE`      | Terminal não está rodando (503)                 | Iniciar o terminal: `npm run terminal:llm-b`        |
| `LLM_B_NOT_READY`        | Dialog loop não ficou pronto em tempo           | Verificar logs do terminal; reiniciar se necessário |
| `LLM_B_ERROR`            | Erro interno na execução do turno               | Verificar logs: `logs/llm-b-terminal-error.log`     |
| `LLM_B_INVALID_RESPONSE` | Resposta não é JSON válido                      | Bug no terminal — verificar versão do código        |

```javascript
import { injectToLlmB } from '#copilot/channel';

try {
  const result = await injectToLlmB('Sua pergunta aqui', {
    timeoutMs: 180_000, // 3 minutos para perguntas complexas
    retries: 5, // tentar até 5 vezes se ocupado
    retryDelayMs: 2_000, // 2s, 4s, 6s, 8s, 10s de espera
  });
  console.log(result.reply);
} catch (err) {
  if (err.code === 'LLM_B_UNAVAILABLE') {
    console.error('Terminal LLM-B offline. Execute: npm run terminal:llm-b');
  } else if (err.code === 'LLM_B_TIMEOUT') {
    console.error('LLM-B demorou para responder. Tente dividir a pergunta.');
  } else {
    console.error('Erro inesperado:', err.message, err.code);
  }
}
```

---

## Referência Rápida de Endpoints HTTP (sem SDK)

Use `curl` para testes ou debug direto:

```bash
# Verificar saúde
curl -s http://127.0.0.1:3009/health | jq .

# Enviar mensagem
curl -s -X POST http://127.0.0.1:3009/inject \
  -H 'Content-Type: application/json' \
  -d '{"message": "Sua pergunta aqui", "from": "llm-a"}' | jq .

# Pipeline
curl -s -X POST http://127.0.0.1:3009/pipeline \
  -H 'Content-Type: application/json' \
  -d '{"steps": [{"prompt": "Pergunta 1"}, {"prompt": "Pergunta 2", "waitMs": 1000}], "from": "llm-a"}' | jq .

# Listar sessões do hub
curl -s 'http://127.0.0.1:3009/sessions?limit=5' | jq .

# Turnos de uma sessão
curl -s 'http://127.0.0.1:3009/sessions/<SESSION_ID>/turns?limit=20' | jq .

# Memórias semânticas
curl -s -X POST http://127.0.0.1:3009/memory \
  -H 'Content-Type: application/json' \
  -d '{"tag": "arquitetura", "content": "O AlwaysAliveAgent usa EventEmitter e tem dialog loop permanente."}' | jq .

curl -s 'http://127.0.0.1:3009/memory?tag=arquitetura' | jq .

# Configuração atual
curl -s http://127.0.0.1:3009/config | jq .

# Git status via terminal LLM-B
curl -s http://127.0.0.1:3009/git/status | jq .

# GitHub issues
curl -s 'http://127.0.0.1:3009/gh/issues?state=open&limit=10' | jq .

# Eventos SSE (streaming)
curl -N http://127.0.0.1:3009/events
curl -N 'http://127.0.0.1:3009/events?level=critical'
```

---

## Arquitetura do Sistema

```
LLM-A (você, Copilot)
    │
    │  import { injectToLlmB } from '#copilot/channel'
    │  POST http://127.0.0.1:3009/inject
    ▼
Terminal Permanente LLM-B (processo separado: npm run terminal:llm-b)
    │
    │  src/copilot/terminal/server.js     ← servidor HTTP raw (porta 3009)
    │  src/copilot/terminal/http-handlers.js  ← lógica de handlers
    │  src/copilot/terminal/dialog.js     ← sendTurn() + ensureDialogLoop()
    │  src/copilot/channel/client.js      ← llmBridgeClient.dialogTurn()
    │  src/copilot/agent/always-alive.js  ← AlwaysAliveAgent + dialog loop
    │
    │  sendDialogTurn(message)
    ▼
AlwaysAliveAgent → answerPendingQuestion(message) → Copilot SDK ask_user()
    │
    ▼
LLM-B (modelo: gpt-5-mini, reasoning: high)
    │
    │  ask_user("REPLY: <resposta>")
    ▼
AlwaysAliveAgent → emit('dialog.reply', { reply }) → sendTurn() resolve
    │
    ▼
HTTP /inject response: { ok: true, reply: "...", durationMs: ... }
    │
    ▼
LLM-A recebe a resposta
```

### Dialog Loop Protocol (interno):

O dialog loop é a "linguagem" que LLM-B fala internamente com o sistema:

1. LLM-B chama `ask_user("READY: aguardando próxima mensagem")` → `dialog.ready` emitido
2. Sistema envia mensagem via `answerPendingQuestion(message)`
3. LLM-B processa e chama `ask_user("REPLY: <resposta>")` → `dialog.reply` emitido
4. Sistema captura o reply → resolve a Promise do `sendDialogTurn()`
5. Sistema envia `ask_user("READY: ...")` para o próximo turno → volta para passo 1

O loop é **eterno por design** (DL-PERM). O watchdog (padrão: stall em 15min de inatividade)
reinicia automaticamente se o loop travar.

---

## Variáveis de Ambiente Relevantes

| Variável                   | Padrão       | Descrição                                        |
| -------------------------- | ------------ | ------------------------------------------------ |
| `LLM_B_TERMINAL_PORT`      | `3009`       | Porta HTTP do terminal                           |
| `COPILOT_SDK_ENABLED`      | `false`      | **Obrigatório** `true` para o terminal funcionar |
| `COPILOT_MODEL`            | `gpt-5-mini` | Modelo usado pela LLM-B                          |
| `LLM_B_TURN_TIMEOUT_MS`    | `130000`     | Timeout por turno (130s)                         |
| `LLM_B_WATCHDOG_MS`        | `300000`     | Intervalo do watchdog (5min)                     |
| `LLM_B_WATCHDOG_STALL_MS`  | `900000`     | Stall threshold (15min)                          |
| `LLM_B_BOOT_PROMPT`        | (interno)    | Sobrescreve o boot prompt padrão                 |
| `COPILOT_TERMINAL_ENABLED` | `false`      | Habilita o terminal via PM2                      |

---

## Diagnóstico Rápido

Se algo não funciona, verificar nesta ordem:

```bash
# 1. Terminal está rodando?
curl -s http://127.0.0.1:3009/health | jq .ok

# 2. Dialog loop está ativo?
curl -s http://127.0.0.1:3009/health | jq .dialogLoopActive

# 3. Agente está iniciado?
curl -s http://127.0.0.1:3009/health | jq .agentStatus

# 4. Logs do terminal
tail -50 logs/llm-b-terminal-out.log
tail -50 logs/llm-b-terminal-error.log

# 5. Ver config atual
curl -s http://127.0.0.1:3009/config | jq .
```

---

## Boas Práticas

1. **Sempre verificar saúde antes de enviar**: `checkLlmBHealth()` é rápido (timeout 5s) e evita
   esperas longas se o terminal estiver offline.

2. **Mensagens longas**: Para análises profundas de código (múltiplos arquivos), use
   `injectPipeline()` dividindo em steps lógicos — a LLM-B tem contexto limitado e perguntas menores
   produzem respostas mais focadas.

3. **Timeouts**: Para análises complexas, definir `timeoutMs: 180_000` (3min). O padrão de 130s pode
   ser curtoPara respostas longas.

4. **Contexto**: Se precisar incluir arquivos, embuta o conteúdo diretamente na mensagem como bloco
   de código Markdown — é mais confiável que attachments.

5. **Sessão Hub**: Toda conversa é persistida automaticamente na hub_session. Use `GET /sessions` e
   `GET /sessions/:id/turns` para recuperar histórico.

6. **Não reiniciar o terminal sem necessidade**: O dialog loop é permanente e o watchdog cuida de
   restarts automáticos. Só reinicie manualmente se o terminal travar completamente.

7. **Rate limit**: `/inject` tem rate limit de 10 req/min por IP (padrão). Para injeções em lote,
   use `/pipeline` que trata internamente.
