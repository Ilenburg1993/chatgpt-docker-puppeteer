# 06 — TSServer, SDK e Internalização: Investigação

**Data**: 2026-03-21 | **Revisado**: 2026-03-21 **Status**: Versão Definitiva (pós revisão crítica)
**Referências**: 04-ARQUITETURA-ATUAL.md, 05-ARQUITETURA-IDEAL.md

---

## 1. Contexto

O repositório possui dois subsistemas de "inteligência de código":

1. **`src/integration/lsp/tsserver-daemon.mjs`** — Daemon local que gerencia um processo tsserver
   para análise de código (completions, diagnostics, navigation, type-checking).
2. **`src/copilot/`** — Wrapper sobre `@github/copilot-sdk` que faz orquestração de sessões de IA
   com CopilotClient ↔ CopilotSession via JSON-RPC.

**Atualmente não existe nenhuma integração entre eles.** O tsserver daemon opera independente das
sessões Copilot SDK.

Este documento investiga como os dois podem ser integrados e os trade-offs envolvidos.

---

## 2. A Opção `isChildProcess` do SDK

O `CopilotClientOptions` inclui:

```typescript
isChildProcess?: boolean;
```

> **Quando `true`**: indica que o SDK está executando como sub-processo de outro processo Node.js e
> deve usar stdio para comunicar com o processo pai existente. Só pode ser usado com
> `useStdio: true`.

### 2.1 Cenário: SDK como child process do tsserver-daemon

```
[tsserver-daemon.mjs]
       │ (spawna)
       ▼
[copilot-sdk process]
       │ (stdio transport)
       ▼
[Copilot CLI server (parent)]
```

**Uso**: Quando o tsserver-daemon é executado em um contexto onde o Copilot CLI já está rodando como
processo pai, o SDK pode ser instanciado com `isChildProcess: true` para reusar a conexão existente
em vez de spawner outro processo CLI.

### 2.2 Viabilidade

| Aspecto      | Avaliação                                                                       |
| ------------ | ------------------------------------------------------------------------------- |
| Complexidade | ALTA — exige redesign do daemon para operar como child                          |
| Benefício    | MODERADO — evita duplicação de processo CLI                                     |
| Risco        | ALTO — acoplamento entre tsserver e copilot pode causar cascading failures      |
| Urgência     | BAIXA — cenário edge, aplicável apenas quando ambos coexistem no mesmo processo |

**Recomendação**: **NÃO adotar `isChildProcess` agora.** O cenário requerido (tsserver-daemon como
child de um CLI Copilot) não corresponde à nossa arquitetura atual. Manter como GAP documentado para
revisão futura quando o SDK estabilizar.

---

## 3. A Opção `cliUrl` do SDK

```typescript
cliUrl?: string;
```

> **Quando fornecido**: o client conecta a um servidor CLI existente via TCP, em vez de spawner um
> processo novo. Formato: `"host:port"` ou `"http://host:port"`.

### 3.1 Cenário: Copilot CLI compartilhado

Se houver um Copilot CLI rodando como serviço (via PM2, systemd, Docker), múltiplos consumers
(tsserver-daemon, copilot session manager, audit agent) podem conectar via `cliUrl`.

```
[PM2 / systemd]
       │ (gerencia)
       ▼
[Copilot CLI server :9000]
       │
       ├──► [copilot-sdk client A] (sessões de agente)
       ├──► [copilot-sdk client B] (tsserver integration)
       └──► [copilot-sdk client C] (audit agent)
```

**Viabilidade**: MODERADA. Nosso código já tem `createClientFromCliUrl()` em `lifecycle.js`. O
mecanismo existe. A questão é se quereríamos que o tsserver-daemon usasse a mesma instância CLI.

---

## 4. Modelos de Integração TSServer ↔ SDK

### Modelo A: Independente (Status Quo)

```
[tsserver-daemon]  ←→  [tsserver process]     (análise estática)
[copilot-sdk]      ←→  [Copilot CLI process]  (IA generativa)
```

- **Prós**: Isolamento total. Falha em um não afeta o outro.
- **Contras**: Sem sinergia. Informações de tipo duplicadas.

### Modelo B: SDK-Aware tsserver (Recomendado para Fase 2)

```
[tsserver-daemon] ──► type info ──► [copilot-sdk system message]
[copilot-sdk]     ──► tool calls ──► [tsserver-daemon] (via tools)
```

**Integração via SystemMessage**: O tsserver-daemon fornece informações contextuais (tipos do
arquivo aberto, diagnósticos, completions candidates) que são injetadas no `systemMessage` da sessão
Copilot via modo `customize` com `sections`.

**Integração via Tools**: O agente Copilot tem tools que chamam o tsserver-daemon para obter
informações de tipo em tempo real.

```js
// Exemplo: tool que consulta tsserver
createTool({
  name: 'get_type_info',
  description: 'Get TypeScript type information for a symbol',
  parameters: z.object({
    file: z.string(),
    line: z.number(),
    character: z.number(),
  }),
  execute: async ({ file, line, character }) => {
    const daemon = getTsserverDaemon();
    const info = await daemon.quickInfo(file, line, character);
    return { content: JSON.stringify(info) };
  },
});
```

- **Prós**: Sinergia sem acoplamento forte. Cada sistema mantém cycle de vida independente.
- **Contras**: Latência adicional nas tool calls. SystemMessage pode ficar grande.

### Modelo C: Unified Intelligence Layer (Futuro Distante)

```
[Unified Intelligence]
    ├── [tsserver] (type analysis)
    ├── [copilot-sdk] (generative AI)
    ├── [eslint daemon] (lint)
    └── [mcp servers] (external tools)
```

- **Prós**: Ponto único de consulta para toda inteligência de código.
- **Contras**: Altíssima complexidade. Não justificado agora.

---

## 5. `CopilotClientOptions` Não Cobertos

Além de `isChildProcess`, há outras opções relevantes para internalização:

| Opção               | Status                                 | Proposta                                                 |
| ------------------- | -------------------------------------- | -------------------------------------------------------- |
| `cliPath`           | ❌ Não usado                           | Permitir override do CLI path para desenvolvimento local |
| `cliArgs`           | ❌ Não usado                           | Possibilitar args extras (debug flags, log verbosity)    |
| `cwd`               | ❌ Não usado                           | Default é `process.cwd()`, OK para nosso caso            |
| `port`              | ❌ Não usado                           | Relevante se adotarmos TCP mode para multi-client        |
| `useStdio`          | ✅ Default true                        | Correto para uso atual                                   |
| `isChildProcess`    | ❌ Não usado                           | Ver seção 2 — não adotar agora                           |
| `cliUrl`            | ✅ Usado em `createClientFromCliUrl()` | Functional                                               |
| `logLevel`          | ❌ Não usado                           | Adicionar — mapear para nosso LOG_LEVEL                  |
| `autoStart`         | ✅ Default true                        | Correto                                                  |
| `env`               | ❌ Não usado                           | Adicionar para controle de env passado ao CLI            |
| `githubToken`       | ❌ Não usado                           | Considerar para BYOK/org token scenarios                 |
| `useLoggedInUser`   | ❌ Não usado                           | Default true — OK                                        |
| `onListModels`      | ❌ Não usado                           | Adicionar para BYOK providers                            |
| `telemetry`         | ❌ Não usado                           | Integrar com nosso OTel setup                            |
| `onGetTraceContext` | ❌ Não usado                           | Integrar com OTel para distributed tracing               |

### Prioridades de Internalização

| Prioridade | Opções                                               |
| ---------- | ---------------------------------------------------- |
| P0         | `logLevel`, `env` — básico, sem risco                |
| P1         | `telemetry`, `onGetTraceContext` — observabilidade   |
| P2         | `onListModels`, `githubToken` — BYOK                 |
| P3         | `cliPath`, `cliArgs`, `port` — customização avançada |
| P4         | `isChildProcess` — investigação futura               |

---

## 6. Roadmap de Integração

### Fase 1 — Quick Wins (P0, ~4h)

1. Passar `logLevel` no `CopilotClientOptions` mapeando `process.env.LOG_LEVEL`
2. Passar `env` com variáveis relevantes filtradas
3. Remover `injectHookContext: true` (phantom field, BUG-01)

### Fase 2 — Observabilidade SDK (P1, ~12h)

1. Configurar `telemetry` com endpoint OTel existente
2. Implementar `onGetTraceContext` usando `@opentelemetry/api`
3. Correlacionar traces SDK ↔ traces do sistema

### Fase 3 — SDK-Aware TSServer (P1, ~20h)

1. Criar tool `get_type_info` que consulta tsserver-daemon
2. Criar tool `get_diagnostics` que consulta tsserver-daemon
3. Injetar info de tipo no SystemMessage via `customize` mode (com `sections[]` correto)

### Fase 4 — BYOK Provider (P2, ~16h)

1. Implementar `onListModels` para listar modelos de providers customizados
2. Configurar `githubToken` para org tokens
3. Integrar com provider factory existente em `sdk/session/provider.js`

### Fase 5 — Advanced CLI Options (P3, ~8h)

1. Suportar `cliPath` para dev local
2. Suportar `cliArgs` para debug
3. Suportar `port` para cenário multi-client TCP

---

## 7. Conclusão

A integração TSServer ↔ SDK deve seguir o **Modelo B (SDK-Aware)** com:

- Tools que consultam o tsserver-daemon (bidirecional, desacoplado)
- Context injection via SystemMessage sections
- Ciclos de vida independentes

O modo `isChildProcess` **não é adequado** para a arquitetura atual e deve ficar como investigação
futura. As opções `cliPath`, `cliArgs`, `port` são P3 e serão adicionadas conforme demanda.

A prioridade imediata é cobrir as opções básicas (`logLevel`, `env`) e de observabilidade
(`telemetry`, `onGetTraceContext`) que entregam valor sem risco estrutural.
