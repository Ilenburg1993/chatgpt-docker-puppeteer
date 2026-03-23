# Propostas de Integração — GitHub Copilot SDK × Hook System

**Status**: Análise e propostas (não implementado) **Data**: 2026-07-13 **Autor**: GitHub Copilot
(Claude Sonnet 4.6) **Referência SDK**:
https://github.com/github/copilot-sdk/blob/main/docs/getting-started.md **Referência Hook System**:
`.github/hooks/`

---

## 1. Contexto e Motivação

### 1.1 O que é o Copilot SDK

O **GitHub Copilot SDK** (`@github/copilot-sdk`) é uma biblioteca TypeScript/Node.js que expõe
controle programático completo do Copilot CLI via JSON-RPC. Ele permite:

- Criar sessões de LLM com modelos configuraveis (`gpt-4.1`, `gpt-5`, `claude-sonnet-4.5`, modelos
  locais via Ollama, Azure OpenAI, etc.)
- Registro de **Custom Tools** tipadas com Zod que o agente pode invocar
- **Session Hooks** (onPreToolUse, onPostToolUse, onSessionStart, onSessionEnd, etc.) em JavaScript
  — análogos aos hooks shell do `.github/hooks/`, mas com capacidade de modificar argumentos e
  resultados
- **Custom Agents** com prompts de sistema customizáveis por seção granular
- Streaming de respostas com eventos tipados
- **MCP Servers** (Model Context Protocol) locais ou remotos
- Telemetria via OpenTelemetry
- Persistência de sessão com compactação automática de contexto (infinite sessions)

### 1.2 O nosso Hook System atual

O hook system existente (`hooks.json` + `.github/hooks/`) intercepta **9 eventos** do Copilot CLI:

| Hook               | Responsabilidade atual                                             |
| ------------------ | ------------------------------------------------------------------ |
| `SessionStart`     | Inicializa/reconecta state, emite `additionalContext` com briefing |
| `UserPromptSubmit` | Abre novo TURN, detecta close_key, emite contexto de compliance    |
| `PreToolUse`       | Abre SUBTURN, conta ferramentas, bloqueia chamadas proibidas       |
| `PostToolUse`      | Fecha SUBTURN, registra resultados no audit.jsonl                  |
| `PreCompact`       | Salva checkpoint antes de compactação de contexto                  |
| `SubagentStart`    | Registra início de subagente no state                              |
| `SubagentStop`     | Fecha rastro de subagente                                          |
| `Stop`             | Protocolo autorizado de encerramento da sessão                     |
| `SessionEnd`       | Limpeza final e relatório                                          |

O hook system produz um `session.json` rico com estatísticas, compliance, audit trail, e emite
`additionalContext` para o agente via stdout. A arquitetura é **shell puro** (bash), o que é robusto
mas tem limitações.

### 1.3 Gap identificado

O hook system shell **não tem acesso** ao SDK — ele reage a eventos, mas não pode **iniciá-los** nem
**parametrizar a sessão** de forma programática. O SDK, por outro lado, permite controle
programático completo antes e durante a sessão, mas nosso projeto **não usa o SDK diretamente**.

---

## 2. Análise de Sobreposição e Complementaridade

### 2.1 Funcionalidades sobrepostas (hook shell vs. SDK hooks)

| Capacidade               | Hook System (shell)               | SDK (JavaScript)                      | Observação                                             |
| ------------------------ | --------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| Interceptar PreToolUse   | ✅ `pre-tool-use.sh`              | ✅ `onPreToolUse`                     | SDK permite modificar args; shell apenas bloqueia/loga |
| Interceptar PostToolUse  | ✅ `post-tool-use.sh`             | ✅ `onPostToolUse`                    | SDK pode modificar resultado; shell apenas loga        |
| Contexto no SessionStart | ✅ `additionalContext` via stdout | ✅ `onSessionStart` + `systemMessage` | SDK mais poderoso (altera prompt base)                 |
| Interceptar prompts      | ✅ `user-prompt-submit.sh`        | ✅ `onUserPromptSubmitted`            | SDK pode modificar o prompt em si                      |
| Encerramento de sessão   | ✅ `session-end.sh`               | ✅ `onSessionEnd`                     | Equivalentes                                           |
| Audit trail              | ✅ `audit.jsonl`                  | ✅ OpenTelemetry                      | Ambos; OTel é mais padronizado                         |

### 2.2 Capacidades exclusivas do SDK (que o shell não tem)

| Capacidade SDK                                     | Oportunidade                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Custom Tools** com handler JS                    | Expor funções do hook system como ferramentas nativas que o agente invoca diretamente |
| **Modificar argumentos** de tools (PreToolUse)     | Sanitizar/enriquecer inputs antes de execução                                         |
| **Modificar resultados** de tools (PostToolUse)    | Filtrar dados sensíveis, enriquecer contexto                                          |
| **Modificar prompt** do usuário (UserPromptSubmit) | Injetar contexto do session.json no prompt silenciosamente                            |
| **systemMessage.mode = "customize"**               | Controle granular das seções do system prompt                                         |
| **Custom Agents** com persona dedicada             | Criar perfis de agente especializados (ex: "hook-auditor", "mission-planner")         |
| **BYOK + modelos locais**                          | Alternar modelos (Ollama local, GPT-5, Claude) por tipo de tarefa                     |
| **Infinite Sessions** com threshold configurável   | Controle de quando triggerar PreCompact                                               |
| **Permission Handler** programático                | Lógica de permissão complexa sem modificar shell                                      |
| **listSessions / resumeSession**                   | Navegar entre sessões programaticamente                                               |
| **MCP Servers locais**                             | Expor scripts shell como MCP tools (stdin/stdout)                                     |
| **Telemetria OpenTelemetry**                       | Traces distribuídos para debugging de sessions longas                                 |
| **Streaming events** tipados                       | UI em tempo real de progresso do agente                                               |

### 2.3 Capacidades exclusivas do hook shell (que o SDK não tem)

| Capacidade Shell                                        | Observação                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| **Estado persistente entre sessões** (`session.json`)   | O SDK pode ler/escrever arquivos, mas não tem state machine nativa |
| **Audit trail JSONL** formatado por evento              | Customizável ao nosso domínio                                      |
| **Compliance enforcement** (consecutive_unauthorized)   | Lógica de negócio específica do nosso protocolo                    |
| **Close-key rotation**                                  | Protocolo proprietário de autorização de encerramento              |
| **Briefing markdown** gerado dinamicamente              | Context window enrichment específico                               |
| **Session checkpoints** antes de compactação            | Preserve state durante PreCompact                                  |
| **Scripts utilitários** (add-task, complete-task, etc.) | Interface CLI para gerenciamento de tarefas                        |

---

## 3. Propostas de Integração

### Proposta P-01 — SDK Wrapper Programático (Nível 1: Baixo Esforço)

**Objetivo**: Criar um módulo Node.js ESM que encapsula o SDK e expõe uma API programática para
controle de sessões Copilot, aproveitando o ecossistema Node.js 24 já presente no projeto.

**Descrição**:

```
src/agent/copilot-sdk-wrapper.js
```

Um wrapper simples que:

1. Instancia `CopilotClient` com configuração centralizada
2. Lê `config.json` para modelo, tokens, provider
3. Expõe `createManagedSession()` que injeta o `systemMessage` com o briefing do hook system
4. Conecta eventos do SDK ao sistema de logging do projeto (`src/nerv/`)

**Sinergia com hooks**: O `session-briefing.md` gerado pelo `SessionStart` hook pode ser lido e
injetado como `systemMessage.content` na criação da sessão SDK.

**Exemplo conceitual**:

```javascript
// src/agent/copilot-sdk-wrapper.js
import { CopilotClient, approveAll, defineTool } from '@github/copilot-sdk';
import { readFileSync, existsSync } from 'node:fs';

const BRIEFING_PATH = '.github/hooks/state/session-briefing.md';

export async function createManagedSession(config = {}) {
  const briefing = existsSync(BRIEFING_PATH) ? readFileSync(BRIEFING_PATH, 'utf8') : '';

  const client = new CopilotClient({ autoStart: true });

  return client.createSession({
    model: config.model ?? 'gpt-4.1',
    onPermissionRequest: approveAll,
    systemMessage: {
      content: briefing ? `\n\n${briefing}` : '',
    },
    ...config,
  });
}
```

**Estimativa de esforço**: 2-4h **Dependências**: `npm install @github/copilot-sdk` **Risco**: Baixo
— não altera hooks existentes

---

### Proposta P-02 — Hook Tools Expostas como Custom Tools SDK (Nível 2: Médio Esforço)

**Objetivo**: Expor as ferramentas de gerenciamento do hook system (add-task, complete-task,
save-finding, etc.) como **Custom Tools** nativas do SDK, eliminando a necessidade de o agente
chamar `bash scripts/...` via terminal.

**Motivação**: Atualmente o agente invoca scripts como
`bash .github/hooks/scripts/add-task.sh "..."`. Com Custom Tools SDK, o agente invoca
`add_task({ title: "...", status: "..." })` diretamente — sem passar por terminal, com validação de
schema Zod, e com rastreabilidade.

**Tools propostas**:

| Custom Tool              | Script atual equivalente  | Schema entrada                          |
| ------------------------ | ------------------------- | --------------------------------------- |
| `hook_add_task`          | `add-task.sh`             | `{ title: string, status: enum }`       |
| `hook_complete_task`     | `complete-task.sh`        | `{ taskId: string }`                    |
| `hook_save_finding`      | `save-finding.sh`         | `{ severity: string, message: string }` |
| `hook_get_session_state` | leitura de `session.json` | `{ fields?: string[] }`                 |
| `hook_get_audit_tail`    | tail de `audit.jsonl`     | `{ lines?: number }`                    |
| `hook_session_summary`   | `session-summary.sh`      | `{}`                                    |

**Exemplo conceitual**:

```javascript
import { defineTool } from '@github/copilot-sdk';
import { z } from 'zod';
import { execFileSync } from 'node:child_process';

export const hookAddTask = defineTool('hook_add_task', {
  description: 'Adiciona uma tarefa ao pending-tasks.md do hook system',
  parameters: z.object({
    title: z.string().describe('Título da tarefa'),
    status: z.enum(['not-started', 'in-progress', 'completed']),
  }),
  skipPermission: true,
  handler: async ({ title, status }) => {
    const result = execFileSync('.github/hooks/scripts/add-task.sh', [title, status], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    return { success: true, output: result.trim() };
  },
});
```

**Benefício adicional**: O `onPermissionRequest` handler pode filtrar por
`request.kind === "custom-tool"` e logar chamadas às hook tools no `audit.jsonl` automaticamente.

**Estimativa de esforço**: 1-2 dias **Dependências**: P-01 + `zod` **Risco**: Médio — precisa de
testes de integração entre SDK e scripts shell

---

### Proposta P-03 — SDK Session Hooks como Camada de Enriquecimento (Nível 2)

**Objetivo**: Usar os **Session Hooks** do SDK (`onPreToolUse`, `onPostToolUse`,
`onUserPromptSubmitted`) em camada _adicional_ sobre os hooks shell, para adicionar capacidades que
o shell não suporta: modificação de argumentos e resultados.

**Caso de uso principal — Filtro de dados sensíveis em PostToolUse**:

```javascript
hooks: {
    onPostToolUse: async (input, invocation) => {
        // Sanitiza resultados de read_file que contenham tokens/senhas
        if (input.toolName === 'read_file') {
            const sanitized = sanitizeSensitiveContent(input.toolResult);
            return { additionalContext: sanitized !== input.toolResult
                ? '⚠️ Conteúdo sensível detectado e sanitizado.'
                : undefined
            };
        }
        return {};
    },
}
```

**Caso de uso — Enriquecimento de prompt com estado do session.json**:

```javascript
hooks: {
    onUserPromptSubmitted: async (input) => {
        const state = JSON.parse(readFileSync('.github/hooks/state/session.json', 'utf8'));
        const turnNum = state?.current_turn?.number ?? 0;
        const consecutive = state?.compliance?.consecutive_unauthorized ?? 0;

        // Injeta metadados de compliance no prompt silenciosamente
        return {
            modifiedPrompt: `[Turno #${turnNum} | Consecutivos sem askQ: ${consecutive}]\n\n${input.prompt}`
        };
    },
}
```

**Caso de uso — Bloqueio avançado em PreToolUse**:

O SDK `onPreToolUse` permite retornar `permissionDecision: "deny"` com mensagem customizada, mais
expressivo que o bloco via exit code do shell:

```javascript
hooks: {
    onPreToolUse: async (input) => {
        // Bloqueia task_complete sem vscode_askQuestions neste turno
        if (input.toolName === 'task_complete') {
            const state = JSON.parse(readFileSync('.../session.json'));
            if (!state?.current_turn?.ask_questions_called) {
                return {
                    permissionDecision: 'deny',
                    additionalContext: '⛔ task_complete bloqueado: vscode_askQuestions não foi chamado neste turno.',
                };
            }
        }
        return { permissionDecision: 'allow' };
    },
}
```

**Estimativa de esforço**: 2-3 dias **Dependências**: P-01 **Risco**: Médio — duplicação de lógica
com hooks shell (precisa de política de precedência clara)

---

### Proposta P-04 — Custom Agent "Hook Auditor" (Nível 3: Alto Esforço)

**Objetivo**: Criar um **Custom Agent** SDK dedicado ao papel de "auditor de sessão", com persona,
system prompt e ferramentas específicas para análise de conformidade do protocolo de hooks.

**Conceito**:

```javascript
const session = await client.createSession({
  customAgents: [
    {
      name: 'hook-auditor',
      displayName: 'Hook Auditor',
      description: 'Analisa conformidade do protocolo de hooks e sugere correções',
      prompt: `Você é um auditor especializado no protocolo de hooks deste projeto.
                 Você conhece os eventos SessionStart, PreToolUse, PostToolUse, UserPromptSubmit,
                 PreCompact, SubagentStart/Stop, Stop e SessionEnd.
                 Analise sempre o session.json, audit.jsonl e session-briefing.md antes de qualquer resposta.
                 Nunca encerre um turno sem chamar vscode_askQuestions.`,
    },
  ],
  agent: 'hook-auditor',
  tools: [hookGetSessionState, hookGetAuditTail, hookAddTask],
  systemMessage: {
    mode: 'customize',
    sections: {
      tone: {
        action: 'replace',
        content: 'Seja preciso, conciso e técnico. Use markdown e tabelas.',
      },
      guidelines: {
        action: 'append',
        content: '\n* Sempre citar linha do audit.jsonl ao identificar violações.',
      },
    },
  },
});
```

**Casos de uso**:

- Análise on-demand de conformidade sem mudar de contexto
- "Qual é o estado atual da sessão?" → agente lê session.json e responde estruturadamente
- "Houve violações de compliance hoje?" → analisa audit.jsonl e produz relatório

**Estimativa de esforço**: 3-5 dias (inclui design de prompt e testes) **Dependências**: P-01, P-02,
P-03 **Risco**: Alto — dependência de prompt engineering e comportamento do modelo

---

### Proposta P-05 — MCP Server para o Hook System (Nível 3)

**Objetivo**: Expor o hook system como um **MCP Server local** (stdio), tornando as ferramentas do
projeto acessíveis a qualquer cliente MCP — não apenas ao SDK Copilot.

**Arquitetura proposta**:

```
src/mcp/
├── hook-mcp-server.js     # Servidor MCP stdio principal
├── tools/
│   ├── session-state.js   # get_session_state, set_session_field
│   ├── audit-log.js       # get_audit_tail, search_audit
│   ├── task-manager.js    # add_task, complete_task, list_tasks
│   └── hook-runner.js     # run_hook_script (sandboxed)
└── README.md
```

**Configuração no SDK**:

```javascript
const session = await client.createSession({
  mcpServers: {
    'hook-system': {
      type: 'local',
      command: 'node',
      args: ['src/mcp/hook-mcp-server.js'],
      cwd: process.cwd(),
      tools: ['*'],
      env: {
        STATE_DIR: '.github/hooks/state',
        HOOK_DIR: '.github/hooks',
      },
    },
  },
});
```

**Vantagens sobre P-02**:

- Reutilizável em outros clientes MCP (VS Code MCP extension, Cursor, etc.)
- Protocolo padronizado e extensível
- Isolamento de processo (crash do MCP server não derruba o SDK)
- Pode ser exposto via HTTP para uso remoto

**Estimativa de esforço**: 1 semana **Dependências**: P-01 + SDK MCP docs **Risco**: Médio — MCP é
feature em evolução no SDK ("Note: This is an evolving feature")

---

### Proposta P-06 — Telemetria e Observabilidade com OpenTelemetry (Nível 2)

**Objetivo**: Substituir/complementar o `audit.jsonl` com **OpenTelemetry distributed tracing**,
permitindo correlacionar spans do SDK com spans dos hooks shell.

**Arquitetura**:

```javascript
const client = new CopilotClient({
  telemetry: {
    filePath: '.github/hooks/logs/otel-traces.jsonl',
    exporterType: 'file',
    captureContent: false, // sem capturar conteúdo por privacidade
  },
});
```

Cada tool call do SDK gera um span. Com `captureContent: false`, apenas metadados de timing e tool
name são gravados — sem risco de vazar conteúdo sensível.

**Integração com audit.jsonl**:

```javascript
hooks: {
    onPreToolUse: async (input, invocation) => {
        // invocation.traceparent está disponível para correlação
        appendFileSync(
            '.github/hooks/logs/audit.jsonl',
            JSON.stringify({
                ts: new Date().toISOString(),
                event: 'toolStart',
                tool: input.toolName,
                traceparent: invocation.traceparent, // W3C Trace Context
            }) + '\n'
        );
        return { permissionDecision: 'allow' };
    },
}
```

**Estimativa de esforço**: 1-2 dias **Dependências**: P-01 + `@opentelemetry/api` **Risco**: Baixo

---

### Proposta P-07 — Sistema BYOK Multi-Modelo (Nível 2)

**Objetivo**: Aproveitar o suporte BYOK do SDK para criar um sistema de roteamento de tarefas por
modelo — usando o melhor modelo para cada tipo de tarefa.

**Conceito de roteamento**:

| Tipo de tarefa                                  | Modelo recomendado                    | Razão                        |
| ----------------------------------------------- | ------------------------------------- | ---------------------------- |
| Análise de código complexa                      | `claude-sonnet-4.5`                   | Melhor raciocínio contextual |
| Geração rápida de boilerplate                   | `gpt-4.1`                             | Velocidade                   |
| Tarefas de reasoning (matemática, planejamento) | `gpt-5` com `reasoningEffort: "high"` | Qualidade                    |
| Tarefas de baixo custo/experimentais            | `ollama/qwen3:8b` (local)             | Custo zero                   |

**Implementação**:

```javascript
// src/agent/model-router.js
import { createManagedSession } from './copilot-sdk-wrapper.js';

const MODEL_PROFILES = {
  analysis: { model: 'claude-sonnet-4.5' },
  codegen: { model: 'gpt-4.1' },
  reasoning: { model: 'gpt-5', reasoningEffort: 'high' },
  local: {
    model: 'qwen3:8b',
    provider: { type: 'openai', baseUrl: 'http://localhost:11434/v1' },
  },
};

export async function createSessionForTask(taskType) {
  const profile = MODEL_PROFILES[taskType] ?? MODEL_PROFILES.codegen;
  return createManagedSession(profile);
}
```

**Sinergia com o projeto**: O projeto já tem `test-qwen3-cloud.mjs`, `test-ollama-cloud.mjs`, etc. —
evidência de que múltiplos backends já são usados experimentalmente. P-07 formaliza isso como
infraestrutura.

**Estimativa de esforço**: 1-2 dias **Dependências**: P-01 **Risco**: Baixo

---

### Proposta P-08 — Session Resume + Continuidade de Missão (Nível 3)

**Objetivo**: Usar `resumeSession()` do SDK para retomar sessões interrompidas, integrado com o
sistema de checkpoints do hook system (`session-checkpoint.sh`).

**Problema atual**: Quando uma sessão é interrompida (crash, restart), o hook system gera um
`session-briefing.md` que o agente lê no próximo `SessionStart`. Porém o **contexto de LLM** é
perdido — o agente começa do zero.

**Solução proposta**:

```javascript
// src/agent/session-manager.js
import { CopilotClient } from '@github/copilot-sdk';
import { readFileSync, existsSync } from 'node:fs';

const STATE_FILE = '.github/hooks/state/session.json';
const SESSION_STORE = '.github/hooks/state/sdk-session-id.txt';

export async function getOrResumeSession(client, config) {
  // Verifica se existe sessão SDK persistida
  if (existsSync(SESSION_STORE)) {
    const sessionId = readFileSync(SESSION_STORE, 'utf8').trim();
    try {
      return await client.resumeSession(sessionId, {
        onPermissionRequest: config.onPermissionRequest,
      });
    } catch {
      // Sessão expirada ou inválida — cria nova
    }
  }

  // Nova sessão
  const session = await client.createSession(config);

  // Persiste session ID para retomada futura
  writeFileSync(SESSION_STORE, session.sessionId);

  return session;
}
```

**Integração com hook system**: O `session-checkpoint.sh` já salva estado. P-08 adiciona a camada de
persistência de sessão SDK, permitindo que o LLM "lembre" o contexto de conversação entre restarts.

**Estimativa de esforço**: 2-3 dias **Dependências**: P-01 **Risco**: Médio — infinite sessions do
SDK têm comportamento de checkpoint próprio; pode conflitar com `pre-compact.sh`

---

## 4. Roadmap Sugerido

### Fase 1 — Foundation (2-4 dias, baixo risco)

```
P-01 SDK Wrapper programático
P-06 Telemetria OTel básica
P-07 Roteamento multi-modelo
```

Nenhuma dessas propostas altera o hook system shell existente. São **aditivas**.

### Fase 2 — Enrichment (1-2 semanas, médio risco)

```
P-02 Hook Tools como Custom Tools SDK
P-03 SDK Session Hooks como camada de enriquecimento
```

Requer política de precedência entre hooks shell e hooks SDK (shell roda primeiro, SDK enriquece).

### Fase 3 — Advanced (2-4 semanas, alto esforço)

```
P-05 MCP Server para hook system
P-08 Session Resume + continuidade
P-04 Custom Agent "Hook Auditor"
```

---

## 5. Princípios de Design para Implementação

### 5.1 Hierarquia shell > SDK

O hook system shell é a **fonte de verdade** para compliance e state. O SDK JavaScript é uma camada
de **enriquecimento** sobre ele. Em caso de conflito, o `pre-tool-use.sh` e `stop.sh` têm
precedência absoluta.

### 5.2 Sem duplicação de estado

O `session.json` e `audit.jsonl` são os artefatos canônicos. O SDK não deve criar um estado paralelo
— ele deve ler e escrever **nesse mesmo state** quando precisar de persistência.

### 5.3 Fail-open para o SDK

Se o SDK wrapper falhar (ex: Copilot CLI não disponível), o agente continua operando normalmente via
hooks shell. A integração SDK deve ser opt-in, não obrigatória.

### 5.4 ESM e Node.js 24+

Todo código do SDK wrapper deve usar `import`/`export` ESM, 4 espaços, aspas simples,
ponto-e-vírgula. Alinhar com as convenções do `copilot-instructions.md`.

### 5.5 Segurança

- **Nunca** logar conteúdo de mensagens no audit.jsonl via SDK (usar `captureContent: false`)
- O `onPermissionRequest` handler deve ser conservador: negar por padrão, aprovar explicitamente
- Custom Tools que invocam scripts shell devem usar `execFileSync` (não `exec`/`spawn` com
  shell=true) para evitar injeção de comandos
- BYOK tokens devem vir de variáveis de ambiente, nunca hardcoded

---

## 6. Análise de Dependências e Infraestrutura

### 6.1 Pré-requisitos para adoção do SDK

| Requisito                       | Status atual                         | Ação necessária                                     |
| ------------------------------- | ------------------------------------ | --------------------------------------------------- |
| Node.js 24+                     | ✅ Projeto usa Node.js 24            | —                                                   |
| ESM (`"type": "module"`)        | ✅ package.json já tem               | —                                                   |
| GitHub Copilot CLI na PATH      | ❓ Precisa verificar no devcontainer | `npm install -g @github/copilot-cli` ou equivalente |
| `@github/copilot-sdk` instalado | ❌ Não instalado                     | `npm install @github/copilot-sdk`                   |
| Token GitHub autenticado        | ❓ Depende do ambiente               | `githubToken` via env var ou login                  |
| `zod` (para P-02)               | ❓ Verificar package.json            | `npm install zod`                                   |

### 6.2 Compatibilidade com arquitetura existente

O projeto usa aliases (`#core/*`, `#infra/*`, `#driver/*`) e importações ESM. O wrapper SDK deve ser
colocado em `src/agent/` e acessado via `#agent/copilot-sdk-wrapper.js`.

### 6.3 Impacto nos testes existentes

As propostas **não afetam** o `smoke-test.sh` nem `smoke-test-payload-api.sh`. São módulos novos que
requerem testes de integração dedicados em `tests/integration/sdk/` ou equivalente.

---

## 7. Oportunidades de Longo Prazo

### 7.1 Dashboard de Sessão em Tempo Real

Combinando SDK streaming events + `src/server/` (já existente no projeto), seria possível criar um
dashboard Web que exibe:

- Streaming de respostas do Copilot em tempo real
- Estado atual de compliance (do session.json)
- Tool calls em execução
- Audit log ao vivo

### 7.2 Pipeline de Automação de Missões

O projeto já tem `src/missions/` e `src/orchestrator/`. O SDK pode ser o **driver** programático
dessas missões — substituindo a invocação manual por automação total:

```
orchestrator → SDK session → missão executada → resultado gravado → session.json atualizado
```

### 7.3 Multi-Agent com SubagentStart/Stop

O hook system já rastreia subagentes. Com o SDK, seria possível criar um **coordenador
multi-agente** que:

1. Cria sessões paralelas para subtarefas
2. Coleta resultados via eventos
3. Coordena resultado final
4. Fecha subagentes via `SubagentStop`

---

## 8. Conclusão

O **GitHub Copilot SDK** e nosso **hook system shell** são tecnologias complementares, não
concorrentes. O hook system oferece compliance enforcement, audit trail e state machine persistente
— coisas que o SDK não replica. O SDK oferece controle programático, modificação de
argumentos/resultados, custom tools tipadas e integração padronizada via MCP — coisas que o shell
não faz.

A integração mais impactante com menor risco é a **Fase 1**:

1. `P-01` — SDK wrapper que injeta o session-briefing gerado pelos hooks
2. `P-07` — Roteamento multi-modelo para tarefas diferentes
3. `P-06` — Telemetria OTel complementando o audit.jsonl

Essas três propostas juntas criam um ambiente de desenvolvimento significativamente mais poderoso
sem mexer no que já funciona.

---

_Documento gerado por análise comparativa entre o SDK docs (GitHub) e o estado atual do hook system
em `.github/hooks/`. Nenhuma implementação foi realizada._
