# channel/inject.js — Auditoria

**Módulo**: `src/copilot/channel/` **Arquivo**: `inject.js` **LOC**: 488 | **Score**: 8.8/10

## Responsabilidade

API oficial de injeção de mensagens de LLM-A para LLM-B via HTTP (`127.0.0.1:3009`). Implementa
quatro funções públicas:

- `checkLlmBHealth(opts)` — GET /health
- `injectToLlmB(message, opts)` — POST /inject com retry em 409
- `waitForLlmBReady(opts)` — polling de /health
- `injectPipeline(steps, opts)` — POST /pipeline para sequência de prompts
- `subscribeLlmB(onEvent, opts)` / `subscribeLlmBCritical(...)` — SSE /events

## Achados

### P5 — SSE buffer sem limite máximo (inject.js: \_subscribeSse)

**Localização**: `_subscribeSse` → `let buf = ''` acumulando em `res.on('data')`

**Descrição**: O buffer SSE cresce sem limite enquanto o servidor não enviar um bloco `\n\n`. O 2 MB
de limite aplica-se à resposta HTTP normal (`httpRequest`), mas não ao stream SSE. Um servidor mal-
configurado ou stalled que emita dados sem delimitadores pode causar crescimento ilimitado de `buf`.

**Impacto**: Consumo de memória proporcional ao tempo de stall do servidor SSE. Em prática, o
terminal server está bem configurado.

**Sugestão**: Adicionar `MAX_BUF_BYTES = 64 * 1024` e truncar/encerrar quando excedido.

---

### P5 — `httpRequest` não suporta HTTPS

**Localização**: `inject.js:72` — usa `node:http` direto

**Descrição**: O helper `httpRequest` usa apenas `http://` (127.0.0.1). Se a porta do terminal mudar
para HTTPS no futuro, ou se `LLM_B_TERMINAL_PORT` apontar para um servidor remoto, a comunicação
falha silenciosamente ao tentar TLS.

**Mitigação atual**: `127.0.0.1` via loopback não requer HTTPS — adequado para o uso atual.

**Sugestão**: Documentar explicitamente que o módulo é restrito ao loopback.

---

## Destaques Positivos

- **BUG-N06 fix**: limite de 2 MB para respostas HTTP (evita acúmulo irrestrito)
- **INJECT-01**: retry automático em 409 LLM_B_BUSY com backoff linear (1.5s × tentativa)
- **MR-09**: reconexão SSE com backoff exponencial (1s→2s→...→30s) após desconexão
- **SSE-INJECT-01**: parser por blocos `\r?\n\r?\n` (RFC 8895) com suporte a múltiplas linhas
  `data:`
- Timeout configável por chamada; timeout default derivado de `LLM_B_TURN_TIMEOUT_MS`
- `_doInjectToLlmB` privada — separação correta entre retry logic e single-attempt

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._

---

## Status de Correção (2026-04-03)

### [FIXED] LEAK-CHAN-001 (P3) — Buffer SSE com limite de tamanho 256 KB

inject.js: adicionado MAX_BUF_BYTES = 256 \* 1024 com descarte de chunks quando buf + chunk >
limite. Loop de streaming com consumidor lento não causa mais crescimento ilimitado de buffer.

**Pontuação atualizada: 8.5/10**
