# Sprint: Terminal Permanente LLM-B

**Data**: 2026-01-27
**Status**: Em Execução
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

- [ ] Criar `src/copilot/terminal-server.js` com readline + HTTP inject
- [ ] Atualizar `src/copilot/cli-terminal.js` para usar `dialogTurn()`
- [ ] Adicionar `POST /api/hub/inject` ao `copilot-hub-router.js`
- [ ] Adicionar entrada `llm-b-terminal` ao `ecosystem.config.cjs`
- [ ] `npm run lint` → 0 erros
- [ ] `npm run test:unit` → todos passando
- [ ] Teste manual: abrir terminal via PM2 + injetar via curl

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

- **Dialog Loop**: o `AlwaysAliveAgent` já suporta `startDialogLoop()` e `sendDialogTurn()`. O terminal deve reutilizar isso.
- **Singleton**: `alwaysAliveAgent` e `llmBridgeClient` são singletons — se o server principal já iniciou o agent, o terminal-server deve detectar e reutilizar o loop existente.
- **Porta 3009**: config via env `LLM_B_TERMINAL_PORT` com fallback para 3009.
- **Ctrl+C handling**: deve pausar readline mas não encerrar o dialog loop — LLM-B fica esperando.
