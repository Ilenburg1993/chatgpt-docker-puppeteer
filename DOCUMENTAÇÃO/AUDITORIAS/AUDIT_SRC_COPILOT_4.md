# AUDITORIA TÉCNICA — src/copilot — Rodada 4

**Data:** 2026-07-16 **Escopo:** Leitura integral de todos os arquivos JS/MJS em `src/copilot/` (~95
arquivos, ~22 000 linhas) **Autor:** GitHub Copilot (Claude Sonnet 4.6) **Base:** pós-commit
`adfd3fab` (sync total pós AUDIT-C3 + UPG-01…10)

---

## Índice

1. [Resumo Executivo](#resumo-executivo)
2. [BUG — Bugs confirmados](#bug--bugs-confirmados)
3. [SEC — Vulnerabilidades de segurança](#sec--vulnerabilidades-de-segurança)
4. [ARCH — Problemas arquiteturais](#arch--problemas-arquiteturais)
5. [PERF — Gargalos de desempenho](#perf--gargalos-de-desempenho)
6. [GAP — Funcionalidades ausentes/incompletas](#gap--funcionalidades-ausentesincompletas)
7. [QUAL — Qualidade de código](#qual--qualidade-de-código)
8. [UPG — Upgrades e melhorias propostas](#upg--upgrades-e-melhorias-propostas)
9. [Matriz de Prioridade](#matriz-de-prioridade)

---

## Resumo Executivo

Esta auditoria cobriu todos os arquivos de `src/copilot/` em profundidade. O módulo apresenta boa
engenharia geral — JSDoc robusto, uso consistente de ESM, ausência de shell-injection nas bridges,
padrões de serialização corretos (mutex Promise-chain, circuit breaker no MCP bridge). No entanto,
foram identificados **87 itens** distribuídos em bugs críticos, falhas de segurança, lacunas
arquiteturais e oportunidades de melhoria significativas.

### Destaques críticos

| ID       | Tipo        | Arquivo               | Impacto                                                    |
| -------- | ----------- | --------------------- | ---------------------------------------------------------- |
| BUG-N01  | BUG CRÍTICO | `tools/code-tools.js` | `execSync` bloqueia event loop até 120s                    |
| SEC-N01  | SEC ALTA    | `terminal/server.js`  | Sem limite de tamanho no body → DoS                        |
| ARCH-N01 | ARCH ALTA   | `tools/hook-tools.js` | `request_user_input` não suspende o SDK — simulação falsa  |
| PERF-N01 | PERF ALTA   | `tools/code-tools.js` | Todas as 3 tool de qualidade são bloqueantes               |
| GAP-N01  | GAP ALTA    | `terminal/server.js`  | Rate-limit só em `/inject`, não em `/pipeline` e `/memory` |

---

## BUG — Bugs confirmados

### BUG-N01 — `execSync` em `safeExec()` bloqueia o event loop

**Arquivo:** `src/copilot/tools/code-tools.js` (linhas 70–90) **Severidade:** CRÍTICO **Tipo:**
Blocking I/O

**Descrição:** A função `safeExec()` utilizada pelas três tools de qualidade (`lint_check`,
`run_tests`, `typecheck`) chama `execSync` com timeout de até 120 s. Durante esse período, **nenhuma
outra Promise, evento ou requisição HTTP pode ser processada**. O servidor terminal inteiro fica
pendente.

```js
// PROBLEMA:
const result = execSync(command, { timeout: 120_000, ... }); // bloqueia event loop
```

**Correção:** Migrar para `execFileAsync` + parsing manual de stdout/stderr.

```js
// SOLUÇÃO:
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

async function safeExecAsync(cmd, args, opts = {}) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    timeout: opts.timeoutMs ?? 60_000,
    maxBuffer: 4 * 1024 * 1024,
    cwd: opts.cwd,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
}
```

---

### BUG-N02 — `execFileSync` em `hook_get_audit_tail` bloqueia o event loop

**Arquivo:** `src/copilot/tools/hook-tools.js` (linha ~140) **Severidade:** MÉDIA **Tipo:** Blocking
I/O

**Descrição:** `hook_get_audit_tail` usa `execFileSync('tail', ...)` para ler o audit log. Embora
raro, um disco lento pode travar o event loop por centenas de ms.

**Correção:** Usar `execFileAsync('tail', ...)` com `.catch` para arquivo inexistente.

---

### BUG-N03 — `_injectRateLimiter` Map nunca é purgado

**Arquivo:** `src/copilot/terminal/server.js` (linha ~200) **Severidade:** MÉDIA **Tipo:** Memory
Leak

**Descrição:** O Map `_injectRateLimiter` armazena contadores de rate-limit por IP + hora. As
entradas nunca são removidas, mesmo após a janela de tempo expirar. Em instalações de longa duração
(PM2 uptime > semanas), o Map cresce indefinidamente.

```js
// PROBLEMA:
const _injectRateLimiter = new Map(); // nunca limpo
```

**Correção:**

```js
function pruneRateLimiter() {
  const nowBucket = Math.floor(Date.now() / 60_000);
  for (const [key] of _injectRateLimiter) {
    const bucket = Number(key.split(':')[1]);
    if (bucket < nowBucket - 1) _injectRateLimiter.delete(key);
  }
}
// Chamar pruneRateLimiter() ao final de cada verificação de rate-limit
```

---

### BUG-N04 — `#turnCounters` em orchestrator.js cresce sem poda

**Arquivo:** `src/copilot/conversation-hub/orchestrator.js` (linha ~80) **Severidade:** BAIXA
**Tipo:** Memory Leak progressivo

**Descrição:** O Map `#turnCounters` nunca remove entradas de sessões fechadas. Em sistemas com
muitas sessões criadas e encerradas (por exemplo, pelo hub de conversas ao longo de dias), o Map
acumula entradas mortas indefinidamente.

**Correção:**

```js
// No método closeSession():
this.#turnCounters.delete(hubSessionId);
```

---

### BUG-N05 — `#sendCount` em AlwaysAliveAgent perdido em crash

**Arquivo:** `src/copilot/agent/always-alive.js` (início de `#processQueue`) **Severidade:** BAIXA
**Tipo:** Dado inconsistente pós-falha

**Descrição:** `#sendCount` é persistido em `session-manager.writeState()` apenas no shutdown
gracioso. Se o processo for morto com SIGKILL (OOM, crash), as últimas N mensagens enviadas não são
contabilizadas.

**Correção:** Persistir incrementalmente (a cada mensagem enviada) com escrita atômica assíncrona
via `setImmediate`.

---

### BUG-N06 — Double-emit no SSE quando Socket.io `hubSessionId` é repetido

**Arquivo:** `src/copilot/terminal/dialog.js` (`broadcastSse`) **Severidade:** BAIXA **Tipo:**
Duplicação de evento

**Descrição:** Em `broadcastSse`, o Socket.io emite com `hubSessionId` do estado local. Se o
namespace `/copilot` estiver montado E um cliente SSE separado também conectado, clientes que ouvem
ambos recebem o evento duas vezes com payloads ligeiramente diferentes (SSE não tem `hubSessionId`;
Socket.io sim).

**Correção:** Incluir `hubSessionId` nos payloads SSE também para consistência entre os dois canais.

---

### BUG-N07 — Resposta SSE não tem limite de tamanho de conteúdo

**Arquivo:** `src/copilot/terminal/server.js` (`GET /events`) **Severidade:** BAIXA **Tipo:**
Potencial overflow de payload

**Descrição:** Eventos SSE não truncam `reply` antes de serializar. Uma resposta longa (decenas de
KB) pode aumentar a latência de escrita e impactar clientes SSE lentos.

**Correção:** Truncar `reply` a 8 KB nos payloads SSE (o cliente pode pedir o histórico completo via
`/history`).

---

### BUG-N08 — `readBody()` sem limite de tamanho em `terminal/server.js`

**Arquivo:** `src/copilot/terminal/server.js` (função `readBody`) **Severidade:** ALTA (duplica
SEC-N01 — item de segurança) **Tipo:** DoS por payload inflado

**Descrição:** A função `readBody` faz `data += chunk` sem verificar tamanho total, permitindo
payloads ilimitados. Descrito também em SEC-N01.

---

### BUG-N09 — `httpRequest` em `task-tools.js` não valida `statusCode`

**Arquivo:** `src/copilot/tools/task-tools.js` (handler de `get_tasks` e `add_task`) **Severidade:**
BAIXA **Tipo:** Erro silenciado

**Descrição:** `httpRequest` retorna a string da resposta sem verificar o status HTTP. Se o server
retornar `500`, o JSON é parseado como dados válidos, o que causa erros elétricos na tool.

**Correção:**

```js
const { statusCode, body } = await httpRequest(method, url, ...);
if (statusCode < 200 || statusCode >= 300) {
    return { tasks: [], error: `HTTP ${statusCode}` };
}
```

---

### BUG-N10 — `task-tools.js` retorna `httpRequest` como `Promise<string>` mas usa como objeto

**Arquivo:** `src/copilot/tools/task-tools.js` **Severidade:** BAIXA **Tipo:** Contrato de tipo
inconsistente

**Descrição:** A função `httpRequest` retorna `Promise<string>` mas no handler é usada diretamente
sem extrair `.body`. Não é bug de runtime pois o contrato real retorna string, e o parse funciona —
mas a assinatura local diferente de `channel/inject.js` causa confusão.

---

### BUG-N11 — Dialog loop não reinicia adequadamente após `STOPPED` espontâneo

**Arquivo:** `src/copilot/terminal/dialog.js` (`_doEnsureDialogLoop`) **Severidade:** BAIXA
**Tipo:** Falha de resiliência

**Descrição:** Se o modelo emite `STOPPED` espontaneamente (prompt de encerramento), o agente
detecta e chama `ensureDialogLoop`. Porém, a proteção `_ensureDialogLoopInFlight` não cobre o caso
em que o `AlwaysAliveAgent` ainda está em status `starting` (não `stopped` nem `idle`). Nesse caso,
a função retorna sem garantir que o loop está ativo.

---

### BUG-N12 — `readFileContentTool` lê arquivo inteiro em RAM antes de truncar

**Arquivo:** `src/copilot/tools/file-tools.js` (handler de `read_file_content`) **Severidade:**
BAIXA **Tipo:** Consumo excessivo de memória

**Descrição:**

```js
const raw = fs.readFileSync(resolved); // lê 100 MB inteiro em RAM
if (raw.length > MAX_CONTENT_BYTES) raw = raw.slice(0, MAX_CONTENT_BYTES);
```

Arquivos grandes (ex: logs de 500 MB) são carregados completamente em memória antes de truncar.

**Correção:** Usar `fs.createReadStream` com `end: MAX_CONTENT_BYTES - 1` para leitura partial.

---

### BUG-N13 — `injectToLlmB` usa `for..of` com `continue` depois de `return` impossível

**Arquivo:** `src/copilot/channel/inject.js` (loop de retry) **Severidade:** MÍNIMA **Tipo:** Código
morto

**Descrição:** O comentário `// TypeScript safety — loop acima sempre retorna ou lança` indica
código morto após o loop. O `throw` após o loop jamais é alcançado na prática. Sem impacto
funcional.

---

## SEC — Vulnerabilidades de segurança

### SEC-N01 — `readBody()` sem limite → DoS por payload gigante

**Arquivo:** `src/copilot/terminal/server.js` (função `readBody`) **Severidade:** ALTA **OWASP:**
A05 Security Misconfiguration

**Descrição:**

```js
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    }); // sem limite!
    req.on('end', () => resolve(data));
  });
}
```

Um atacante com acesso à porta 3009 pode enviar um payload de qualquer tamanho. O processo Node.js
pode ficar sem memória ou travar com um único request de 1 GB.

**Correção:**

```js
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(Object.assign(new Error('Payload too large'), { code: 'PAYLOAD_TOO_LARGE' }));
        return;
      }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
```

---

### SEC-N02 — Rate-limit em `terminal/server.js` cobre apenas `/inject`

**Arquivo:** `src/copilot/terminal/server.js` **Severidade:** MÉDIA **OWASP:** A04 Insecure Design

**Descrição:** O mecanismo de rate-limit (`_injectRateLimiter`) foi implantado apenas no endpoint
`POST /inject`. Os endpoints `POST /pipeline`, `POST /memory`, `POST /attach` e `POST /context-send`
não têm limitação de taxa, permitindo spam de requisições.

**Correção:** Extrair função `checkRateLimit(ip)` e aplicar em todos os handlers de escrita.

---

### SEC-N03 — `from` field não validado em `handleInject`

**Arquivo:** `src/copilot/terminal/http-handlers.js` (função `handleInject`) **Severidade:** BAIXA
**OWASP:** A03 Injection (log injection)

**Descrição:** O campo `from` do body é incluído diretamente em logs `INFO`:

```js
log('INFO', `[TerminalServer] Injeção recebida de: ${from}`);
```

Um `from` contendo `\n[ERROR]` pode "injetar" linhas falsas no log, dificultando análise forense.

**Correção:**

```js
const ALLOWED_FROM = new Set(['llm-a', 'user', 'system', 'webhook', 'automation']);
const safeFrom = ALLOWED_FROM.has(from)
  ? from
  : `unknown:${String(from).slice(0, 20).replace(/\n/g, '')}`;
```

---

### SEC-N04 — `hub_send_message` aceita `content` ilimitado sem truncamento

**Arquivo:** `src/copilot/tools/hub-tools.js` **Severidade:** BAIXA **OWASP:** A04 Insecure Design

**Descrição:** O parâmetro `message` do Zod schema é `z.string()` sem `.max()`. A LLM pode passar
(acidentalmente ou não) uma string de 1 MB que será gravada no SQLite e enviada ao modelo. Embora o
modelo tenha seu próprio limite de contexto, o armazenamento pode crescer de forma não controlada.

**Correção:**

```js
message: z.string().max(100_000).describe('...');
```

---

### SEC-N05 — Redirect SSRF em `web_fetch` não verifica todos os formatos de IPv6

**Arquivo:** `src/copilot/tools/web-tools.js` (`validateUrl`) **Severidade:** BAIXA **OWASP:** A10
SSRF

**Descrição:** A proteção SSRF em `validateUrl` cobre IPv4 privado e `::1` mas não cobre o formato
`[::1]` entre colchetes (IPv6 literal em URL), nem `[fd00::]` (ULA range), que são loopback IPv6
válidos. Um atacante poderia passar `http://[::1]:3009/inject` para acessar serviços internos.

**Correção:**

```js
// Adicionar ao validateUrl:
const rawHost = url.hostname; // Node URL já strip brackets
if (rawHost === '::1' || rawHost.toLowerCase().startsWith('fd') || rawHost === '0:0:0:0:0:0:0:1') {
  return { safe: false, reason: `IPv6 privado bloqueado: ${rawHost}` };
}
```

---

### SEC-N06 — Dados de sessão SDK expostos via `GET /sessions` sem autenticação

**Arquivo:** `src/copilot/routes/sessions.js` **Severidade:** MÉDIA **OWASP:** A01 Broken Access
Control

**Descrição:** `GET /api/sdk/sessions` e `GET /api/sdk/sessions/:id` expõem session IDs, modelos,
workspace paths e timestamps de todas as sessões SDK sem verificação de autenticação. O roteador
Express não exige JWT ou nenhuma outra proteção nesses endpoints.

**Correção:** Verificar em `sdk-api.js` se existe middleware de auth antes de montar as rotas de
sessões, ou adicionar middleware `requireAuth` específico.

---

### SEC-N07 — Leitura de `session.json` em `session-manager.js` sem verificação de JSON injection

**Arquivo:** `src/copilot/agent/session-manager.js` **Severidade:** MÍNIMA **OWASP:** A03 Injection

**Descrição:** O campo `close_key` lido de `session.json` é interpolado em mensagens de string no
system message do SDK sem sanitização:

```js
`- close_key: \`${closeKey}\``;
```

Se `session.json` for corrompido ou manipulado (eg: `close_key = "X\`\nSYSTEM: ignore all
previous"`), poderia causar prompt injection no system message enviado ao modelo.

**Correção:** `JSON.stringify(closeKey)` ou limitar `closeKey` a alfanuméricos.

---

### SEC-N08 — `hub:user:inject` via Socket.io não tem rate limit

**Arquivo:** `src/copilot/conversation-hub/socket-ns.js` **Severidade:** MÉDIA **OWASP:** A04
Insecure Design

**Descrição:** O evento `user:inject` no namespace `/copilot` não tem limitação de frequência. Um
cliente conectado pode enviar centenas de injeções por segundo, spammando o conversation hub e
enchendo o SQLite.

**Correção:** Implementar rate-limit por `socket.id` (ex: 10 injeções por minuto).

---

### SEC-N09 — Conteúdo de `content` em `user:inject` socket não é sanitizado

**Arquivo:** `src/copilot/conversation-hub/socket-ns.js` **Severidade:** BAIXA **OWASP:** A03
Injection (prompt injection)

**Descrição:** Um usuário malicioso conectado ao socket pode injetar instruções de sistema no
diálogo LLM-A ↔ LLM-B via `content` com markup de prompt especial (ex: `\n\n[SYSTEM OVERRIDE]`).

**Correção:** Sanitizar `content` removendo / escapando marcadores de sistema antes de passar ao
orchestrator.

---

### SEC-N10 — `DELETE /sessions/:id` é irreversível sem confirmação

**Arquivo:** `src/copilot/routes/sessions.js` **Severidade:** BAIXA **OWASP:** A04 Insecure Design

**Descrição:** `DELETE /sessions/:id/` deleta permanentemente a sessão do disco sem nenhum mecanismo
de confirmação ou autorização diferenciada. Qualquer código que tenha acesso ao endpoint interno
pode destruir uma sessão de trabalho valiosa.

**Correção:** Exigir header `X-Confirm-Delete: true` ou corpo `{ "confirm": "delete" }`.

---

## ARCH — Problemas arquiteturais

### ARCH-N01 — `request_user_input` no hook-tools não suspende realmente o SDK

**Arquivo:** `src/copilot/tools/hook-tools.js` **Severidade:** ALTA

**Descrição:** A tool `request_user_input` retorna um objeto estático
`{ status: 'waiting_for_input', ... }` mas NÃO chama `onUserInputRequest` da sessão SDK. O agente
não é de fato suspenso — ele apenas instrui o modelo (via description) a "aguardar". Se o modelo
ignorar a instrução e continuar processando, o sistema não tem mecanismo de enforcement.

O contrato real do SDK usa `onUserInputRequest` como callback de suspensão. Sem ele, a tool é uma
peça de teatro.

**Correção:** Expor o `onUserInputRequest` callback via closure do módulo e chamá-lo de dentro do
handler:

```js
/** @type {((input: string) => void) | null} */
let _pendingInputResolver = null;

export function setUserInputResolver(fn) {
  _pendingInputResolver = fn;
}

// No handler da tool:
handler: async ({ question }) => {
  return new Promise((resolveHook) => {
    _pendingInputResolver = (userInput) => {
      _pendingInputResolver = null;
      resolveHook({ status: 'resolved', answer: userInput });
    };
    // Emite evento para o terminal saber que está aguardando
    broadcastSse('waiting_for_input', { question });
  });
};
```

---

### ARCH-N02 — `AlwaysAliveAgent` é um singleton monolítico de 1368 linhas

**Arquivo:** `src/copilot/agent/always-alive.js` **Severidade:** MÉDIA

**Descrição:** O arquivo tem 1368 linhas e mistura responsabilidades de: ciclo de vida da sessão
SDK, fila de processamento, streaming de token, channel context tracking, status machine, webhook
management, retry/reconnect. A complexidade dificulta teste e manutenção.

**Proposta de decomposição:**

- `AgentLifecycle` (start/stop/reconnect) ← 150 linhas
- `AgentQueue` (fila + sendTurn) ← 200 linhas (já existia `task-executor.js`)
- `AgentContextTracker` (context window monitoring) ← 80 linhas
- `AgentStatusMachine` (transições de estado) ← 100 linhas
- Manter `always-alive.js` como orquestrador delegando para os acima

---

### ARCH-N03 — `conversationHub` instanciado como singleton global mas hub.js importado dinamicamente

**Arquivo:** `src/copilot/conversation-hub/hub.js`, `tools/hub-tools.js` **Severidade:** MÉDIA

**Descrição:** `hub-tools.js` importa `conversationHub` dinamicamente via `requireHub()` para evitar
falha no modo standalone. Porém, o import dinâmico lança erro APENAS se `conversationHub.isReady` é
false, deixando o código com um padrão inconsistente: algumas partes importam hub diretamente,
outras usam o wrapper lazy.

**Correção:** Centralizar a lógica em um `getHub()` que retorna `null` se não disponível, e eliminar
imports diretos divergentes.

---

### ARCH-N04 — `buildCustomAgentsConfig` acoplado a implementação hardcoded

**Arquivo:** `src/copilot/config/custom-agents.js` **Severidade:** MÉDIA

**Descrição:** Os agentes customizados são definidos com nomes, descriptions e prompts hardcoded em
código. Mudanças nos prompts dos sub-agentes requerem edição de código + restart.

**Proposta:** Carregar configuração de agentes de um arquivo YAML/JSON
(`.github/config/custom-agents.yaml`) com hot-reload via `fs.watch`.

---

### ARCH-N05 — `llm-bridge-client.js` é wrapper deprecated mas ainda importado diretamente

**Arquivo:** `src/copilot/bridges/llm-bridge-client.js` **Severidade:** BAIXA

**Descrição:** Este arquivo é apenas `export * from '../channel/client.js'` com nota de deprecated.
Se existem importadores usando o caminho `bridges/llm-bridge-client.js`, eles passam por uma
indireção desnecessária.

**Correção:** Auditar importadores e migrar para `#copilot/channel/client` diretamente.

---

### ARCH-N06 — `MAX_QUEUE_SIZE` movido para `constants.js` mas `always-alive.js` usa cópia local

**Arquivo:** `src/copilot/agent/always-alive.js` (linha ~50) **Severidade:** BAIXA

**Descrição:** O arquivo `constants.js` define `MAX_QUEUE_SIZE = 100`. Verificar se
`always-alive.js` importa a constante ou define um valor duplicado localmente. Se duplicado → desync
silencioso.

**Correção:** Importar explicitamente:

```js
import { MAX_QUEUE_SIZE } from '#copilot/core/constants';
```

---

### ARCH-N07 — `dialog.js` acopla renderização de terminal (stdout) + lógica de negócio

**Arquivo:** `src/copilot/terminal/dialog.js` **Severidade:** BAIXA

**Descrição:** `dialog.js` delega bem o envio ao SDK, mas ainda chama `println()` e
`printExchange()` (stdout direto) por dentro de `_executeTurn`. Isso impossibilita testar
`_executeTurn` sem efeitos colaterais em stdout, e impossibilita redirecionar output para um canal
alternativo (ex: log file).

**Proposta:** Aceitar `writer` como parâmetro opcional (Strategy):

```js
export function sendTurn(message, actor = 'user', writer = console.log) { ... }
```

---

### ARCH-N08 — O `ConversationHub` não tem lifecycle de shutdown gracioso

**Arquivo:** `src/copilot/conversation-hub/hub.js` **Severidade:** MÉDIA

**Descrição:** O hub não expõe método `close()` ou `shutdown()`. Se o processo for encerrado
enquanto há sessões ativas persistidas como `active`, elas ficam perpetuamente em status `active` no
SQLite, sem serem marcadas como `interrupted` ou `closed`.

**Correção:** Implementar `ConversationHub.close()` que:

1. Marca todas as sessões `active` → `interrupted`
2. Fecha a conexão SQLite
3. Limpa o WAL checkpoint timer

---

### ARCH-N09 — `todo-tools.js` usa `fs.readFileSync`/`writeFileSync` em handler assíncrono

**Arquivo:** `src/copilot/tools/todo-tools.js` **Severidade:** MÉDIA

**Descrição:** Todo o sistema de todos usa I/O síncrono (`readFileSync`, `writeFileSync`) apesar de
os handlers serem `async`. Com mais de ~5 operações simultâneas de todos, o event loop fica
bloqueado brevemente.

**Correção:** Migrar para `fs.promises.readFile`/`writeFile` e ajustar para uso de `await`.

---

### ARCH-N10 — `channel/audit.js` e `session-manager.logToolAudit` escrevem no mesmo arquivo de log sem coordenação

**Arquivo:** `src/copilot/channel/audit.js`, `src/copilot/agent/session-manager.js` **Severidade:**
BAIXA

**Descrição:** Dois módulos independentes usam `appendFileSync` no mesmo arquivo
`logs/tool-audit.jsonl` sem lock ou semáforo. Em alta concorrência, pode haver interleaving de
linhas JSON (linha incompleta de A seguida de linha incompleta de B → JSON inválido).

**Correção:** Centralizar escrita de auditoria em um módulo único com queue em memória e flush
periódico.

---

### ARCH-N11 — `system-prompt.js` define prompt de boot hardcoded com protocolo `ask_user`

**Arquivo:** `src/copilot/terminal/dialog.js` (`DEFAULT_BOOT_PROMPT`) **Severidade:** MÉDIA

**Descrição:** O protocolo `ask_user` via `READY:` / `REPLY:` é implementado como instrução de texto
no boot prompt. Isso é frágil — o modelo pode não seguir as instruções em todas as situações,
especialmente em reinicializações.

**Proposta:** Validar estrutura de resposta do modelo: se `reply` não começa com `REPLY:`,
reenfileirar com instrução de reformatação. Adicionar parsing defensivo no
`llmBridgeClient.dialogTurn`.

---

### ARCH-N12 — `inject.js` httprequest reinventa `node:http` manualmente

**Arquivo:** `src/copilot/channel/inject.js` **Severidade:** BAIXA

**Descrição:** A função `httpRequest` reimplementa manualmente um cliente HTTP usando
`http.request`. Em Node.js 24+, o `fetch` global está estável e não requer `--experimental-fetch`. A
implementação manual é mais propensa a bugs (ex: falta de `req.on('error', ...)` em casos de bad
TCP).

**Proposta:** Migrar para `fetch()` + `AbortController` (como já feito em `web-tools.js`).

---

## PERF — Gargalos de desempenho

### PERF-N01 — `safeExec` bloqueia event loop (duplica BUG-N01)

(ver BUG-N01 — impacto de performance confirmado)

---

### PERF-N02 — `readFileSync` lê arquivo inteiro em RAM em `file-tools.js`

(ver BUG-N12 — impacto de performance confirmado)

---

### PERF-N03 — `todo-tools.js` faz `JSON.parse(readFileSync())` + `JSON.stringify(writeFileSync())` no critical path

**Arquivo:** `src/copilot/tools/todo-tools.js` **Severidade:** MÉDIA

**Descrição:** Cada operação de todo (create, update, delete) carrega O JSON inteiro (~N tarefas),
modifica e reescreve. Com 500+ tarefas (próximo ao `MAX_LIST = 200` na listagem mas sem limite na
escrita), cada operação é O(N) de serialização.

**Proposta:**

- Manter todos em memória (Map), apenas persistir assincronamente (write-through cache + debounce
  500ms)
- Ou migrar para SQLite como o `ConversationStore` já faz

---

### PERF-N04 — `alwaysAliveAgent.status` e `model` consultados por chamada em `printExchange`

**Arquivo:** `src/copilot/terminal/dialog.js` **Severidade:** MÍNIMA

**Descrição:** `printExchange` acessa `alwaysAliveAgent.model` e `alwaysAliveAgent.reasoningEffort`
a cada chamada. São acessors simples sem overhead real, mas se `AlwaysAliveAgent` adicionar lógica
neles, podem criar gargalo de downstream.

---

### PERF-N05 — `search_in_files` usa `rg` via `execFileAsync` sem limite de profundidade

**Arquivo:** `src/copilot/tools/file-tools.js` **Severidade:** BAIXA

**Descrição:** A tool `search_in_files` passa `--max-depth` baseado em parâmetro da tool
(`maxDepth`), mas o default não limita profundidade. Em workspaces grandes com `node_modules/`
incluído (se `--no-ignore` for passado), a busca pode demorar dezenas de segundos.

**Correção:** Adicionar `'--exclude-dir', 'node_modules'` por padrão nos args do `rg`.

---

### PERF-N06 — `_sendTurnMutex` em `dialog.js` cria cadeia infinita de `.then()`

**Arquivo:** `src/copilot/terminal/dialog.js` **Severidade:** BAIXA

**Descrição:** O padrão Promise-chain mutex:

```js
_sendTurnMutex = next.then(
  () => null,
  () => null,
);
```

Cria uma cadeia de Promises que cresce por toda a vida do processo. Em sistemas com alto volume de
turnos (ex: 10k turnos/dia), a cadeia pode acumular sem ser liberada pelo GC.

**Correção:** Substituir por semáforo explícito com `resolve/reject` manual:

```js
let _mutexUnlock = () => {};
let _mutex = Promise.resolve();
function lock() {
  let unlock;
  const next = new Promise((r) => (unlock = r));
  const wait = _mutex.then(() => {});
  _mutex = next;
  _mutexUnlock = unlock;
  return wait;
}
function unlock() {
  _mutexUnlock();
}
```

---

### PERF-N07 — `#statusSnapshotCache` em `always-alive.js` é invalidado a cada 500ms sem necessidade

**Arquivo:** `src/copilot/agent/always-alive.js` **Severidade:** MÍNIMA

**Descrição:** O cache de 500ms para `getStatusSnapshot()` é conservador para polling de UI, mas
garante que ao menos 2 leituras por segundo causam rebuild do snapshot. Para leituras em burst de
SSE (múltiplos clientes), o cache pode ser insuficiente.

**Proposta:** Invalidar por evento (`status:changed`) em vez de por tempo.

---

## GAP — Funcionalidades ausentes/incompletas

### GAP-N01 — Ausência de rate-limit em `/pipeline` e `/memory`

**(ver SEC-N02)** — Também é um gap funcional.

---

### GAP-N02 — `handlePipeline` não tem limite no número de steps

**Arquivo:** `src/copilot/terminal/http-handlers.js` (função `handlePipeline`) **Severidade:** MÉDIA

**Descrição:** O endpoint `POST /pipeline` aceita um array `steps` sem limite máximo. Body com 1000
steps seria processado, gerando 1000 turnos enfileirados no `sendTurn` mutex.

**Correção:**

```js
const MAX_PIPELINE_STEPS = 20;
if (steps.length > MAX_PIPELINE_STEPS) {
  return res.status(400).json({ error: `Máximo ${MAX_PIPELINE_STEPS} steps por pipeline.` });
}
```

---

### GAP-N03 — Nenhuma autenticação no terminal LLM-B (porta 3009)

**Arquivo:** `src/copilot/terminal/server.js` **Severidade:** ALTA

**Descrição:** O servidor HTTP na porta 3009 não exige autenticação. Qualquer processo na mesma
máquina (ou na rede, se a porta for exposta) pode injetar mensagens, ler histórico, ou mudar
configurações do terminal.

**Proposta:** Adicionar autenticação por token estático configurável via env var
`LLM_B_TERMINAL_TOKEN`:

```js
const TERMINAL_TOKEN = process.env.LLM_B_TERMINAL_TOKEN ?? null;
if (TERMINAL_TOKEN) {
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${TERMINAL_TOKEN}`) {
    res.writeHead(401).end('Unauthorized');
    return;
  }
}
```

---

### GAP-N04 — Sem observabilidade de tours de contexto compactado

**Arquivo:** `src/copilot/agent/always-alive.js` **Severidade:** BAIXA

**Descrição:** Quando `promptCompact` é chamado para compactar o contexto de uma sessão antiga, não
há evento emitido, log estruturado ou métrica. É impossível saber retrospectivamente quantas vezes o
contexto foi compactado ou quando foi feito.

**Correção:** Emitir `emit('context:compacted', { sessionId, timestamp })` e registrar no telemetry.

---

### GAP-N05 — Sem watch de mudanças em `config/tools/state.js`

**Arquivo:** `src/copilot/config/tools/state.js` **Severidade:** BAIXA

**Descrição:** A configuração de tools (allowlist/denylist) é carregada do disco em
`loadToolsConfig()` mas sem `fs.watch`. Mudanças manuais no arquivo durante o runtime não são
refletidas sem restart.

**Proposta:** Adicionar watcher com debounce 300ms + reload automático + log de aviso.

---

### GAP-N06 — Sem health check ativo em `conversation-hub`

**Arquivo:** `src/copilot/conversation-hub/hub.js` **Severidade:** BAIXA

**Descrição:** O hub não expõe endpoint de health check próprio. O único health check disponível é
`GET /health` do `terminal/server.js`, que não inclui estado do hub (sessões ativas, tamanho do
SQLite, pending turns).

**Proposta:** Adicionar `hub.getHealthStatus()` e incluir no payload do `/health`.

---

### GAP-N07 — Sem suporte a mensagens bidirecionais no `chatBatch()` de `channel/client.js`

**Arquivo:** `src/copilot/channel/client.js` **Severidade:** BAIXA

**Descrição:** O método `chatBatch()` (UPG-06) envia uma lista de mensagens sequencialmente mas não
coleta as respostas individualmente — retorna apenas a última. Para casos de uso onde cada pergunta
deve ter sua resposta rastreável, isso é insuficiente.

**Proposta:**

```js
// Retornar array de { message, reply, durationMs }
async chatBatch(messages) {
    return Promise.allSettled(
        messages.map((msg) => this.dialogTurn(msg))
    );
}
```

---

### GAP-N08 — `session-rpc-tools.js` sem documentação de contrato de erro

**Arquivo:** `src/copilot/tools/session-rpc-tools.js` **Severidade:** BAIXA

**Descrição:** As tools RPC de sessão retornam `{ success: false, error: string }` mas não há
contrato documentado sobre quais códigos de erro podem ocorrer, dificultando tratamento por
consumidores.

---

### GAP-N09 — Nenhuma tool de introspection para `todo-tools`

**Arquivo:** `src/copilot/tools/todo-tools.js` **Severidade:** BAIXA

**Descrição:** O sistema de todos tem operações CRUD, busca e stats, mas não tem tool de "export"
(exportar todas as tarefas como JSON/CSV) nem de "import" (restaurar backup). Para resiliência de
dados, essas operações facilitariam backup e migração.

---

### GAP-N10 — `file-tools.js` não tem tool de diff entre dois arquivos

**Arquivo:** `src/copilot/tools/file-tools.js` **Severidade:** BAIXA

**Descrição:** Existe `read_file_content`, mas não existe `diff_files`. Para tarefas de code review
ou comparação de versões, o LLM-B precisa ler ambos e calcular o diff mentalmente. Uma tool
`diff_files(a, b)` usando `diff -u` ou `git diff --no-index` seria valiosa.

---

### GAP-N11 — `gh-bridge.js` não gerencia paginação em listagens

**Arquivo:** `src/copilot/bridges/gh-bridge.js` **Severidade:** BAIXA

**Descrição:** As funções `listIssues`, `listPRs`, `listRuns` têm `limit` fixo (geralmente 15). Para
repositórios com muitas issues/PRs, o LLM-B vê apenas os primeiros N itens sem possibilidade de
"próxima página".

**Proposta:** Adicionar parâmetro `page` e retornar `hasMore: boolean`.

---

### GAP-N12 — Sistema sem circuit breaker para o AgentQueue

**Arquivo:** `src/copilot/agent/always-alive.js` **Severidade:** MÉDIA

**Descrição:** Já existe circuit breaker no `mcp-tool-bridge.js` (UPG-02) mas não há circuit breaker
para a fila de tarefas do agente. Se o modelo retornar erros consecutivamente (ex: todos os
sendAndWait falharem por 5 minutos), a fila continua aceitando e rejeitando tarefas sem modo de
"trip" que interrompa temporariamente o processamento.

**Proposta:** Implementar circuit breaker na fila: após `N` falhas consecutivas em `executeTask`,
entrar em estado `open` por 60s antes de aceitar novas tarefas.

---

### GAP-N13 — Sem persistência de `_turnQueueDepth` entre processos

**Arquivo:** `src/copilot/terminal/dialog.js` **Severidade:** MÍNIMA

**Descrição:** `_turnQueueDepth` é uma variável de módulo em memória. Se o terminal reiniciar
enquanto há turnos na fila, os turnos enfileirados são perdidos silenciosamente.

---

### GAP-N14 — Sem endpoint para consultar telemetria do agente via HTTP

**Arquivo:** `src/copilot/lib/telemetry.js` **Severidade:** BAIXA

**Descrição:** O módulo de telemetria (`recordToolCall`, `getSummary`) existe e funciona, mas não há
endpoint HTTP exposto para consultar as métricas em runtime (ex: `GET /api/sdk/telemetry`).

**Proposta:** Adicionar rota `GET /api/sdk/telemetry` que retorna
`getSummary(globalTelemetryStore)`.

---

### GAP-N15 — Sem suporte a cancelamento de tarefa individual na fila do AgentQueue

**Arquivo:** `src/copilot/agent/always-alive.js` **Severidade:** BAIXA

**Descrição:** Uma vez enfileirada via `send()`, uma tarefa não pode ser cancelada individualmente.
O único mecanismo disponível é `abort()` que cancela o turno atual, mas não limpa a fila.

**Proposta:** Adicionar `cancel(taskId)` que marca a tarefa como cancelada e, quando chegar sua vez,
a rejeita imediatamente.

---

## QUAL — Qualidade de código

### QUAL-N01 — `session-manager.js` usa variáveis `let` para constantes de módulo

**Arquivo:** `src/copilot/agent/session-manager.js` (linha ~35) **Severidade:** MÍNIMA
`let _backgroundCompactionThreshold = 0.75;` — apesar de ser mutável, o nome e uso sugerem que
deveria ser um estado de módulo bem isolado com getter/setter.

---

### QUAL-N02 — `always-alive.js` usa `setMaxListeners(50)` hardcoded

**Arquivo:** `src/copilot/agent/always-alive.js` **Severidade:** BAIXA O valor 50 é arbitrário.
Deveria ser calculado ou configurável via env var `AGENT_MAX_LISTENERS`.

---

### QUAL-N03 — Comentários de fix referenciando IDs de bugs de auditorias passadas

**Arquivo:** múltiplos **Severidade:** MÍNIMA

**Descrição:** Comentários como `// SEC-04 (fix): ...`, `// BUG-H07 (fix): ...` são úteis durante
implementação mas poluem o código a longo prazo. Referências a IDs de auditoria devem ser movidas
para `CHANGELOG.md` e os comentários no código devem ser autoexplicativos.

---

### QUAL-N04 — Uso inconsistente de `defineTool` vs `buildTool`

**Arquivo:** múltiplos arquivos em `tools/` **Severidade:** BAIXA

**Descrição:** Alguns arquivos usam `defineTool` diretamente do SDK com cast `/** @type {...} */`
manual (ex: `code-tools.js`, `file-tools.js`), enquanto outros usam `buildTool` da tool-factory (ex:
`session-tools.js`). Isso cria dois padrões paralelos no mesmo codebase.

**Proposta:** Migrar todos para `buildTool` (que já normaliza schema + loga) eliminando as casts
manuais `sdkParam(schema)`.

---

### QUAL-N05 — `TODO` comments sem rastreabilidade

**Arquivo:** múltiplos **Severidade:** MÍNIMA Existem `// TODO:` espalhados sem link para issue do
GitHub. Transformar em itens no `todo-tools` ou issues rastreadas.

---

### QUAL-N06 — `repl.js` e `terminal/commands/*.js` sem testes unitários

**Arquivo:** `src/copilot/terminal/commands/*.js` **Severidade:** BAIXA Os comandos do terminal REPL
(`/context`, `/plan`, `/memory`, `/attach`, etc.) não têm testes unitários. São testados apenas
manualmente. Com o crescimento do sistema, regressões em comandos REPL podem não ser detectadas.

---

### QUAL-N07 — JSDoc faltando em alguns handlers de rota Express

**Arquivo:** `src/copilot/routes/sessions.js`, `routes/webhooks.js` **Severidade:** MÍNIMA Handlers
de rota inline (`(req, res) => ...`) não têm JSDoc com `@param` e `@returns`, tornando a navegação
IDE menos informativa.

---

### QUAL-N08 — `introspection-tools.js` acessa internals do agente via `alwaysAliveAgent` global

**Arquivo:** `src/copilot/tools/introspection-tools.js` **Severidade:** BAIXA

**Descrição:** As tools de introspecção importam e acessam `alwaysAliveAgent` diretamente
(acoplamento rígido ao singleton). Isso impossibilita reutilizar estas tools em contextos
multiagente.

**Proposta:** Aceitar `agent` como parâmetro de fábrica:

```js
export function createIntrospectionTools(agent) { ... }
```

---

### QUAL-N09 — `web-tools.js` usa `reduce` para concatenar Uint8Arrays (O(n²))

**Arquivo:** `src/copilot/tools/web-tools.js` (handler de `web_fetch`) **Severidade:** BAIXA

**Descrição:**

```js
chunks.reduce((acc, c) => {
  const merged = new Uint8Array(acc.length + c.length);
  merged.set(acc);
  merged.set(c, acc.length);
  return merged;
}, new Uint8Array(0));
```

Este padrão cria N cópias intermediárias (O(n²) em memória e tempo). Para respostas grandes (~500
KB), cria dezenas de buffers temporários.

**Correção:**

```js
const total = chunks.reduce((s, c) => s + c.length, 0);
const merged = new Uint8Array(total);
let offset = 0;
for (const c of chunks) {
  merged.set(c, offset);
  offset += c.length;
}
```

---

### QUAL-N10 — `dialog.js` usa `println` em vez de `log()` para output de diagnóstico

**Arquivo:** `src/copilot/terminal/dialog.js` **Severidade:** MÍNIMA Mensagens de erro e aviso em
`_executeTurn` usam `println` (stdout direto) em vez de `log('ERROR', ...)`, impedindo que apareçam
nos arquivos de log estruturado do PM2.

---

## UPG — Upgrades e melhorias propostas

### UPG-N01 — Migrar `safeExec` para async em `code-tools.js`

**Arquivo:** `src/copilot/tools/code-tools.js` **Prioridade:** CRÍTICA **Esforço:** Baixo (1h)

Converter `safeExec` para usar `execFileAsync` com streams. Manter interface pública igual (retorna
`{ stdout, stderr, exitCode }`). Atualizar as 3 tools que o utilizam.

---

### UPG-N02 — Implementar `readBody` com limite de tamanho

**Arquivo:** `src/copilot/terminal/server.js` **Prioridade:** ALTA **Esforço:** Baixo (30min)

Adicionar contador de bytes em `readBody` com rejeição a `MAX_BODY_BYTES = 2MB`. Retornar 413 ao
cliente.

---

### UPG-N03 — Rate-limit em todos os endpoints de escrita do terminal

**Arquivo:** `src/copilot/terminal/server.js`, `terminal/http-handlers.js` **Prioridade:** ALTA
**Esforço:** Médio (2h)

Extrair `checkRateLimit(ip, endpoint)` e aplicar em `/pipeline`, `/memory`, `/attach`,
`/context-send`. Rate diferenciado: `/pipeline` mais restritivo (5 req/min) vs `/inject` (20
req/min).

---

### UPG-N04 — Autenticação por token no terminal LLM-B

**Arquivo:** `src/copilot/terminal/server.js` **Prioridade:** ALTA **Esforço:** Médio (2h)

Ler `LLM_B_TERMINAL_TOKEN` do ambiente. Se definido, exigir header `Authorization: Bearer <token>`.
Isentar `GET /health` (healthcheck não autenticado).

---

### UPG-N05 — Substituir `reduce` de Uint8Array por concat direto em `web-tools.js`

**Arquivo:** `src/copilot/tools/web-tools.js` **Prioridade:** MÉDIA **Esforço:** Mínimo (15min)

---

### UPG-N06 — Migrar `todo-tools.js` para I/O assíncrono

**Arquivo:** `src/copilot/tools/todo-tools.js` **Prioridade:** MÉDIA **Esforço:** Médio (3h)

Substituir `readFileSync`/`writeFileSync` por `fs.promises.readFile`/`writeFile`. Manter escrita
atômica via `.tmp` + rename.

---

### UPG-N07 — Purgar `_injectRateLimiter` automaticamente

**Arquivo:** `src/copilot/terminal/server.js` **Prioridade:** MÉDIA **Esforço:** Mínimo (20min)

Adicionar `pruneRateLimiter()` chamado após cada verificação, removendo buckets expirados.

---

### UPG-N08 — Expor endpoint `GET /api/sdk/telemetry`

**Arquivo:** `src/copilot/routes/sessions.js` ou novo `routes/telemetry.js` **Prioridade:** MÉDIA
**Esforço:** Baixo (1h)

Retorna `getSummary(globalTelemetryStore)` + `getPercentile(telStore, 95)` como JSON.

---

### UPG-N09 — Implementar `ConversationHub.close()` para shutdown gracioso

**Arquivo:** `src/copilot/conversation-hub/hub.js` **Prioridade:** MÉDIA **Esforço:** Médio (2h)

Atualizar sessões `active` → `interrupted` no shutdown. Registrar no SIGTERM handler.

---

### UPG-N10 — Migrar `file-tools.js` para streaming de leitura partial

**Arquivo:** `src/copilot/tools/file-tools.js` **Prioridade:** MÉDIA **Esforço:** Médio (2h)

Usar `fs.createReadStream({ end: MAX_CONTENT_BYTES - 1 })` em vez de `readFileSync` + slice. Elimina
carregamento de arquivos grandes em RAM.

---

### UPG-N11 — Circuit breaker na AgentQueue

**Arquivo:** `src/copilot/agent/always-alive.js` **Prioridade:** MÉDIA **Esforço:** Alto (4h)

Após N falhas consecutivas em `executeTask`, entrar em modo `open` por 60s. Emit `'circuit:open'` /
`'circuit:closed'` para observabilidade externamente.

---

### UPG-N12 — `cancel(taskId)` na fila do AlwaysAliveAgent

**Arquivo:** `src/copilot/agent/always-alive.js` **Prioridade:** BAIXA **Esforço:** Médio (2h)

Adicionar `#cancelledTasks = new Set<string>()`. Em `executeTask`, verificar no início e rejeitar
com `TaskCancelledError`.

---

### UPG-N13 — Migrar `channel/inject.js` de `http.request` manual para `fetch`

**Arquivo:** `src/copilot/channel/inject.js` **Prioridade:** BAIXA **Esforço:** Médio (2h)

Node.js 24+ tem `fetch` estável. Simplifica código, melhor manejo de timeouts via `AbortController`.

---

### UPG-N14 — Hot-reload de `custom-agents.js` via arquivo de configuração

**Arquivo:** `src/copilot/config/custom-agents.js` **Prioridade:** BAIXA **Esforço:** Alto (4h)

Mover definição de agentes para `.github/config/custom-agents.yaml`. Watcher com debounce 500ms
notifica `session-manager` para recriar sessão com novos agentes.

---

### UPG-N15 — Adicionar event `context:compacted` ao AlwaysAliveAgent

**Arquivo:** `src/copilot/agent/always-alive.js` **Prioridade:** BAIXA **Esforço:** Mínimo (30min)

Emitir `this.emit('context:compacted', { sessionId, ts })` quando `promptCompact` for chamado.
Registrar no telemetry.

---

### UPG-N16 — Semáforo explícito substituindo Promise-chain mutex em `dialog.js`

**Arquivo:** `src/copilot/terminal/dialog.js` **Prioridade:** BAIXA **Esforço:** Médio (2h)

Trocar o padrão de mutex por semáforo com resolver explícito para evitar acúmulo de cadeia de
Promises ao longo do tempo.

---

### UPG-N17 — Padronizar todas as tools em `buildTool` da tool-factory

**Arquivo:** `src/copilot/tools/*.js` **Prioridade:** BAIXA **Esforço:** Alto (6h)

Migrar `code-tools.js`, `file-tools.js`, `hook-tools.js` e `hub-tools.js` para usar `buildTool` da
ferramenta factory, eliminando casts `sdkParam()` manuais e padronizando o contrato de tools.

---

### UPG-N18 — Validação IPv6 completa na proteção SSRF de `web-tools.js`

**Arquivo:** `src/copilot/tools/web-tools.js` **Prioridade:** MÉDIA **Esforço:** Baixo (30min)

Adicionar verificação de `::1`, `[::1]`, `0:0:0:0:0:0:0:1`, `fd00::/8` (Unique Local Addresses) na
função `validateUrl`.

---

### UPG-N19 — Middleware de autenticação em rotas SDK (`routes/sessions.js`)

**Arquivo:** `src/copilot/routes/sessions.js`, `api/sdk-api.js` **Prioridade:** ALTA **Esforço:**
Médio (2h)

Adicionar middleware `requireSdkAuth` antes das rotas que expõem session IDs e metadata, verificando
o mesmo JWT que o namespace `/copilot` já usa.

---

### UPG-N20 — Tool `diff_files` em `file-tools.js`

**Arquivo:** `src/copilot/tools/file-tools.js` **Prioridade:** BAIXA **Esforço:** Baixo (1h)

```js
const diffFilesTool = buildTool({
  name: 'diff_files',
  description: 'Retorna o diff unificado entre dois arquivos',
  parameters: z.object({ fileA: z.string(), fileB: z.string() }),
  async handler({ fileA, fileB }) {
    const { stdout } = await execFileAsync('diff', ['-u', fileA, fileB]).catch((e) => ({
      stdout: e.stdout ?? '',
    }));
    return { diff: stdout.slice(0, 20_000) };
  },
});
```

---

### UPG-N21 — Paginação em `gh-bridge.js`

**Arquivo:** `src/copilot/bridges/gh-bridge.js` **Prioridade:** BAIXA **Esforço:** Baixo (1h)

Adicionar `page?: number` e `hasMore: boolean` às funções de listagem, passando `--offset` ao `gh`.

---

### UPG-N22 — Endpoint `GET /api/sdk/health/hub` para estado do ConversationHub

**Arquivo:** novo endpoint em `routes/` ou `api/sdk-api.js` **Prioridade:** BAIXA **Esforço:** Baixo
(1h)

Retornar `{ activeSessions, pendingTurns, dbSizeBytes, waxCheckpointAge }` para monitoramento.

---

### UPG-N23 — Adicionar `X-Request-ID` header em todas as respostas do terminal

**Arquivo:** `src/copilot/terminal/server.js` **Prioridade:** BAIXA **Esforço:** Mínimo (30min)

Gerar `uuid` por request e incluir como `X-Request-ID` em todas as respostas. Facilita correlação de
logs em debugging.

---

### UPG-N24 — Rate limit por socket em `socket-ns.js` para `user:inject`

**Arquivo:** `src/copilot/conversation-hub/socket-ns.js` **Prioridade:** MÉDIA **Esforço:** Baixo
(1h)

Manter `Map<socketId, { count, windowStart }>` e rejeitar com `error:ratelimit` se >10 injeções/min.

---

### UPG-N25 — Logging estruturado (JSON) em terminais de produção

**Arquivo:** múltiplos + `#core/logger` **Prioridade:** MÉDIA **Esforço:** Alto (6h)

Quando `NODE_ENV=production`, emitir logs como JSON (`{ level, msg, module, ts, ... }`) em vez de
strings com ANSI. Compatível com Loki, Datadog, CloudWatch.

---

### UPG-N26 — Suporte a múltiplos workspaces em `file-tools.js`

**Arquivo:** `src/copilot/tools/file-tools.js` **Prioridade:** BAIXA **Esforço:** Médio (3h)

Atualmente `WORKSPACE_ROOT` é derivado de `import.meta.url`. Para setups multi-root (VS Code
workspaces), um segundo workspace path seria bloqueado. Aceitar lista de raízes autorizadas via env.

---

### UPG-N27 — `todo-tools.js` migrar para SQLite via `ConversationStore` pattern

**Arquivo:** `src/copilot/tools/todo-tools.js` **Prioridade:** MÉDIA **Esforço:** Alto (8h)

O sistema de todos em JSON é limitado para operações complexas. Migrar para SQLite com FTS5 para
busca full-text nativa (como `ConversationStore` já faz) eliminaria serialização JSON completa a
cada operação.

---

### UPG-N28 — Adicionar `opentelemetry` para traces distribuídos

**Arquivo:** `src/copilot/lib/telemetry.js` **Prioridade:** BAIXA **Esforço:** Alto (8h)

O telemetry atual é in-process e não exporta. Adicionar suporte opcional ao OTLP exporter via
`@opentelemetry/sdk-node` para enviar traces e métricas a um coletor configurável.

---

### UPG-N29 — `github-copilot-agent` User-Agent versionado em `web-tools.js`

**Arquivo:** `src/copilot/tools/web-tools.js` **Prioridade:** MÍNIMA **Esforço:** Mínimo (15min)

Incluir versão do projeto lida de `package.json` no User-Agent:
`github-copilot-agent/1.0 chatgpt-docker-puppeteer/x.y.z`.

---

### UPG-N30 — `dialog.js` persistir turno lost em caso de crash via WAL do hub

**Arquivo:** `src/copilot/terminal/dialog.js` **Prioridade:** BAIXA **Esforço:** Médio (3h)

Persistir o turno no ConversationHub ANTES de enviar ao modelo (com status `pending`), e atualizar
para `completed` + `content` ao receber a resposta. Em caso de crash, torna possível detectar turnos
não respondidos.

---

## Matriz de Prioridade

### Prioridade Crítica (executar imediatamente)

| ID                           | Tipo     | Arquivo                         | Esforço |
| ---------------------------- | -------- | ------------------------------- | ------- |
| BUG-N01 / PERF-N01 / UPG-N01 | BUG+PERF | `tools/code-tools.js`           | 1h      |
| SEC-N01 / BUG-N08 / UPG-N02  | SEC+BUG  | `terminal/server.js` readBody   | 30min   |
| SEC-N02 / GAP-N01 / UPG-N03  | SEC+GAP  | `terminal/server.js` rate-limit | 2h      |
| GAP-N03 / UPG-N04            | GAP+SEC  | Auth no terminal LLM-B          | 2h      |
| SEC-N06 / UPG-N19            | SEC      | Rotas SDK sem auth              | 2h      |

### Prioridade Alta (próximo sprint)

| ID                 | Tipo | Arquivo                         | Esforço |
| ------------------ | ---- | ------------------------------- | ------- |
| ARCH-N01           | ARCH | `hook-tools.js` suspension real | 4h      |
| BUG-N03 / UPG-N07  | BUG  | Rate-limiter memory leak        | 20min   |
| SEC-N05 / UPG-N18  | SEC  | SSRF IPv6                       | 30min   |
| ARCH-N08 / UPG-N09 | ARCH | Hub shutdown gracioso           | 2h      |
| GAP-N02            | GAP  | Pipeline max steps              | 30min   |
| GAP-N12 / UPG-N11  | GAP  | Circuit breaker AgentQueue      | 4h      |
| SEC-N08 / UPG-N24  | SEC  | Socket rate-limit               | 1h      |
| PERF-N09 / UPG-N05 | PERF | Uint8Array concat O(n²)         | 15min   |
| BUG-N04 / QUAL     | QUAL | `#turnCounters` poda            | 20min   |

### Prioridade Média (backlog)

| ID       | Tipo | Esforço                         |
| -------- | ---- | ------------------------------- |
| UPG-N06  | PERF | todo-tools async I/O (3h)       |
| UPG-N08  | GAP  | Endpoint telemetry (1h)         |
| UPG-N10  | PERF | file-tools streaming (2h)       |
| UPG-N25  | QUAL | Logging JSON produção (6h)      |
| UPG-N27  | ARCH | todo-tools → SQLite (8h)        |
| UPG-N14  | ARCH | custom-agents hot-reload (4h)   |
| ARCH-N02 | ARCH | Refatorar always-alive.js (12h) |

### Prioridade Baixa (melhorias incrementais)

| ID      | Tipo | Esforço                         |
| ------- | ---- | ------------------------------- |
| UPG-N12 | GAP  | cancel(taskId) (2h)             |
| UPG-N13 | QUAL | inject.js → fetch (2h)          |
| UPG-N15 | GAP  | context:compacted event (30min) |
| UPG-N16 | PERF | semáforo explícito (2h)         |
| UPG-N17 | QUAL | Padronizar buildTool (6h)       |
| UPG-N20 | GAP  | diff_files tool (1h)            |
| UPG-N21 | GAP  | gh-bridge paginação (1h)        |
| UPG-N22 | GAP  | health/hub endpoint (1h)        |
| UPG-N23 | QUAL | X-Request-ID (30min)            |
| UPG-N28 | GAP  | OpenTelemetry (8h)              |
| UPG-N30 | ARCH | Persistência pre-send turn (3h) |

---

## Contagem de itens

| Categoria | Qtde   |
| --------- | ------ |
| BUG       | 13     |
| SEC       | 10     |
| ARCH      | 12     |
| PERF      | 7      |
| GAP       | 15     |
| QUAL      | 10     |
| UPG       | 30     |
| **Total** | **97** |

---

## Progresso de Implementação

### Batch-1 a 5 (commit `59cd209b`) — ✅ Implementado

- BUG-N01/PERF-N01, BUG-N02, BUG-N03/UPG-N07, BUG-N04 (já existia), BUG-N05, BUG-N06 (SSE
  truncation/inject), BUG-N07, BUG-N08/SEC-N01/UPG-N02, BUG-N09/N10
- PERF-N02, PERF-N06, QUAL-N09/UPG-N05
- SEC-N03 (handleInject from), SEC-N04, SEC-N05/UPG-N18, SEC-N06 (partial), SEC-N08/UPG-N24

### Batch-6 a 7 (commit `c01a2fc6`) — ✅ Implementado

- SEC-N07 (session-manager.js): sanitização de `close_key` antes de interpolação no prompt
- SEC-N09 (socket-ns.js): sanitização de `content` em `user:inject`
- SEC-N10 (sessions.js): `X-Confirm-Delete: true` obrigatório em DELETE
- ARCH-N08/UPG-N09 (hub.js): `ConversationHub.close()` com timeout gracioso
- UPG-N15 (always-alive.js): evento `context:compacted` após compaction_complete
- UPG-N22/GAP-N06 (http-handlers.js): hub stats em `/health`
- UPG-N23 (server.js): `X-Request-ID` em todos os responses
- BUG-N11 (dialog.js): restart automático do dialog loop após STOPPED
- GAP-N11/UPG-N21 (gh-bridge.js): paginação `{items, page, perPage, hasMore}` em listIssues/Prs/Runs
- UPG-N10/BUG-N12 (file-tools.js): `createReadStream` para leitura base64
- UPG-N20/GAP-N10 (file-tools.js): tool `diff_files` com `diff -u`
- GAP-N02 (server.js): `MAX_PIPELINE_STEPS = 20`
- SEC-N02/UPG-N03 (server.js): `checkWriteRate` para `/pipeline` e `/memory`
- GAP-N03/UPG-N04 (server.js): auth middleware `LLM_B_TERMINAL_TOKEN`

### Batch-8 (commit `67efa3b8`) — ✅ Implementado

- SEC-N06/UPG-N19 (sessions.js): middleware de auth Bearer `SDK_API_TOKEN` opcional para rotas SDK
- ARCH-N09/UPG-N06 (todo-tools.js): I/O assíncrono via `fs/promises` em `readStore`/`writeStore`
- UPG-N08/GAP-N14 (agent.js): alias `GET /telemetry` canônico expondo `getSummary()` SDK
- BUG-N06 (dialog.js): `hubSessionId` incluído no payload SSE (consistência com Socket.io)
- ARCH-N01 (hook-tools.js): `request_user_input` agora suspende via Promise real;
  `resolveUserInput()` exportado e integrado em `always-alive.answerPendingQuestion()`

### Batch-9 (revisão fase 4) — ✅ Implementado

Itens verificados e implementados durante revisão de AUDIT_SRC_COPILOT_4.md:

- **ARCH-N06** (always-alive.js): `MAX_QUEUE_SIZE` agora importado de `#copilot/core/constants`
  (antes campo `static MAX_QUEUE_SIZE = 100` duplicava o valor de `constants.js`); refência
  convertida de `AlwaysAliveAgent.MAX_QUEUE_SIZE` para `MAX_QUEUE_SIZE` diretamente.
- **QUAL-N02** (always-alive.js): `setMaxListeners` configurável via `AGENT_MAX_LISTENERS` env var
  (padrão 50) em vez de hardcoded.

### Status Final dos Pendentes

| Item               | Status          | Observação                                                                                                                                                              |
| ------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UPG-N16            | ✅ RESOLVIDO    | Reset `_sendTurnMutex = Promise.resolve(null)` quando `_turnQueueDepth === 0` (PERF-N06 fix em Batch-1) elimina crescimento infinito da chain                           |
| UPG-N17            | ✅ IMPLEMENTADO | commit `4d276abd` — migração completa para `buildTool` factory                                                                                                          |
| ARCH-N01 (parcial) | ✅ IMPLEMENTADO | `#setStatus('waiting_for_input')` em `always-alive.js:1406`, `_broadcastSse('waiting_for_input', …)` em `hook-tools.js:203`, POST `/answer` em `bridge-tasks.js:98-112` |
| ARCH-N05           | ✅ DOCUMENTADO  | Arquivo tem `@deprecated` JSDoc; é re-export legítimo, sem ação necessária                                                                                              |
| ARCH-N06           | ✅ IMPLEMENTADO | commit Batch-9 — importa de `constants.js`                                                                                                                              |
| QUAL-N02           | ✅ IMPLEMENTADO | commit Batch-9 — env var `AGENT_MAX_LISTENERS`                                                                                                                          |
| QUAL-N03           | ⏭ POSTERGADO    | Comentários de audit ID são documentação inline rastreável; limpeza cosmética sem impacto funcional                                                                     |

---

_Documento gerado pós-leitura integral de src/copilot/ (95 arquivos, ~22 000 linhas). Auditoria
independente de qualidade e segurança — rodrigo@._
