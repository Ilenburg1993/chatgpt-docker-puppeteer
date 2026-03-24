# Sprint: Terminal Permanente LLM-B

**Data início**: 2026-01-27
**Data conclusão**: 2026-03-24
**Status**: ✅ Fase 1 Concluída — Fase 2 (Integração Hub + PM2) Em Execução
**Commits**: `f0c0dd15` (terminal-server) · `5a2f05f9` (hub-server) · `7625474f` (hub)
**Autor**: LLM-A (GitHub Copilot)

---

## Objetivo

Criar um **terminal permanente dedicado à LLM-B** em que:

- O **usuário humano** pode conversar diretamente a qualquer momento
- **LLM-A** (Copilot Chat) pode injetar mensagens programaticamente
- A sessão fica **sempre aberta** — dialog loop nunca é encerrado entre mensagens
- O histórico **persiste** via ConversationHub
- Funciona como **serviço PM2** → sobrevive a reconexões

**Analogia**: Como o GitHub Copilot CLI, mas 100% nosso e controlado por nós.

---

## Avaliação da Arquitetura Existente

### O que já existe

| Componente              | Localização                        | O que faz                | Estado                                                                            |
| ----------------------- | ---------------------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `cli-terminal.js`       | `src/copilot/cli-terminal.js`      | REPL readline básico     | **Existente** — usa `LlmBridgeClient.chat()` (1 PR por chamada, sem dialog loop)  |
| `LlmBridgeClient`       | `src/copilot/llm-bridge-client.js` | Cliente conversacional   | **Completo** — tem `.chat()`, `.startDialogMode()`, `.dialogTurn()`, singleton    |
| `AlwaysAliveAgent`      | `src/copilot/always-alive.js`      | Agente LLM-B             | **Completo** — `startDialogLoop()`, `sendDialogTurn()`, `dialogLoopActive` getter |
| `ConversationHub`       | `src/copilot/conversation-hub/`    | Gerenciamento de sessões | **Completo** — persiste turnos, `POST /api/hub/sessions/:id/send`                 |
| `copilot-hub-router.js` | `src/server/api/`                  | Endpoints REST           | **Completo** — tem `send` e `stream`                                              |

### Gaps identificados

1. **`cli-terminal.js` usa `.chat()`** em vez de dialog loop → cria 1 PR interna por turno (ineficiente, sem sessão contínua)
2. **Nenhum endpoint para LLM-A injetar** mensagem diretamente no terminal ativo → LLM-A só pode usar APIs de hub
3. **Sem serviço PM2** para o terminal — precisa ser iniciado manualmente
4. **Sem modo multi-ator** — não há broadcast para mostrar a todos quem está falando (user vs LLM-A vs LLM-B)
5. **Sem persistência de dialog loop** — se o processo reinicia, o loop se perde

---

## Arquitetura da Solução

### Visão geral

```
┌─────────────────────────────────────────────────────────────────┐
│                    Terminal LLM-B (PM2 service)                  │
│                   src/copilot/terminal-server.js                  │
│                                                                   │
│  ┌─────────────────┐    ┌──────────────────────┐                 │
│  │  readline REPL  │    │   HTTP Inject Server  │                 │
│  │  (stdin/stdout) │    │   :3009 /inject       │                 │
│  └────────┬────────┘    └──────────┬───────────┘                 │
│           │                        │                              │
│           └──────────┬─────────────┘                             │
│                      ↓                                            │
│             LlmBridgeClient.dialogTurn()                          │
│                      ↓                                            │
│             AlwaysAliveAgent (dialog loop ativo)                  │
│                      ↓                                            │
│             ConversationHub.send()  →  DB persistence             │
└─────────────────────────────────────────────────────────────────┘
```

### Componentes a criar/modificar

#### 1. `src/copilot/terminal-server.js` (NOVO)

**Terminal permanente** com duas entradas:

- **Entrada 1: readline (stdin)** — usuário humano digita no terminal
- **Entrada 2: HTTP server interno** na porta 3009 — LLM-A injecta via `POST /inject`

**Comportamento:**
- Na inicialização: inicia o `AlwaysAliveAgent` (se não estiver rodando) e chama `startDialogMode()`
- Cada mensagem (de qualquer fonte) vai para `llmBridgeClient.dialogTurn(message)`
- A resposta é exibida no terminal COM PREFIXO de quem enviou: `[user]`, `[LLM-A]`, `[LLM-B]`
- Exibe status ao iniciar: qual dialog loop está ativo, session ID do Hub
- Comandos: `/status`, `/history`, `/who <n>` (últimos N turnos), `/quit`

#### 2. `src/server/api/copilot-hub-router.js` (MODIFICAR — endpoint inject)

Adicionar: `POST /api/hub/inject` — permite LLM-A enviar mensagem ao terminal ativo via REST (alternativa ao HTTP direto na porta 3009, para quando o servidor principal já está rodando).

#### 3. `ecosystem.config.cjs` (MODIFICAR — entry PM2)

```js
{
    name: 'llm-b-terminal',
    script: './src/copilot/terminal-server.js',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    env: {
        LLM_B_TERMINAL_PORT: 3009,
        COPILOT_AGENT_AUTOSTART: 'true',
    },
}
```

#### 4. `src/copilot/cli-terminal.js` (MODIFICAR — migrar para dialog mode)

Atualizar para usar `llmBridgeClient.startDialogMode()` + `llmBridgeClient.dialogTurn()` em vez de `client.chat()`.

---

## API de Injeção para LLM-A

### Via HTTP interno (porta 3009)

```bash
# LLM-A injeta mensagem no terminal permanente
curl -X POST http://localhost:3009/inject \
  -H "Content-Type: application/json" \
  -d '{"message": "Olá LLM-B, sou LLM-A. Como você está?", "from": "llm-a"}'
```

### Via Hub REST (porta 3008, quando servidor principal rodando)

```bash
# Via endpoint de inject do hub
POST /api/hub/inject
{"message": "...", "from": "llm-a", "sessionId": "opcional"}
```

---

## Fluxo de Execução

```
1. PM2 inicia terminal-server.js como 'llm-b-terminal'
2. Terminal verifica se AlwaysAliveAgent está idle
3. Se idle: chama startDialogMode() com boot prompt
4. Terminal exibe banner + aguarda input
5. [loop permanente]:
   a. Usuário digita → readline handler → dialogTurn() → exibe resposta
   b. LLM-A POST /inject → HTTP handler → dialogTurn() → exibe resposta
   c. Resposta sempre display no stdout (tail -f via PM2 logs)
6. Ctrl+C → pausa readline mas NÃO encerra dialog loop
7. /quit → encerra dialog loop + processo
```

---

## Checklist de Implementação

### Fase 1 — Terminal Base (CONCLUÍDA ✅)

- [x] Criar `src/copilot/terminal-server.js` com readline + HTTP inject server `:3009`
- [x] Atualizar `src/copilot/cli-terminal.js` para usar `dialogTurn()` via `llmBridgeClient` singleton
- [x] REPL com comandos `/status`, `/history [n]`, `/who`, `/clear`, `/answer`, `/restart`, `/quit`
- [x] Mutex `_busy` — evita turnos concorrentes
- [x] Auto-boot do `AlwaysAliveAgent` + `startDialogMode()` ao iniciar
- [x] `Ctrl+C` pausa readline mas mantém dialog loop ativo
- [x] `npm run lint` → 0 erros
- [x] `npm run test:unit` → 1474/1474 passando
- [x] Commit `f0c0dd15` realizado

### Fase 2 — Integração Hub + PM2 (EM EXECUÇÃO 🔄)

- [ ] Integrar `terminal-server.js` com `ConversationHub` — criar `hub_session` permanente na boot e persistir turnos
- [ ] Adicionar `POST /api/hub/inject` ao `copilot-hub-router.js` (proxy para `:3009/inject`)
- [ ] Adicionar entrada `llm-b-terminal` ao `ecosystem.config.cjs` (condicional `COPILOT_TERMINAL_ENABLED=true`)
- [ ] `npm run lint` → 0 erros
- [ ] `npm run test:unit` → todos passando
- [ ] Commit da Fase 2

### Fase 3 — Testes e Operação (FUTURA)

- [ ] Teste manual: iniciar via PM2 (`COPILOT_TERMINAL_ENABLED=true pm2 start ecosystem.config.cjs --only llm-b-terminal`)
- [ ] Teste inject via curl: `curl -X POST http://localhost:3009/inject -d '{"message":"olá"}'`
- [ ] Teste proxy: `curl -X POST http://localhost:3008/api/hub/inject -d '{"message":"olá"}'`
- [ ] Verificar histórico no hub: `GET /api/hub/sessions`

---

## Compatibilidade com Arquitetura Existente

| Invariante                                    | Respeitado?           |
| --------------------------------------------- | --------------------- |
| Não usar `puppeteer.launch()`                 | ✅ Não usamos          |
| ESM obrigatório (`import/export`)             | ✅                     |
| `"type": "module"` em package.json            | ✅                     |
| Estilo: 4 espaços, 120 colunas, aspas simples | ✅                     |
| JSDoc em APIs públicas                        | ✅ será adicionado     |
| Aliases `#core/*`, `#infra/*`                 | ✅ onde aplicável      |
| Porta 3008 para server principal              | ✅ — terminal usa 3009 |

---

## Notas Técnicas

- **Dialog Loop**: o `AlwaysAliveAgent` já suporta `startDialogLoop()` e `sendDialogTurn()`. O terminal reutiliza o singleton `llmBridgeClient.startDialogMode()` / `llmBridgeClient.dialogTurn()`.
- **Singleton**: `alwaysAliveAgent` e `llmBridgeClient` são singletons — nunca instanciar com `new`.
- **Porta 3009**: config via env `LLM_B_TERMINAL_PORT` com fallback para 3009.
- **Ctrl+C handling**: pausa readline mas não encerra o dialog loop — LLM-B permanece aguardando.
- **Hub Integration**: o terminal cria sua própria `hub_session` "Terminal Permanente" para que turnos sejam persitidos no SQLite via `ConversationStore`.
- **Proxy /inject**: `POST /api/hub/inject` no servidor Express (3008) é um proxy para `http://127.0.0.1:3009/inject` — LLM-A não precisa conhecer a porta interna.
- **PM2**: processo `llm-b-terminal` ativado por `COPILOT_TERMINAL_ENABLED=true`; sem `wait_ready` pois o processo é interativo.
- **bootPrompt**: env `LLM_B_BOOT_PROMPT` — mensagem de contexto enviada à LLM-B na primeira vez que o dialog loop sobe.

---

## Arquivos Implementados (Fase 1)

| Arquivo                                        | Status         | Descrição                       |
| ---------------------------------------------- | -------------- | ------------------------------- |
| `src/copilot/terminal-server.js`               | ✅ Criado       | REPL + inject server HTTP :3009 |
| `src/copilot/cli-terminal.js`                  | ✅ Atualizado   | Migrado para dialog mode        |
| `DOCUMENTAÇÃO/PLANOS/SPRINT-TERMINAL-LLM-B.md` | ✅ Este arquivo | Plano do sprint                 |

## Arquivos a Modificar (Fase 2)

| Arquivo                                    | Modificação                           |
| ------------------------------------------ | ------------------------------------- |
| `src/copilot/terminal-server.js`           | Integração com `conversationHub`      |
| `src/server/api/copilot-hub-router.js`     | `POST /api/hub/inject` proxy          |
| `ecosystem.config.cjs`                     | Processo `llm-b-terminal` condicional |
| `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md` | Seção `src/copilot/` ✅ já adicionada  |
