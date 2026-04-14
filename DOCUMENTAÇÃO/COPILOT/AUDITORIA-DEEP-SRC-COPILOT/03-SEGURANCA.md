# 03 — SEGURANÇA

> **Auditoria Profunda `src/copilot/`** | Data: 2026-06-11 | HEAD: `55a4b071`

---

## SUMÁRIO

| Severidade    | Quantidade |
| ------------- | ---------- |
| Crítico (S-C) | 4          |
| Alto (S-A)    | 11         |
| Médio (S-M)   | 15         |
| Baixo (S-B)   | 8          |
| **Total**     | **38**     |

---

## VULNERABILIDADES CRÍTICAS (S-C)

### S-C-01 — Auth desabilitado silenciosamente quando JWT_SECRET é inválido
**Arquivo**: `server/socket/hub-ns.js:121`
```js
log('WARN', `[hub-ns/copilot] JWT_SECRET inválido: ${secretErr.message}. Auth desabilitado.`);
```
**Impacto**: CVSS ~8.5. Qualquer client Socket.IO pode se conectar ao namespace `/copilot` sem autenticação. O agente executa tools (shell, file write, git) — acesso irrestrito permite RCE.
**Fix**: Bloquear namespace inteiro se JWT_SECRET não configurado. Fail-closed, não fail-open.

### S-C-02 — WebSocket namespace sem rate limiting
**Arquivo**: `server/socket/hub-ns.js`
**Impacto**: DoS via flood de mensagens Socket.IO. Sem throttle, um client pode saturar o event loop.
**Fix**: Implementar per-client message rate limiter no Socket.IO middleware.

### S-C-03 — 14 POST/PUT/DELETE routes sem input validation
**Evidência**: Ver 02-GAPS G1-01 a G1-17
**Impacto**: Injection, buffer overflow (payload gigante), type confusion. Sem Zod schemas, o backend processa qualquer input.
**Fix**: Aplicar `validate()` middleware (Onda 6.0) em todas as rotas.

### S-C-04 — Sandbox shell com regex-based blocklist
**Arquivo**: `tools/shell/sandbox.js`
**Impacto**: Regex patterns para bloquear `rm -rf`, `sudo`, `eval` etc. são fundamentalmente bypassáveis:
- Encoding: `$(echo cm0gLXJm | base64 -d)` bypassa blocklist string
- Alias: `alias delete=rm; delete -rf /`
- Builtins: `command rm -rf /`
- Quoting: `r"m" -rf /`
**Fix**: Allowlist de comandos em vez de blocklist. Ou usar namespace isolation (nsjail, bubblewrap).

---

## VULNERABILIDADES ALTAS (S-A)

### S-A-01 — `error-alerting.js:116` — Webhook URL sem SSRF protection
```js
fetch(webhookUrl, { method: 'POST', ... })
```
**Arquivo**: `observability/error-alerting.js:116`
**Impacto**: Se um admin registrar webhook para `http://169.254.169.254/latest/meta-data/`, sistema faz request a metadata service. Mesmo trusted users podem criar SSRF acidental.
**Fix**: Usar `validateUrl()` de `web-tools.js` (já existe, não é reusado).

### S-A-02 — `webhook-manager.js:196` — Webhook dispatch sem SSRF protection
```js
const resp = await fetch(url, { method: 'POST', ... })
```
**Arquivo**: `agent/infra/webhook-manager.js:196`
**Impacto**: Mesmo que S-A-01 — webhooks registrados via API podem target internal services.
**Fix**: Replicar `validateUrl()` check antes do fetch.

### S-A-03 — Nenhum error handler global — stack trace leaks
**Impacto**: Erros não capturados retornam stack traces completos para o client HTTP/WebSocket — information disclosure de paths internos, versões de lib, etc.
**Fix**: Error middleware que retorna mensagens genéricas em produção.

### S-A-04 — `mcp-tool-bridge.js:139` — MCP fetch sem timeout
```js
const response = await fetch(MCP_BASE, { method: 'POST', ... })
```
**Arquivo**: `bridges/mcp-tool-bridge.js:139`
**Impacto**: Se MCP server não responder, fetch fica pending indefinidamente, bloqueando a promise chain.
**Fix**: Adicionar `signal: AbortSignal.timeout(30_000)`.

### S-A-05 — `tools/git/index.js:33` — git exec com args user-controlled
```js
const { stdout } = await execAsync('git', args, { cwd: ROOT, ... })
```
**Impacto**: Se `args` contiver `--upload-pack="$(malicious)"` ou similar, command injection via git.
**Fix**: Sanitizar args — apenas flags allowlisted.

### S-A-06 — `tools/code-tools.js:14` — `execFileSync` em tool handler
**Impacto**: Bloqueia event loop. Se malicious input causar hang, o processo inteiro trava.

### S-A-07 — `tools/session-tools.js:16` — `execFileSync` em tool handler
**Impacto**: Mesmo que S-A-06.

### S-A-08 — `JWT_SECRET` na env blocklist de sandbox mas sem rotação
**Arquivo**: `tools/shell/sandbox.js:209`
**Impacto**: JWT_SECRET estático. Se leaked, não há mecanismo de rotação sem restart.

### S-A-09 — Sem CSP, X-Frame-Options, HSTS headers
**Evidência**: `grep helmet → 0 resultados`
**Impacto**: Se o server servir qualquer HTML (SSE viewer, debug page), vulnerável a clickjacking, XSS.
**Fix**: `npm install helmet` + `app.use(helmet())`.

### S-A-10 — CORS wildcard `*` em produção
**Arquivo**: `server/app.js:50`
```js
app.use(createCorsMiddleware({ origin: opts?.corsOrigin ?? '*' }));
```
**Impacto**: Qualquer origin pode fazer requests à API. Mitigado por bind em 127.0.0.1, mas se exposto via proxy, é full CORS bypass.
**Fix**: Default para `['http://localhost:*']` em vez de `*`.

### S-A-11 — `prompt-transformer.js:130` — Regex redaction pode miss edge cases
```js
/Bearer\s+\S+|...eyJ[a-zA-Z0-9_-]+\.eyJ.../gi
```
**Impacto**: Tokens com formatos não cobertos (custom headers, non-standard formats) passam sem redaction.

---

## VULNERABILIDADES MÉDIAS (S-M)

### S-M-01 — Path traversal em `file/shared.js:106`
```js
const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ROOT, filePath);
```
**Impacto**: Se `filePath = '/etc/passwd'` (absolute), bypassa workspace root. Check `startsWith(WORKSPACE_ROOT)` existe mas depende de realpath correctness.
**Fix**: Sempre resolve + realpath + assert startsWith.

### S-M-02 — `tools/shell/index.js:307` — Command path sem realpath check
**Impacto**: Symlink dentro do workspace pode apontar para fora.

### S-M-03 — `tools/shell/sandbox.js:149` — CWD resolution sem jail
**Impacto**: `cwd: '../../../'` pode escapar do workspace.

### S-M-04 — Sem request body size limit explícito
**Impacto**: Default Express 100KB, mas deve ser explícito e menor para algumas rotas.

### S-M-05 — `JSON.parse` sem try em 7+ locais (ver 01-BUGS A-10..A-13)
**Impacto**: Uncontrolled exception se input não for JSON válido.

### S-M-06 — `readFileSync` em tool handlers (A-01, A-02)
**Impacto**: ReDoS-like — arquivo grande bloqueia event loop.

### S-M-07 — Sem logging de tentativas de auth falhas
**Impacto**: Brute-force detection impossível.

### S-M-08 — Sem account lockout após N tentativas falhas
**Impacto**: Token brute-force possível.

### S-M-09 — Socket.IO handshake sem origin validation
**Impacto**: CSRF via WebSocket.

### S-M-10 — `web-tools.js:356` — URL construction com user input
```js
const u = new URL(rawUrl.startsWith('/') ? `https://html.duckduckgo.com${rawUrl}` : rawUrl);
```
**Impacto**: Se `rawUrl` for `//evil.com/path`, o `startsWith('/')` é true mas resulta em URL para `evil.com`.

### S-M-11 — `process.exit()` em 8 locais sem cleanup
**Impacto**: Recursos (sockets, files, locks) não são liberados.

### S-M-12 — Audit logs sem integridade (não assinados, não append-only)
**Impacto**: Audit trail pode ser adulterado.

### S-M-13 — Sem timeout em `execAsync` git (default não definido)
**Impacto**: Git operations com repositórios grandes podem rodar indefinidamente.

### S-M-14 — `web-tools.js` rate limiter in-process (não persistido)
**Impacto**: Restart reseta contadores — burst possível logo após restart.

### S-M-15 — Config values (model, skills, permissions) mutáveis via API sem auth diferenciado
**Impacto**: Qualquer client autenticado pode mudar o modelo para um mais caro sem autorização especial.

---

## VULNERABILIDADES BAIXAS (S-B)

### S-B-01 — Error messages expõem paths internos em logs
### S-B-02 — `console.warn` residuais podem expor informação em stdout
### S-B-03 — `.env` files não verificados no .gitignore
### S-B-04 — Sem dependency vulnerability scanning automatizado (npm audit)
### S-B-05 — package-lock.json com potenciais vulnerabilidades transitivas
### S-B-06 — Sem Content-Security-Policy em respostas
### S-B-07 — Sem X-Request-Id para correlação forense
### S-B-08 — Debug endpoints (se existirem) sem auth separado

---

*38 vulnerabilidades de segurança categorizadas. Próximo: 04-DIVIDA-TECNICA.md*
