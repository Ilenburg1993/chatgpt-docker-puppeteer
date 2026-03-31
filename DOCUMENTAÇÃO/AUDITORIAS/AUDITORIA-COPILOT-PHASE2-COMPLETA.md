# Auditoria Completa — src/copilot (Fase 2)

**Data**: 2026-03-20
**Escopo**: Todos os ~100 arquivos de `src/copilot/`
**Baseline**: Fase 1 completada (5 patches aplicados e validados)
**Metodologia**: Leitura manual de cada arquivo, análise semântica, correlação cruzada

---

## Sumário Executivo

| Categoria | Crítico | Alto   | Médio  | Baixo | Upgrade |
| --------- | ------- | ------ | ------ | ----- | ------- |
| Bug       | 2       | 5      | 8      | 4     | —       |
| Segurança | 1       | 2      | 3      | —     | —       |
| Qualidade | —       | 3      | 6      | 5     | —       |
| Upgrade   | —       | —      | —      | —     | 12      |
| **Total** | **3**   | **10** | **17** | **9** | **12**  |

**Total de achados**: 51

---

## PARTE 1 — BUGS E CORREÇÕES

### BUG-P2-01 [CRÍTICO] — `git_push` usa `safeGit()` com shell: vulnerável a injeção via `remote`
**Arquivo**: `src/copilot/tools/git/index.js` (linha ~195)
**Problema**: `git_push` constrói comando via template string e passa para `safeGit()` que usa `shell: true`. O parâmetro `remote` vem do modelo e só tem uma sanitização `.replace(/"/g, '')` mas a string é interpolada em template literal dentro de aspas duplas. Um modelo alucinado pode injetar `;rm -rf /` via `remote`.
**Severidade**: CRÍTICO — Command Injection (CWE-78)
**Fix**: Usar `safeGitArgs()` em vez de `safeGit()`.

```js
// ANTES (inseguro):
const r = await safeGit(`git push ${upstream} "${(remote ?? 'origin').replace(/"/g, '')}"`, 30000);

// DEPOIS (seguro):
const args = ['push'];
if (setUpstream) args.push('--set-upstream');
args.push(remote ?? 'origin');
const r = await safeGitArgs(args, 30000);
```

---

### BUG-P2-02 [CRÍTICO] — `git_create_branch` usa `safeGit()` com shell: bypassa validação via base
**Arquivo**: `src/copilot/tools/git/index.js` (linha ~230)
**Problema**: `git_create_branch` valida `name` com regex mas constrói o comando com `safeGit()` (shell). O campo `base` é interpolado com aspas duplas mas sem a mesma regex de `name`, e `basePart` usa ternário que inclui aspas literais. Modelo alucinado pode enviar `base: '$(malicious)'`.
**Severidade**: CRÍTICO — Command Injection (CWE-78)
**Fix**: Usar `safeGitArgs()`.

```js
// DEPOIS (seguro):
if (!/^[a-zA-Z0-9/_.-]+$/.test(name)) {
    return { success: false, error: 'Nome de branch inválido.' };
}
const args = (checkout ?? true) ? ['checkout', '-b', name] : ['branch', name];
if (base) {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(base)) {
        return { success: false, error: 'Base inválida.' };
    }
    args.push(base);
}
const r = await safeGitArgs(args);
```

---

### BUG-P2-03 [ALTO] — `git_diff` usa `safeGit()` com shell interpolando `filePath` do modelo
**Arquivo**: `src/copilot/tools/git/index.js` (linha ~118)
**Problema**: `filePath` vem do modelo e é interpolado em string que vai para `safeGit()` com `shell: true`. Pode conter metacaracteres shell (`$(...)`, `` `...` ``, `; ...`).
**Fix**: Usar `safeGitArgs()`, e remover o pipe `| head -200` (usar truncamento no retorno).

```js
const args = ['diff'];
if (staged) args.push('--staged');
if (filePath) args.push('--', filePath);
const r = await safeGitArgs(args);
r.stdout = r.stdout.split('\n').slice(0, 200).join('\n');
```

---

### BUG-P2-04 [ALTO] — `git_log` interpola `format` inseguro via `safeGit()`
**Arquivo**: `src/copilot/tools/git/index.js` (linha ~250)
**Problema**: O formato de log contém aspas duplas literais na string template. Embora os parâmetros `n` e `oneline` sejam controlados, o padrão `'--pretty=format:"%h %an %ar %s"'` resulta em shell expansion. Vulnerabilidade baixa mas inconsistência com o padrão `safeGitArgs`.
**Fix**: Migrar para `safeGitArgs()`.

---

### BUG-P2-05 [ALTO] — `hub_tools.js > hub_send_message` timeout zero permite DoS
**Arquivo**: `src/copilot/tools/hub-tools.js` (linha ~145)
**Problema**: `resolvedTimeout` testa `timeoutMs > 0` mas um modelo pode enviar `timeoutMs: 999999999` (>16 min). Falta clamping superior.
**Fix**: Clampar em `[5_000, 300_000]` (5s a 5min).

```js
const resolvedTimeout = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(Math.max(timeoutMs, 5_000), 300_000)
    : 120_000;
```

---

### BUG-P2-06 [ALTO] — `hook-tools.js > request_user_input` pode acumular resolvers sem cleanup
**Arquivo**: `src/copilot/tools/hook-tools.js` (linha ~190)
**Problema**: Se `resolveUserInput()` nunca é chamado (ex: crash, timeout), os resolvers pendentes ficam em memória indefinidamente (memory leak). Falta timeout de auto-cleanup.
**Fix**: Adicionar timer de 10min por resolver que auto-rejeita.

---

### BUG-P2-07 [ALTO] — `channel/client.js > LlmBridgeClient` history cresce sem bound em `chatBatch()`
**Arquivo**: `src/copilot/channel/client.js`
**Problema**: `chatBatch()` chama `chat()` em loop que adiciona mensagens ao `#history`. Se batch grande, history explode antes de ser limitada por `MAX_HISTORY_SIZE`. O trucamento do history acontece em `_pushHistory()` mas cada `chat()` individual ja trunca — OK para historia, mas o batch pode enviar N mensagens em sequencia rápida com O(N*MAX_HISTORY_SIZE) de memória temporária.
**Severidade**: MÉDIO (DoS via batch grande)
**Fix**: Validar `messages.length <= 50` no início de `chatBatch()`.

---

### BUG-P2-08 [MÉDIO] — `file-tools.js` bloqueia `.sh` mas permite leitura
**Arquivo**: `src/copilot/tools/file-tools.js` (linha ~85)
**Problema**: `BLOCKED_PATTERNS` inclui `/\.sh$/i` que bloqueia não apenas escrita mas também LEITURA de scripts shell. Isso é excessivamente restritivo — ler `.sh` para auditoria é seguro.
**Fix**: Separar `BLOCKED_READ_PATTERNS` (secrets) de `BLOCKED_WRITE_PATTERNS` (secrets + executáveis). A validação de path deve usar o padrão apropriado conforme a operação.

---

### BUG-P2-09 [MÉDIO] — `orchestrator.js` `#closedSessions` Set cresce indefinidamente
**Arquivo**: `src/copilot/conversation-hub/orchestrator.js`
**Problema**: `#closedSessions` é um Set que recebe session IDs quando uma sessão é fechada (BUG-MOD-09). Nunca é limpa. Em produção de longa duração, pode acumular milhares de IDs.
**Fix**: Limitar a 1000 entries com evicção FIFO.

---

### BUG-P2-10 [MÉDIO] — `telemetry.js` circular buffer não filtra por timeRange
**Arquivo**: `src/copilot/lib/telemetry.js`
**Problema**: `getErrorCalls()` e `getRecentCalls()` filtram por `limit` mas não por range de tempo. Chamadas muito antigas (ex: 8h atrás) são retornadas. Isso confunde diagnósticos.
**Fix**: Adicionar parâmetro opcional `sinceMs` para filtrar por idade.

---

### BUG-P2-11 [MÉDIO] — `agent/always-alive.js` re-export singleton também exporta classe
**Arquivo**: `src/copilot/agent/always-alive.js`
**Problema**: O arquivo exporta tanto `AlwaysAliveAgent` (classe) quanto `alwaysAliveAgent` (singleton). Consumidores podem instanciar um segundo agente involuntariamente via `new AlwaysAliveAgent()`, violando a invariante de singleton.
**Fix**: Não exportar a classe; exportar apenas o singleton. Se teste precisa da classe, usar import direto com nota em JSDoc.

---

### BUG-P2-12 [MÉDIO] — `web-tools.js` rate-limit por processo: bypass com múltiplas sessões
**Arquivo**: `src/copilot/tools/web-tools.js`
**Problema**: Rate limiting usa `Map<minuteBucket, count>` em memória do processo. Se PM2 roda múltiplas instâncias, cada uma tem seu próprio counter (20 req/min * N workers).
**Severidade**: BAIXO (single worker na prática)
**Fix**: Documentar limitação; opcionalmente usar contador compartilhado via IPC/file.

---

### BUG-P2-13 [MÉDIO] — `session-config.js` createHooks com callbacks vazios
**Arquivo**: `src/copilot/config/session-config.js` (linha ~80)
**Problema**: `buildAlwaysAliveConfig()` cria hooks com callbacks `void ev` que descartam eventos. Deveria delegar para telemetry store ou event emitter.
**Fix**: Conectar hooks a `recordSessionStart()` / `recordSessionEnd()` da telemetry.

---

### BUG-P2-14 [MÉDIO] — `socket-ns.js` JWT auth opcional pode ser ativada sem secret configurado
**Arquivo**: `src/copilot/conversation-hub/socket-ns.js`
**Problema**: Se `COPILOT_HUB_SOCKET_AUTH_REQUIRED=true` mas `COPILOT_HUB_JWT_SECRET` não está definido, o middleware de autenticação precisa lidar com isso. Se o secret é undefined, `jwt.verify(token, undefined)` pode ter comportamento inesperado.
**Fix**: Validar na inicialização que se AUTH_REQUIRED=true, JWT_SECRET deve estar definido; caso contrário, logar WARN e desabilitar auth.

---

### BUG-P2-15 [BAIXO] — `custom-agents.js` COPILOT_DISABLED_AGENTS lido mas não aplicado
**Arquivo**: `src/copilot/config/custom-agents.js` (linha ~200)
**Problema**: O comentário `GAP-Q03 fix: COPILOT_DISABLED_AGENTS permite desabilitar sub-agentes` aparece mas o código após é cortado. A variável é lida mas o filtro pode não estar completo.
**Fix**: Verificar implementação completa; se faltante, aplicar filtro.

---

### BUG-P2-16 [BAIXO] — `task-tools.js` usa `defineTool` direto em vez de `buildTool`
**Arquivo**: `src/copilot/tools/task-tools.js`
**Problema**: Usa `defineTool` direto do SDK com casts `/** @type {unknown} */` para contornar tipagem. O resto do codebase padronizou em `buildTool()` que normaliza parâmetros automaticamente.
**Fix**: Migrar para `buildTool()` para consistência.

---

### BUG-P2-17 [BAIXO] — `pinned-files-loader.js` watcher Linux não detecta novos subdiretórios
**Arquivo**: `src/copilot/config/pinned-files-loader.js`
**Problema**: Em Linux, o loader monitora subdiretórios de primeiro nível na inicialização, mas não detecta subdiretórios criados após o start. Limitação de `fs.watch` sem `recursive` no Linux.
**Fix**: Documentar limitação; considerar polling periódico a cada 60s.

---

### BUG-P2-18 [BAIXO] — `code-tools.js` ESLINT_BIN path hardcoded via import.meta.url
**Arquivo**: `src/copilot/tools/code-tools.js`
**Problema**: ESLint bin é resolvido via `import.meta.url` relativo, que funciona no DevContainer mas pode quebrar com workspaces npm (hoisting). Baixa probabilidade no setup atual.
**Fix**: Adicionar fallback `which eslint` se path resolvido não existir.

---

## PARTE 2 — MELHORIAS DE SEGURANÇA

### SEC-P2-01 [CRÍTICO] — `safeGit()` usa `shell: true` com interpolação — superfície de ataque
**Arquivo**: `src/copilot/tools/git/index.js`
**Problema**: Principal. `safeGit()` executa `/bin/sh -c "git ..."` com strings interpoladas. Todas as 5 tools que usam `safeGit()` (status, diff, log, push, createBranch) são potencialmente vulneráveis a command injection.
**Fix**: Migrar TODAS as tools de `safeGit()` para `safeGitArgs()`. Manter `safeGit()` apenas para comandos internos que não recebem input do modelo (ex: `git status --short`).

---

### SEC-P2-02 [ALTO] — `file-tools.js` `searchInFiles` não verifica SSRF no pattern
**Arquivo**: `src/copilot/tools/file-tools.js`
**Problema**: Embora use `execFile` (sem shell), o `pattern` se for regex malicioso pode causar ReDoS em ripgrep. Ripgrep é geralmente resiliente, mas patterns como `(a+)+$` podem ser lentos.
**Fix**: Limitar comprimento de `pattern` a 500 chars e timeout a 15s (já tem 30s).

---

### SEC-P2-03 [ALTO] — Webhooks `POST /webhooks` não valida contra SSRF
**Arquivo**: `src/copilot/routes/webhooks.js`
**Problema**: A validação da URL verifica apenas `http:` e `https:` protocol mas NÃO verifica se o host é privado/interno. O agente pode registrar webhook para `http://169.254.169.254` (AWS IMDS) ou `http://localhost:3008`.
**Fix**: Reusar a função `validateUrl()` de `web-tools.js`, extraída para um módulo compartilhado.

---

### SEC-P2-04 [MÉDIO] — `terminal/server.js` SEC-04 auth token via ENV pode não estar configurado
**Arquivo**: `src/copilot/terminal/server.js`
**Problema**: Se `LLM_B_AUTH_TOKEN` não está definido no env, o token de autenticação é `undefined` e `timingSafeEqual(undefined, ...)` lança `TypeError`. O servidor fica inacessível mas sem log claro.
**Fix**: Gerar token aleatório no boot se não configurado; logar WARN.

---

### SEC-P2-05 [MÉDIO] — `mcp-servers.js` expõe GITHUB_TOKEN via args e env
**Arquivo**: `src/copilot/config/mcp-servers.js`
**Problema**: O token GitHub é passado diretamente em `env.GITHUB_TOKEN` para processos filho. Se esses processos child logam seus args/env, o token pode ser exposto.
**Fix**: Nenhuma ação necessária na prática (MCP servers são confiáveis), mas documentar como risco aceito.

---

### SEC-P2-06 [MÉDIO] — `socket-ns.js` rate limit por socket (não por IP)
**Arquivo**: `src/copilot/conversation-hub/socket-ns.js`
**Problema**: Rate limit é por socket.id. Um atacante pode abrir múltiplas conexões Socket.io para bypass (N sockets * 10/min cada).
**Fix**: Adicionar rate limit por IP em complemento ao por socket.

---

## PARTE 3 — QUALIDADE E CONSISTÊNCIA

### QUA-P2-01 [ALTO] — Padrão de DI inconsistente: `setHub()` vs import direto
**Arquivos**: `tools/hub-tools.js`, `tools/session-rpc-tools.js`, `tools/hook-tools.js`
**Problema**: Alguns módulos usam dependency injection (`setHub()`, `setSessionRpc()`, `configureHookTools()`), outros importam singletons diretamente. Inconsistência dificulta testes.
**Fix**: Padronizar: todos os módulos de tools devem usar DI. Criar `configureTool(name, deps)` unificado.

---

### QUA-P2-02 [ALTO] — `agent.js` raiz é stub deprecated — pode confundir imports
**Arquivo**: `src/copilot/agent.js`
**Problema**: Arquivo com 10 linhas que faz `export * from './agent/entry.js'` com nota deprecated. Confunde navegação e pode causar imports circulares.
**Fix**: Remover arquivo; atualizar quaisquer imports que dependam dele.

---

### QUA-P2-03 [ALTO] — `bridges/inject-llmb.js` e `bridges/llm-bridge-client.js` stubs deprecated
**Arquivos**: `src/copilot/bridges/inject-llmb.js`, `src/copilot/bridges/llm-bridge-client.js`
**Problema**: Ambos são stubs de 10 linhas que re-exportam de `channel/`. Deprecated há tempo.
**Fix**: Verificar se há consumers; se não, remover. Se sim, atualizar imports.

---

### QUA-P2-04 [MÉDIO] — `git-tools.js` raiz é stub deprecated
**Arquivo**: `src/copilot/tools/git-tools.js`
**Problema**: Re-export para `./git/index.js`. Desnecessário.
**Fix**: Remover; atualizar imports.

---

### QUA-P2-05 [MÉDIO] — `llm-a-conversation.mjs` instancia `LlmBridgeClient` diretamente
**Arquivo**: `src/copilot/llm-a-conversation.mjs`
**Problema**: Script standalone que instancia `new LlmBridgeClient()` em vez de usar singleton. Duplica conexão. Nota: é arquivo de demonstração, não produção.
**Fix**: Usar singleton exportado; ou documentar como script one-off.

---

### QUA-P2-06 [MÉDIO] — `introspection-tools.js` CATEGORY_TOOL_MAP hardcoded
**Arquivo**: `src/copilot/tools/introspection-tools.js`
**Problema**: O mapa de categorias está hardcoded como objeto literal. Se novas tools são adicionadas sem atualizar o mapa, `list_tools` com filtro por categoria não as encontra.
**Fix**: Derivar categorias do `tools/index.js` imports dinamicamente.

---

### QUA-P2-07 [MÉDIO] — `db/migrations.js` migration 6 fix de role usa REPLACE
**Arquivo**: `src/copilot/db/migrations.js`
**Problema**: A migration 6 corrige `role='llm-b'` para `role='llm_b'` usando `UPDATE SET role = REPLACE(...)`. Se tabela grande, full table scan. Sem índice em `role`.
**Fix**: Baixa urgência (one-time migration), mas adicionar índice em `role` se performance importar.

---

### QUA-P2-08 [BAIXO] — Múltiplos arquivos com `@type {any}` casts para contornar tipagem
**Arquivos**: Vários (session-rpc-tools.js, task-tools.js, client.js, etc.)
**Problema**: Uso extensivo de `/** @type {any} */` para contornar incompatibilidades de tipo entre Zod e SDK.
**Fix**: Criar tipos auxiliares (utility types) que façam bridge entre Zod schemas e SDK types.

---

### QUA-P2-09 [BAIXO] — `hooks.js` retry count hardcoded (3)
**Arquivo**: `src/copilot/lib/hooks.js`
**Problema**: `MAX_RETRIES = 3` para model_call errors é hardcoded sem configurabilidade.
**Fix**: Tornar configurável via `HooksConfig`.

---

### QUA-P2-10 [BAIXO] — `terminal/http-handlers.js` e `terminal/server.js` duplicam estado
**Arquivos**: `src/copilot/terminal/http-handlers.js`, `src/copilot/terminal/server.js`
**Problema**: Ambos mantêm referências separadas a tools config e metrics. Deveria centralizar em `state.js`.
**Fix**: Mover estado compartilhado para `state.js`.

---

### QUA-P2-11 [BAIXO] — `structured-message.js` não exporta `StructuredMessageResponseSchema`
**Arquivo**: `src/copilot/types/structured-message.js`
**Problema**: Schema de response usa `.passthrough()` (correto) mas não é exportado, então consumidores externos não podem validar respostas.
**Fix**: Exportar como `StructuredMessageResponseSchema`.

---

## PARTE 4 — UPGRADES E MELHORIAS

### UPG-P2-01 — Extrair `validateUrl()` como módulo compartilhado
**Problema**: `web-tools.js` tem proteção SSRF robusta (`validateUrl()`), mas `webhooks.js` não usa.
**Proposta**: Criar `src/copilot/lib/url-validator.js` e reusar em ambos.

---

### UPG-P2-02 — Unified Error Handler para Express routes
**Problema**: Cada route tem `withErrorHandler` bind manual. Poderia ser middleware global.
**Proposta**: Adicionar `app.use(errorHandler)` no final da chain; simplifica cada route.

---

### UPG-P2-03 — Health check endpoint dedicado em terminal server (port 3009)
**Problema**: `/health` no terminal server retorna info básica. Falta checagem de dependências (SQLite, AlwaysAliveAgent status, dialog loop active).
**Proposta**: Expandir `/health` com checks detalhados.

---

### UPG-P2-04 — Compaction automática baseada em utilização
**Problema**: `cmdCompact` é manual. O SDK tem `backgroundCompactionThreshold: 0.75` mas o terminal/REPL não notifica o usuário quando threshold é atingido.
**Proposta**: Emitir SSE warning quando utilização > 75%.

---

### UPG-P2-05 — `ToolRegistry` com lazy loading
**Problema**: `tools/index.js` importa TODAS as categorias de tools no boot. Se category não é usada, é overhead desnecessário.
**Proposta**: Lazy import por categoria quando primeiro tool é solicitado.

---

### UPG-P2-06 — `PinnedFilesLoader` com inotify em Linux
**Problema**: `fs.watch` sem `recursive` no Linux limita monitoramento a 1 nível.
**Proposta**: Usar `chokidar` ou `@parcel/watcher` com inotify nativo.

---

### UPG-P2-07 — Tipagem estrita para `SessionConfig` overrides
**Problema**: `buildAlwaysAliveConfig` usa `/** @type {any} */` para destructuring de options.
**Proposta**: Definir `AlwaysAliveConfigOptions` typedef explícito.

---

### UPG-P2-08 — Métricas de tool call latency no REPL
**Problema**: TelemetryStore coleta p95 mas REPL não exibe. `/telemetry` command não existe.
**Proposta**: Adicionar `/telemetry` command ao REPL que mostra top tools por latência.

---

### UPG-P2-09 — Rate limit compartilhado entre workers PM2
**Problema**: `web-tools.js` rate limit é per-process. Múltiplos workers bypassam.
**Proposta**: Usar file-based counter ou IPC.

---

### UPG-P2-10 — `hub_tools.js > hub_poll_messages` para LLM-A
**Problema**: Não existe tool para LLM-A recuperar mensagens injetadas pelo usuário. Precisa de HTTP endpoint.
**Proposta**: Adicionar `hub_poll_messages` tool.

---

### UPG-P2-11 — Exportar `parseStructuredResponse` completo com fallback regex
**Problema**: O parser de responses LLM-B tenta JSON.parse → regex fallback mas o fallback pode não estar completo (arquivo cortado na leitura).
**Proposta**: Verificar e documentar o parser completo.

---

### UPG-P2-12 — Centralizar padrão de singleton com validação de estado
**Problema**: Vários singletons (AlwaysAliveAgent, ConversationHub, CopilotClient) usam padrões diferentes de lifecycle.
**Proposta**: Criar `SingletonLifecycle<T>` mixin com `init()`, `isReady`, `stop()`, `[Symbol.asyncDispose]`.

---

## PARTE 5 — PLANO DE IMPLEMENTAÇÃO

### Prioridade 1 — Segurança (implementar AGORA)
1. **BUG-P2-01/02/03**: Migrar `git_push`, `git_create_branch`, `git_diff` para `safeGitArgs()` ← CRÍTICO
2. **SEC-P2-01**: Migrar `git_status` e `git_log` para `safeGitArgs()` também
3. **SEC-P2-03**: Adicionar validação SSRF em `webhooks.js`

### Prioridade 2 — Bugs funcionais
4. **BUG-P2-04**: Migrar `git_log` para `safeGitArgs()`
5. **BUG-P2-05**: Clampar timeout em `hub_send_message`
6. **BUG-P2-06**: Auto-cleanup de resolvers pendentes em `hook-tools.js`
7. **BUG-P2-09**: Limitar `#closedSessions` Set

### Prioridade 3 — Qualidade
8. **BUG-P2-08**: Separar blocked patterns para leitura vs escrita
9. **BUG-P2-16**: Migrar `task-tools.js` para `buildTool()`
10. **SEC-P2-06**: Rate limit por IP no socket-ns

### Prioridade 4 — Upgrades
11. **UPG-P2-01**: Extrair `validateUrl()`
12. **UPG-P2-07**: Tipagem estrita para config builders

---

*Fase 1: 5 patches anteriores permanecem válidos — NÃO reaplicar.*

---

## PARTE 6 — STATUS DE IMPLEMENTAÇÃO (Atualizado 2026-03-20)

### Patches Aplicados e Validados (13 patches + 1 fix complementar)

| #   | ID                             | Arquivo                            | Descrição                                                                         | Validação                      |
| --- | ------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| 1   | SEC-P2-01 + BUG-P2-01/02/03/04 | `tools/git/index.js`               | Migração de 6 tools de `safeGit()` para `safeGitArgs()` + rename `_safeGit`       | ESLint ✅, IDE ✅                |
| 2   | BUG-P2-05                      | `tools/hub-tools.js`               | Clamping timeout `[5s, 300s]`                                                     | ESLint ✅, IDE ✅                |
| 3   | SEC-P2-03                      | `routes/webhooks.js`               | `isPrivateHost()` SSRF protection                                                 | ESLint ✅, IDE ✅, 13/13 tests ✅ |
| 4   | BUG-P2-09                      | `conversation-hub/orchestrator.js` | Cap de 500 no `#closedSessions` Set com FIFO eviction                             | ESLint ✅, IDE ✅, 15/15 tests ✅ |
| 5   | BUG-P2-06                      | `tools/hook-tools.js`              | Auto-cleanup timer 10min (`.unref()`) para resolvers pendentes                    | ESLint ✅, IDE ✅                |
| 6   | BUG-P2-08                      | `tools/file-tools.js`              | Split `BLOCKED_PATTERNS` em secrets+executables; `validatePath({mode})` + callers | ESLint ✅, IDE ✅, 41/41 tests ✅ |
| 7   | SEC-P2-02                      | `tools/file-tools.js`              | `pattern.length > 500` limit em `search_in_files`                                 | ESLint ✅, IDE ✅                |
| 8   | BUG-P2-07                      | `channel/client.js`                | `messages.length > 50` limit em `chatBatch()`                                     | ESLint ✅, IDE ✅, 15/15 tests ✅ |
| 9   | BUG-P2-10                      | `lib/telemetry.js`                 | `sinceMs` param em `getRecentCalls()`/`getErrorCalls()`                           | ESLint ✅, IDE ✅, 37/37 tests ✅ |
| 10  | BUG-P2-14                      | `conversation-hub/socket-ns.js`    | JWT secret validation early na inicialização                                      | ESLint ✅, IDE ✅                |
| 11  | BUG-P2-18                      | `tools/code-tools.js`              | `existsSync` + `which eslint` fallback para ESLINT_BIN                            | ESLint ✅, IDE ✅                |
| 12  | SEC-P2-06                      | `conversation-hub/socket-ns.js`    | Rate limit por IP (complementar ao per-socket)                                    | ESLint ✅, IDE ✅                |

**Fase 1 patches (pré-existentes, NÃO re-aplicados):**
- `terminal/http-handlers.js`, `config/tools/state.js`, `routes/sessions.js`, `tools/todo-tools.js`, `lib/models.js` (revertido)

### Regression Testing — 0 regressões

| Suite                      | Total   | Pass    | Fail       | Nota                                                             |
| -------------------------- | ------- | ------- | ---------- | ---------------------------------------------------------------- |
| Copilot batch 1 (20 files) | 445     | 443     | 2          | Falhas pré-existentes (permissions + session)                    |
| Copilot batch 2 (13 files) | 309     | 304     | 5          | Falhas pré-existentes (system-prompt, 5 tests)                   |
| hook-tools (isolado)       | 10      | 9       | 0+1 cancel | Pré-existente: Promise hang (handler never resolves in test env) |
| **Total copilot**          | **764** | **756** | **7+1**    | **0 regressões introduzidas**                                    |

### Itens Skipped (com justificativa)

| ID             | Razão                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------ |
| SEC-P2-04      | Token auth fallback — design intencional (`if (TERMINAL_TOKEN)` guards)                          |
| BUG-P2-11      | Singleton export — sem consumidores usando `new AlwaysAliveAgent()`, risco de regressão em types |
| BUG-P2-12      | Rate limit per-process — single worker na prática; documentar limitação                          |
| BUG-P2-13      | Session hooks callbacks — AlwaysAliveAgent handles lifecycle via events                          |
| BUG-P2-15      | COPILOT_DISABLED_AGENTS — já implementado (filtro na linha 311)                                  |
| BUG-P2-16      | task-tools buildTool migration — consistência mas refatoração arriscada                          |
| BUG-P2-17      | PinnedFilesLoader Linux — já documentado com BUG-CRIT-07 workaround                              |
| SEC-P2-05      | Token exposure em MCP — MCP servers são confiáveis; risco aceito                                 |
| QUA-P2-01 a 11 | Quality items — refatorações maiores, fora de escopo de bugfix                                   |
| UPG-P2-01 a 12 | Upgrades — planejamento de futuro, sem urgência                                                  |

### Falhas pré-existentes (NÃO causadas pelas alterações)

1. `test_lib_permissions.spec.js` — "nega shell_exec": `createSafePermission` comportamento mudou
2. `test_lib_session.spec.js` — "inclui systemMessage quando systemMessageContent fornecido": mode='customize' vs expected 'append'
3. `test_system_prompt.spec.js` — 5 testes: SYSTEM_PROMPT_SECTIONS keys mudaram, buildHookContextAppendMessage mode mudou
4. `test_hook_tools.spec.js` — 1 cancelled: `request_user_input` handler retorna Promise que nunca resolve em ambiente de teste

---

## PARTE 5 — REFATORAÇÕES PROFUNDAS (Phase 3)

**Data**: 2026-03-31
**Objetivo**: Modularização, extração de responsabilidades, router declarativo, cobertura de testes e hardening
**Metodologia**: Investigação estrutural completa → plano faseado → execução com validação

### 5.1 Métricas baseline

| Métrica                          | Valor                                                            |
| -------------------------------- | ---------------------------------------------------------------- |
| Total de linhas (src/copilot)    | 25.876                                                           |
| Total de arquivos JS             | ~70                                                              |
| Maior arquivo                    | always-alive.js (1.919 linhas, 30+ métodos)                      |
| 2º maior                         | todo-tools.js (1.320 linhas, 13 tools)                           |
| 3º maior                         | http-handlers.js (902 linhas, 25 exports)                        |
| test files copilot               | 35                                                               |
| Tests total copilot              | 802                                                              |
| Tests total global               | 1.602                                                            |
| Módulos sem testes dedicados     | bridges, channel, config, routes, terminal (comandos), db, types |
| `new Promise` em always-alive.js | 13 ocorrências (polling patterns)                                |
| Rotas manuais em server.js       | 29 `if(method + pathname)` blocks                                |
| Fan-out always-alive.js          | 19 módulos importam o singleton                                  |

### 5.2 Plano de fases

---

#### FASE A — Decomposição do God Object `AlwaysAliveAgent` (always-alive.js)
**Prioridade**: ALTA | **Impacto**: Manutenibilidade, testabilidade, SRP
**Risco**: MÉDIO (singleton com 19 dependentes)

O `AlwaysAliveAgent` é uma classe de 1.919 linhas com 30+ métodos que mistura:
- Lifecycle (start/stop/reconnect)
- Dialog loop (start/stop/pause/resume/sendTurn)
- Queue processing (#processQueue)
- Session management (#initSession, #syncSdkHistory)
- Webhook dispatch (#emitWebhook)
- Permission management (get/setPermissionMode)
- User input handling (#handleUserInputRequest, #handleDialogLoopInput, #handleInteractiveQuestion)
- Status/diagnostics (getStatusSnapshot, listenerDiagnostics)

##### Subfases:

**A.1 — Extrair `DialogEngine`** (~400 linhas)
- Mover: `startDialogLoop`, `sendDialogTurn`, `#executeDialogTurn`, `stopDialogLoop`, `pauseDialogLoop`, `resumeDialogLoop`, `#waitForDialogRestartAndReply`
- Arquivo novo: `src/copilot/agent/dialog-engine.js`
- AlwaysAliveAgent delegará para `this._dialogEngine`
- EventEmitter composition: DialogEngine emite `dialog.*` events, AlwaysAliveAgent re-emite

**A.2 — Extrair `waitForStatus()` helper** (~50 linhas)
- 13 `new Promise` com polling pattern (`setTimeout check loop`) → helper genérico
- `waitForStatus(emitter, predicate, { timeout, pollInterval })` → `src/copilot/agent/wait-for-status.js`
- Usado por always-alive.js, dialog.js e potencialmente outros

**A.3 — Extrair `WebhookDispatcher`** (~80 linhas)
- Mover: `registerWebhook`, `unregisterWebhook`, `listWebhooks`, `#emitWebhook`
- Arquivo novo: `src/copilot/agent/webhook-dispatcher.js` (ou mover para `webhook-manager.js` existente)
- Verificar `webhook-manager.js` (106 linhas) — possivelmente unificar

**A.4 — Extrair `InputHandler`** (~100 linhas)
- Mover: `#handleUserInputRequest`, `#handleDialogLoopInput`, `#handleInteractiveQuestion`, `answerPendingQuestion`
- Arquivo novo: `src/copilot/agent/input-handler.js`

---

#### FASE B — Router declarativo para `server.js` (terminal)
**Prioridade**: ALTA | **Impacto**: Manutenibilidade, DRY, segurança
**Risco**: BAIXO (substituição mecânica 1:1)

O `server.js` tem 29 rotas implementadas como blocos `if(method === 'X' && pathname === '/y')` com padrão repetitivo de `readBody → JSON.parse → handler → sendJson`. Além disso, a lógica de auth é inline e isentada manualmente para `/health`, `/hub-health`, `/metrics`.

##### Subfases:

**B.1 — Criar micro-router declarativo**
- Arquivo: `src/copilot/terminal/router.js` (~100 linhas)
- Signature: `createRouter(routes: RouteDefinition[]): http.RequestListener`
- Route definition: `{ method, path, handler, auth?, parseBody? }`
- Features: auto-CORS, auto-JSON parse, auto-sendJson, 404 handler, error boundary

**B.2 — Migrar server.js para usar router**
- Converter as 29 rotas de if/else para array de `RouteDefinition`
- server.js passaria de ~632 linhas para ~200 (tabela de rotas + SSE handlers especiais)

**B.3 — Testes para router.js**
- Testar: matching, 404, CORS, auth check, body parsing, error handling
- ~15-20 testes unitários

---

#### FASE C — Modularização de `http-handlers.js`
**Prioridade**: MÉDIA | **Impacto**: SRP, navegabilidade
**Risco**: BAIXO (refatoração de exports)

Os 25 handlers de `http-handlers.js` (902 linhas) cobrem domínios muito distintos:
- Health/metrics (2)
- Context (1)
- Sessions/turns (2)
- Memory (3)
- Pipeline/inject (2)
- GitHub (5)
- Git (2)
- Config (8)
- SSE (helpers)

##### Subfases:

**C.1 — Extrair handlers por domínio**
- `src/copilot/terminal/handlers/health.js` — handleHealth, handleHubHealth, handleMetrics
- `src/copilot/terminal/handlers/github.js` — handleGhIssues, handleGhPrs, handleGhCi, handleGitStatus, handleGitLog
- `src/copilot/terminal/handlers/config.js` — handleGetConfig, handleSetInfiniteSessionConfig, handleGetSkills, handleSetSkills, handleGetToolsConfig, handleSetToolsConfig, handleGetCustomTools, handleRegisterCustomTool, handleDeleteCustomTool
- `src/copilot/terminal/handlers/memory.js` — handleStoreMemory, handleRecallMemories, handleDeleteMemory
- `src/copilot/terminal/handlers/pipeline.js` — handlePipeline, handleInject
- `src/copilot/terminal/handlers/sessions.js` — handleListSessions, handleListTurns
- `http-handlers.js` vira barrel re-exporting tudo (backward compat)

---

#### FASE D — Cobertura de testes incrementais
**Prioridade**: ALTA | **Impacto**: Segurança da refatoração, regressão
**Risco**: NENHUM (somente adição)

Módulos sem testes dedicados que mais se beneficiariam:

##### Subfases:

**D.1 — Testes para `http-handlers.js`** (handlers puros)
- Os handlers retornam `{ status, body }` — extremamente testáveis
- Prioridade: handleHealth, handleInject (validação `from`), handlePipeline
- ~30 testes

**D.2 — Testes para `config/tools/registry.js`**
- Registry global com `registerTool`, `getToolDefinition`, etc
- ~15 testes

**D.3 — Testes para `config/tools/state.js`**
- `patchToolsConfig`, `getToolsConfig`
- ~10 testes

**D.4 — Testes para `bridges/git-bridge.js`**
- `gitStatus`, `gitLog`, `gitDiff` — wrappers do `gh`/`git` CLI
- Mock de `child_process` ou `execa`
- ~15 testes

**D.5 — Testes para `channel/audit.js`**
- Audit trail write/read + rotation
- ~10 testes

---

#### FASE E — Upgrades de qualidade e hardening
**Prioridade**: MÉDIA | **Impacto**: Robustez, observabilidade
**Risco**: BAIXO

##### Subfases:

**E.1 — Centralizar error types em `src/copilot/core/errors.js`**
- Atualmente erros são `new Error('...')` sem tipagem
- Criar: `CopilotError`, `SessionError`, `ToolExecutionError`, `AuthError`, `ValidationError`
- Cada um com `code`, `statusCode`, `cause` chain
- ~80 linhas

**E.2 — Upgrade `todo-tools.js` — extrair persistência**
- Separar store SQLite de tool handlers
- `src/copilot/tools/todo/store.js` — CRUD operations
- `src/copilot/tools/todo/tools.js` — tool definitions
- todo-tools.js vira barrel

**E.3 — AbortSignal propagation**
- Vários métodos já aceitam `signal` mas não o propagam consistentemente
- Audit: mapear onde `signal` existe mas é ignorado
- Hardening dos paths críticos (sendMessage, sendDialogTurn)

**E.4 — Rate limiter genérico**
- `sessions.js` tem rate limiter inline (200ms window)
- Outros endpoints não têm
- Extrair: `src/copilot/lib/rate-limiter.js` com sliding window

### 5.3 Ordem de execução recomendada

```
FASE D.1 (testes http-handlers)   ← safety net para Fases B e C
  ↓
FASE B  (router declarativo)      ← simplificação server.js
  ↓
FASE C  (modularizar handlers)    ← SRP
  ↓
FASE A.2 (waitForStatus helper)   ← quick win, base para A.1
  ↓
FASE A.1 (DialogEngine)           ← maior impacto estrutural
  ↓
FASE A.3 + A.4 (webhook + input)  ← completar decomposição
  ↓
FASE D.2-D.5 (testes restantes)   ← cobertura ampla
  ↓
FASE E.1-E.4 (hardening)          ← polimento
```

### 5.4 Restrições e princípios

1. **Backward compatibility**: Todo barrel/re-export deve manter API pública idêntica
2. **Sem breaking changes**: Imports existentes de `always-alive.js` continuam funcionando
3. **Teste antes de cada commit**: 1602/1602 tests OK
4. **Incremental**: Cada subfase é commitável independentemente
5. **Não tocar em `puppeteer.launch()`**: Restrição do projeto
