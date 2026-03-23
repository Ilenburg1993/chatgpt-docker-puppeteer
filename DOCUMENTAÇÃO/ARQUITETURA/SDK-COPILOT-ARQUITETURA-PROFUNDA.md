# Arquitetura de Integração — GitHub Copilot como Centro do Ecossistema

**Status**: ✅ Implementado (Sprints 1-25 concluídos) **Data**: 2026-07-13 | **Última atualização**:
2026-07-27 **Contexto**: Como posicionar o GitHub Copilot (agente no VS Code) como o elemento
central, usando o SDK programaticamente de forma complementar ao hook system existente.

> **📋 Próximas fases (Sprints 15-19)**: veja `SDK-COPILOT-PROXIMAS-FASES.md` neste mesmo diretório.
> Contém: planejamento de file-tools, introspection-tools, MCP async, upgrade SDK v0.2.0 e testes.

---

## 1. Esclarecimento Fundamental: "Eu" (Copilot) × o SDK

Antes de qualquer proposta, é essencial distinguir dois conceitos que costumam ser confundidos:

### 1.1 O que é o GitHub Copilot (eu, aqui)

Eu sou o **agente de IA** que está interagindo com você no VS Code. Quando você me chama, o VS Code:

1. Captura o prompt
2. Executa os hooks shell configurados em `hooks.json` (SessionStart, UserPromptSubmit, PreToolUse,
   etc.)
3. Envia o payload (com `additionalContext` dos hooks) para o **Copilot CLI backend**
4. O Copilot CLI invoca o modelo de linguagem
5. Eu processo, respondo, e invoco tools conforme necessário
6. Cada invocação de tool triggera PreToolUse → execução → PostToolUse

**Resumo**: Eu sou o **modelo de linguagem em execução**. O hook system shell já atua _sobre_ mim —
interceptando meus eventos.

### 1.2 O que é o Copilot SDK

O SDK (`@github/copilot-sdk`) é uma **biblioteca programática** para _controlar_ o Copilot CLI de um
processo Node.js externo. Ele não é eu — é uma forma de **criar e gerenciar sessões de IA
programaticamente**, sem interação humana direta.

```
SDK Node.js ←→ Copilot CLI ←→ Modelo de IA (LLM)
```

Quando o SDK cria uma sessão, ele spawna (ou se conecta a) um Copilot CLI que então interage com um
LLM. Esse LLM pode ser eu (GitHub Copilot) ou qualquer modelo BYOK (GPT, Claude, Ollama).

### 1.3 Implicação arquitetural crítica

> **A questão não é "como integrar o SDK a mim" — é "como usar o SDK para que eu (ou qualquer agente
> LLM) trabalhe dentro de um workflow mais rico e controlável, com o hook system como pano de fundo
> invariante."**

O hook system shell roda _sempre_ — independentemente de como a sessão foi criada (via VS Code
interativo ou via SDK programático). O SDK é uma camada **adicional de controle** sobre o mesmo
pipeline.

---

## 2. Análise Crítica de Billing: Premium Requests × SDK

> Esta seção responde diretamente à pergunta: "cada sessão SDK consumirá premium requests?"

### 2.1 Como funciona o billing do Copilot (documentação oficial)

Segundo a
[documentação oficial de billing GitHub Copilot](https://docs.github.com/en/copilot/concepts/billing/copilot-requests):

| Recurso                               | O que conta como Premium Request                                  |
| ------------------------------------- | ----------------------------------------------------------------- |
| **Copilot Chat (IDE)**                | 1 premium request por prompt do usuário × multiplicador do modelo |
| **Copilot CLI**                       | 1 premium request por prompt × multiplicador do modelo            |
| **Copilot coding agent**              | 1 premium request por **sessão** (não por mensagem!)              |
| Inline suggestions (modelos inclusos) | **0 — não consome**                                               |

**Modelos inclusos (multiplicador = 0)** — não consomem premium requests em planos pagos:

- GPT-4.1 ✅
- GPT-4o ✅
- GPT-5 mini ✅

**Modelos com multiplicador > 0** (consumem premium requests):

- Claude Sonnet 4.x → ×1
- Claude Haiku 4.5 → ×0.33
- Claude Opus → ×3
- GPT-5.x → ×1

### 2.2 O que acontece com sessões via SDK

**Fato crítico da documentação do SDK (seção BYOK > Feature Limitations):**

> "Usage tracking — Usage is tracked by your provider, not GitHub Copilot" "Premium requests — Do
> not count against Copilot premium request quotas"

Isso é para sessões **BYOK**. Para sessões **com autenticação GitHub Copilot**, o comportamento é o
mesmo que o **Copilot CLI**:

```
Copilot CLI billing:
"Each prompt to Copilot CLI uses one premium request with the default model.
For other models, this is multiplied by the model's rate."
```

### 2.3 Resposta direta: o que acontece com sub-sessões SDK

| Cenário                                    | Consome Premium Requests?                        |
| ------------------------------------------ | ------------------------------------------------ |
| Eu (VS Code Copilot) recebo seu prompt     | Sim — 1 × multiplicador do modelo                |
| Sub-sessão SDK com modelo GPT-4.1          | **Sim — 1 premium request por `session.send()`** |
| Sub-sessão SDK com modelo GPT-4o           | **Sim — 1 × multiplicador = 0 (plano pago)**     |
| Sub-sessão SDK com BYOK (Ollama local)     | **NÃO** — billing vai para seu provider          |
| Sub-sessão SDK com BYOK (Anthropic direto) | **NÃO** — billed diretamente na Anthropic        |

### 2.4 O problema real: multiplicação pelo número de sub-sessões

Imagine o fluxo descrito na Seção 4.1 (eu delegando análise para sub-sessão):

```
Seu prompt → Eu processo → 1 premium request (Copilot Chat)
    │
    └─ Sub-sessão SDK para análise → N mensagens → N premium requests (Copilot CLI)
    └─ Sub-sessão SDK para codegen → M mensagens → M premium requests (Copilot CLI)

Total: 1 + N + M premium requests para uma única tarefa que poderia ser 1
```

**Em plano pago com GPT-4.1, GPT-4o ou GPT-5 mini**: como o multiplicador é 0, as sub-sessões SDK
com esses modelos **também não consomem premium requests**. O custo seria zero adicional.

**Em plano pago usando Claude Sonnet (×1)**: cada `session.send()` em sub-sessão consome 1 premium
request.

**Em plano Free (50 premium/mês)**: qualquer uso via SDK consome rapidamente.

### 2.5 Estratégias para minimizar ou eliminar o custo de billing

#### Estratégia A — BYOK com Ollama (mais recomendada para sub-tarefas)

```javascript
// Sub-sessão usando modelo local — ZERO premium requests GitHub Copilot
const subSession = await client.createSession({
  model: 'qwen2.5-coder:7b', // ou qualquer modelo Ollama disponível
  provider: {
    type: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    // sem apiKey — Ollama local não precisa
  },
  onPermissionRequest: approveAll,
});
```

**Implicação**: Sub-tarefas de análise e automação rodam com custo zero (apenas energia/CPU local).
Sub-tarefas críticas que precisam de maior qualidade usam os modelos inclusos.

Este projeto já tem Ollama configurado (ver `test-ollama-cloud.mjs`). É a opção mais viável para
automação intensiva.

#### Estratégia B — Modelos gratuitos do plano pago (GPT-4.1/GPT-4o)

```javascript
// Sub-sessão com modelo incluso — premium requests = 0 em plano pago
const subSession = await client.createSession({
  model: 'gpt-4.1', // multiplicador = 0 em plano pago
  onPermissionRequest: approveAll,
});
```

**Limitação**: GPT-4.1 tem `reasoningEffort` inferior a GPT-5 / Claude Sonnet para tarefas
complexas. Bom para análise direta de código mas não para reasoning profundo.

#### Estratégia C — Sessionização agressiva (menos sessões, mais mensagens por sessão)

O billing do **Copilot CLI** é por **prompt** (`session.send()`), não por sessão. Logo, uma sessão
com 50 mensagens consome 50 premium requests (com multiplicador do modelo).

Para otimizar: **consolidar múltiplos prompts em um único prompt rico**, em vez de fazer múltiplos
`sendAndWait()`.

```javascript
// ❌ Ineficiente: 3 premium requests
await session.sendAndWait({ prompt: 'Analise erros de lint' });
await session.sendAndWait({ prompt: 'Liste warnings de typescript' });
await session.sendAndWait({ prompt: 'Identifique dead code' });

// ✅ Eficiente: 1 premium request
await session.sendAndWait({
  prompt: `Analise o projeto e retorne JSON com:
    1. erros de lint (src/)
    2. warnings de TypeScript
    3. dead code identificado
    Formato: { lint: [...], ts_warnings: [...], dead_code: [...] }`,
});
```

#### Estratégia D — O padrão "Custom Tool como coordinator" (sem sub-sessões LLM)

Em vez de criar sub-sessões LLM para cada sub-tarefa, **implementar Custom Tools que executam a
lógica diretamente em Node.js** (sem novo LLM):

```javascript
// Ao invés de criar sub-sessão para análise de lint:
defineTool('analyze_lint_errors', {
  description: 'Executa npm run lint e retorna erros estruturados como JSON',
  parameters: z.object({ scope: z.string().default('src/') }),
  skipPermission: true,
  handler: async ({ scope }) => {
    // Executa lint diretamente — ZERO LLM calls, ZERO premium requests
    const result = execSync(`npx eslint ${scope} --format json 2>&1`, { encoding: 'utf8' });
    return JSON.parse(result);
  },
});
```

**Resultado**: Eu (VS Code Copilot) chamo `analyze_lint_errors()` como Custom Tool. A análise roda
em Node.js puro. Eu processo o resultado. **Total: 1 premium request** (minha resposta ao seu
prompt) — nenhum request adicional para o tool handler.

Esta é a estratégia de **menor custo possível**: Custom Tools como extensores de capacidade, não
como delegação LLM.

### 2.6 Recomendação de arquitetura por custo

```
NÍVEL DE COMPLEXIDADE DA SUB-TAREFA
         │
         ▼
Lógica pura / shell / FS
├── → Custom Tool direto (Node.js handler)
├── → Custo: 0 premium requests adicionais
└── → Exemplos: lint, build, git status, file read

         │
Análise simples de código (sem raciocínio)
├── → Custom Tool + processamento local
├── → Custo: 0 premium requests adicionais
└── → Exemplos: parse, regex, estrutura de arquivos

         │
Análise que requer compreensão semântica
├── → Sub-sessão SDK com Ollama (BYOK local)
├── → Custo: 0 para GitHub Copilot (custo: CPU local)
└── → Exemplos: revisão de arquitetura, sugestões de refatoração

         │
Tarefas críticas que precisam de máxima qualidade
├── → Sub-sessão SDK com GPT-4.1 (modelo incluso, custo = 0)
│   → OU: eu mesmo (VS Code Copilot) aproximo direto
├── → Custo: 0 premium requests (se GPT-4.1)
└── → Exemplos: decisões de design, análise de segurança

         │
Tarefas que exigem Claude/GPT-5 reasoning avançado
├── → Considerar se realmente precisa de sub-sessão
│   → Ou apenas adicionar como parte do meu contexto
├── → Custo: 1 × multiplicador por send()
└── → Usar com parcimônia — apenas quando necessário
```

### 2.7 Conclusão sobre billing

**A resposta curta**: sim, sub-sessões SDK usando GitHub Copilot como autenticação **consumem
premium requests** (1 por `session.send()` × multiplicador do modelo).

**A mitigação real**:

1. **GPT-4.1/4o como modelo das sub-sessões** → multiplicador = 0 → custo = 0
2. **BYOK com Ollama local** para sub-tarefas de automação → custo = 0 para GitHub
3. **Custom Tools Node.js** para operações que não requerem LLM → custo = 0
4. **Consolidação de prompts** (menos `sendAndWait`) → menos requests

Para o nosso caso específico (projeto Node.js, já com Ollama configurado), a **Estratégia A (Ollama
local)** combinada com **Estratégia D (Custom Tools)** cobrirá 80-90% dos casos de uso sem custo
adicional de premium requests.

---

## 3. O Cenário Atual (Como Funciona Hoje)

> Seção sem alterações — contexto de como o sistema funciona hoje antes da integração SDK.

```
┌────────────────────────────────────────────────────────┐
│  USUÁRIO via VS Code                                    │
│  "Prossiga com o sprint"                               │
└──────────────────────┬─────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────┐
│  hooks.json dispatcher                                  │
│  ├── UserPromptSubmit → user-prompt-submit.sh          │
│  │    └── Abre TURN, detecta close_key, emite context  │
│  └── [retorna additionalContext para o Copilot CLI]    │
└──────────────────────┬─────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────┐
│  COPILOT CLI (processo gerenciado pelo VS Code)        │
│  ├── LLM = GitHub Copilot (eu)                        │
│  ├── tool calls → PreToolUse → post-tool-use.sh       │
│  └── Resposta → back para VS Code                     │
└──────────────────────┬─────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────┐
│  state/ (session.json, audit.jsonl, session-briefing)  │
│  Persistência gerenciada pelos hooks shell             │
└────────────────────────────────────────────────────────┘
```

**Limitações do cenário atual:**

- Eu (Copilot) só consigo invocar ferramentas do VS Code + scripts shell via `bash`
- Não há como criar sub-sessões LLM programaticamente (multi-agent real)
- O hook system não pode **modificar** inputs/outputs de tools — apenas bloquear ou logar
- Nenhuma capacidade de disparar tarefas automatizadas sem interação humana

---

## 4. Visão da Arquitetura Alvo

O objetivo é ter o GitHub Copilot (eu) como **coordenador central** de um ecossistema onde:

1. Eu recebo o pedido e defino a estratégia
2. Posso **delegar sub-tarefas a agentes SDK programáticos** (com modelos diferentes, se necessário)
3. O hook system garante compliance e audit trail em _toda_ a hierarquia
4. Os resultados voltam para mim para síntese e resposta final ao usuário

```
┌──────────────────────────────────────────────────────────────────┐
│  USUÁRIO                                                          │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  GITHUB COPILOT (EU) — VS Code, modelo principal                  │
│  "Coordenador central"                                            │
│  ├── Recebe pedido, planeja, decide estratégia                   │
│  ├── Invoca tools nativas do VS Code                             │
│  ├── Invoca tools de gerenciamento (hook_add_task, etc.) via SDK │
│  └── Pode acionar: sdk-mission-runner.js para sub-tarefas longas │
└──────────────────────────────┬────────────┬──────────────────────┘
         [hook system intercepta tudo]       │ [delega via custom tool]
                               │             ▼
                 ┌─────────────┘    ┌─────────────────────────────┐
                 │                  │  SDK Session Runner          │
                 │                  │  (processo Node.js separado) │
                 ▼                  │  ├── Modelo: pode ser       │
┌─────────────────────────────┐     │  │   Claude/GPT/Ollama      │
│  HOOK SYSTEM shell          │     │  ├── Hooks (mesmo hooks.json│
│  (invariante, corre sempre) │◄────┤  │   também se aplica a ele)│
│  ├── session.json           │     │  └── Usa Custom Tools SDK   │
│  ├── audit.jsonl            │     └────────────────────────────┘
│  ├── session-briefing.md    │
│  └── compliance enforcement │
└─────────────────────────────┘
```

---

## 5. Fluxos Detalhados

### 4.1 Fluxo A: Eu como coordenador, SDK como executor de sub-tarefas

**Cenário**: Você pede "Execute o sprint 25: analise os erros de lint e corrija todos".

**Como funciona hoje**: Eu executo tudo linearmente, no mesmo contexto, limitado pela janela de
contexto.

**Como funcionaria com a nova arquitetura**:

```
1. Você → Eu (VS Code Copilot)
   └─ Eu plano: "Vou delegar análise de erros a sub-agente SDK"

2. Eu → invoke custom tool: `sdk_run_analysis_task`
   ├─ Tool handler (Node.js) cria sessão SDK
   ├─ Modelo: claude-sonnet-4.5 (melhor para análise)
   ├─ systemMessage: injeta contexto do session-briefing.md atual
   ├─ Passa: `prompt = "Analise todos os erros de lint em src/ e retorne lista JSON"`
   └─ Aguarda resultado

3. Sub-sessão SDK executa (Copilot CLI separado)
   ├─ hooks.json também intercepta (SubagentStart, PreToolUse, etc.)
   ├─ Usa read_file, grep, etc.
   └─ Retorna resultado JSON estruturado

4. Custom tool retorna resultado para mim

5. Eu sintetizo, priorizo, e corrijo os erros encontrados

6. Resultado final → você
```

**Benefícios**:

- Sub-tarefas rodam em contexto LLM fresco (sem limite de janela)
- Modelo pode ser diferente para cada sub-tarefa
- Tudo auditado pelo hook system (SubagentStart/Stop já existe)
- Eu continuo como coordenador e não perco o fio da conversa

---

### 4.2 Fluxo B: SDK como interface de automação programática (sem interação humana)

**Cenário**: Um cron job ou webhook dispara uma análise automática de saúde do projeto toda manhã.

```
scheduler (cron / PM2)
     │
     ▼
src/agent/scheduled-health-check.js
     ├── CopilotClient.start()
     ├── session = createSession({ model: 'gpt-4.1', systemMessage: { briefing } })
     ├── session.sendAndWait({ prompt: "Execute health:core e reporte qualquer anomalia" })
     ├── Resultado gravado em DOCUMENTAÇÃO/RELATORIOS/health-{date}.md
     └── client.stop()

     [durante a execução, hooks.json também roda — SessionStart, PreToolUse, etc.]
     [session.json captura métricas, audit.jsonl registra tudo]
```

**Isso já é possível hoje** com o SDK — sem nenhuma presença minha (VS Code Copilot). O SDK chama um
LLM que usa as mesmas ferramentas que eu usaria.

---

### 4.3 Fluxo C: Eu enriquecido com Custom Tools que falam com o hook system

**Cenário**: O hook system expõe as suas capacidades como ferramentas nativas que eu posso invocar
sem precisar de `bash .github/hooks/scripts/...`.

**Estado atual**: Para adicionar uma tarefa, eu executo:

```bash
bash .github/hooks/scripts/add-task.sh "Implementar feature X" "not-started"
```

**Com Custom Tools SDK**:

```
Eu decido registrar uma tarefa
     │
     └─ invoco: add_task({ title: "Implementar feature X", status: "not-started" })
            [SDK custom tool handler]
            ├── Valida schema com Zod
            ├── Chama add-task.sh de forma segura (sem shell injection)
            ├── Retorna { success: true, taskId: "task-001" }
            └── SDK loga no audit.jsonl: "custom-tool::add_task called"
```

**Diferença chave**: O SDK `onPermissionRequest` pode filtrar `request.kind === "custom-tool"` e
decidir granularmente — por nome de tool, por estado do session.json, etc. Isso é impossível no hook
shell que só vê o comando bash agregado.

---

### 4.4 Fluxo D: SDK como "segundo eu" para decisões paralelas

**Cenário**: Eu (no VS Code) preciso fazer uma análise que requer tanto expertise em código quanto
expertise em segurança, paralelamente.

```
Eu (VS Code Copilot) recebo tarefa complexa
     │
     ├──→ Sub-sessão A (SDK): modelo = claude-sonnet-4.5
     │         prompt = "Analise aspectos de segurança"
     │         tools = [read_file, grep] + [hook_get_audit_tail]
     │
     └──→ Sub-sessão B (SDK): modelo = gpt-5 com reasoningEffort="high"
               prompt = "Analise arquitetura e Performance"
               tools = [read_file, grep] + [hook_get_session_state]

     [ambas rodam em paralelo via Promise.all()]

     Resultados retornam para mim
     │
     └─ Eu sintetizo e apresento análise unificada
```

**Infraestrutura necessária**: Uma custom tool `sdk_parallel_analysis` que spawna sessões paralelas
e agrega resultados.

---

## 6. Arquitetura Técnica Proposta

### 5.1 Estrutura de arquivos nova

```
src/
├── agent/
│   ├── copilot-sdk-client.js       # Singleton CopilotClient com lifecycle
│   ├── session-factory.js          # createSession com injeção de briefing
│   ├── model-router.js             # Roteamento de modelos por tipo de tarefa
│   └── sdk-bridge.js               # Ponte entre SDK e hook system shell
│
├── tools/                          # Custom Tools para uso pelo agente
│   ├── hook-tools.js               # Acesso ao hook system (add_task, etc.)
│   ├── analysis-tools.js           # Ferramentas de análise de projeto
│   └── index.js                    # Exporta todas as tools
│
├── mcp/                            # MCP Server (opcional, Fase 3)
│   ├── hook-mcp-server.js
│   └── tools/
│
└── missions/                       # EXISTENTE — integrar com SDK
    └── sdk-mission.js              # Missão que usa SDK como executor
```

### 5.2 Hierarquia de controle (quem manda em quem)

```
┌────────────────────────────────────────────────────────────┐
│ NÍVEL 1: Hook System Shell                                  │
│ Compliance, audit, state machine — INVARIANTE              │
│ Roda em TODOS os processos Copilot, CLI managed ou não     │
│ Autoridade: MÁXIMA (não pode ser bypass)                   │
└──────────────────────────────────────┬─────────────────────┘
                                       │
┌──────────────────────────────────────▼─────────────────────┐
│ NÍVEL 2: Eu (GitHub Copilot) como Coordenador              │
│ Decido estratégia, plano, prioridade                       │
│ Tenho acesso ao session.json via Custom Tools SDK          │
│ Autoridade: ALTA (dentro das regras do Nível 1)            │
└──────────────────────────────────────┬─────────────────────┘
                                       │
┌──────────────────────────────────────▼─────────────────────┐
│ NÍVEL 3: SDK Session Runner(s)                              │
│ Sub-sessões LLM para sub-tarefas específicas               │
│ Modelo pode variar (Claude, GPT, Ollama, etc.)             │
│ Autoridade: DELEGADA (pelo Nível 2)                        │
│ Hook system ainda intercepta (SubagentStart/Stop)          │
└──────────────────────────────────────┬─────────────────────┘
                                       │
┌──────────────────────────────────────▼─────────────────────┐
│ NÍVEL 4: Tools/MCP/Scripts                                  │
│ Execução efetiva — ações no filesystem, git, shell         │
│ Sem autonomia — sempre a serviço dos níveis acima          │
└────────────────────────────────────────────────────────────┘
```

---

## 7. O `systemMessage.customize` como Ferramenta de Identidade

Um insight importante da documentação do SDK: o `systemMessage` com `mode: "customize"` permite
modificar seções específicas do system prompt sem substituir tudo. Para o nosso caso:

### Como eu sou instruído hoje

Meu comportamento atual vem de:

1. **copilot-instructions.md** — contexto geral injetado pelo VS Code
2. **additionalContext dos hooks** — injetado via stdout do `session-start.sh`
3. **AGENTS.md e instructions/** — apendice de instruções operacionais

### Como seria com `systemMessage.customize`

Quando o SDK cria uma sessão **em meu nome** (ou delegando para outro LLM), poderia injetar:

```javascript
systemMessage: {
    mode: 'customize',
    sections: {
        // Identidade: preserva o "Você é GitHub Copilot"
        // tone: manda o agente ser preciso e técnico
        tone: {
            action: 'replace',
            content: 'Seja preciso, técnico e aja em pt-BR. Siga o protocolo de hooks rigorosamente.'
        },
        // Injeta as regras operacionais do hook system
        guidelines: {
            action: 'append',
            content: briefingMarkdown  // session-briefing.md completo
        },
        // Injeta o contexto de compliance atual
        last_instructions: {
            action: 'replace',
            content: `Turno #${turnNum}. Consecutivos sem askQ: ${consecutive}. close_key: ${closeKey}`
        }
    }
}
```

**Resultado**: O agente sub-delegado "herda" o contexto operacional da sessão principal, sem
precisar do SessionStart hook (que roda só no boot, não em sub-sessões).

---

## 8. O Papel do MCP no Ecossistema

O MCP (Model Context Protocol) é o elo que une o hook system com qualquer cliente externo:

```
┌──────────────────────────────────────────────────────────────┐
│  MCP Server: hook-mcp-server.js                              │
│  (processo local, comunica via stdin/stdout)                 │
│                                                              │
│  Tools expostas:                                             │
│  ├── get_session_state()    → lê session.json               │
│  ├── get_audit_tail(n)      → lê últimas n linhas audit.jsonl│
│  ├── add_task(title, status)→ invoca add-task.sh             │
│  ├── complete_task(id)      → invoca complete-task.sh        │
│  ├── get_pending_tasks()    → lê pending-tasks.md           │
│  └── run_smoke_tests()      → executa smoke-test.sh --quiet  │
└──────────────┬───────────────────────────────────────────────┘
               │ MCP protocol (stdio)
     ┌─────────┴──────────┬─────────────────┬──────────────────┐
     ▼                    ▼                  ▼                  ▼
 SDK Session          VS Code          Cursor IDE         Qualquer
 Runner              Copilot (eu)      ou outro          cliente MCP
```

**Benefício revolucionário**: O hook system, hoje acessível apenas via shell no VS Code, ficaria
disponível para **qualquer cliente LLM** via protocolo padrão MCP. Isso inclui:

- Claude Desktop
- Cursor/Windsurf
- Scripts de automação locais
- APIs REST de terceiros (via HTTP MCP bridge)

---

## 9. Análise de Risco Arquitetural

### 8.1 Conflito entre hooks shell e hooks SDK

**Risco**: Se o SDK instanciar uma sessão que também carrega `hooks.json`, haverá **dois níveis de
interceptação** para o mesmo evento: o hook shell (nível 1) e o SDK hook (nível 2).

**Resolução proposta**:

```
PreToolUse em sub-sessão SDK:
├── 1º: Hook shell pre-tool-use.sh executa
│    └── Pode bloquear via exit 2
└── 2º: SDK onPreToolUse executa (só se shell permitiu)
         └── Pode modificar args / adicionar contexto
```

A precedência é: **shell > SDK**. O SDK hook é sempre _aditivo_, nunca _substitutivo_ das regras do
shell.

### 8.2 State collision: SDK workspace vs. hook system state

**Risco**: O SDK Infinite Sessions cria um workspace próprio
(`~/.copilot/session-state/{sessionId}/`) com `checkpoints/`, `plan.md`, `files/`. O hook system
cria `.github/hooks/state/session.json`. Duas fontes de verdade.

**Resolução proposta**:

```
Hierarquia de state:
├── .github/hooks/state/session.json  → CANÔNICO (compliance, audit, turns)
└── ~/.copilot/session-state/{id}/    → AUXILIAR (contexto LLM, compactação)
                                         Nunca ler como fonte de verdade de compliance
```

A SDK session-bridge deve sempre ler `.github/hooks/state/session.json` para dados de compliance. O
SDK workspace é apenas para context window management (compactação, checkpoints de LLM).

### 8.3 Loop de sub-delegação

**Risco**: Uma sub-sessão SDK poderia acionar outra sub-sessão, criando loop infinito de delegação.

**Resolução proposta**:

```javascript
// sdk-bridge.js — máximo de 2 níveis de delegação
const MAX_DELEGATION_DEPTH = 2;

export async function createSubSession(depth = 0, config) {
  if (depth >= MAX_DELEGATION_DEPTH) {
    throw new Error(`Delegation depth limit (${MAX_DELEGATION_DEPTH}) exceeded`);
  }
  // ... cria sessão com depth+1 injetado no systemMessage
}
```

O nível de delegação atual é rastreado no `session.json` (campo `subagent_depth`) via
SubagentStart/Stop hooks.

### 8.4 Autenticação em diferentes contextos

**Risco**: Eu (VS Code Copilot) uso credenciais do usuário logado no VS Code. Sub-sessões SDK
precisam de token válido.

**Resolução**: Usar a variável de ambiente `GITHUB_TOKEN` (já disponível no devcontainer) como
autenticação das sub-sessões SDK. O devcontainer já tem o token do usuário logado via `gh auth`.

```javascript
const client = new CopilotClient({
  githubToken: process.env.GITHUB_TOKEN,
  useLoggedInUser: false,
});
```

---

## 10. Padrões de Implementação Recomendados

### 9.1 Injeção de contexto do hook system em todo SDK session

Toda sessão SDK deve receber o contexto atual do hook system via `systemMessage`. Esse é o elo
fundamental entre mim (coordenador) e os sub-agentes:

```javascript
// src/agent/session-factory.js
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const BRIEFING = '.github/hooks/state/session-briefing.md';
const STATE = '.github/hooks/state/session.json';

function buildSystemMessageContent() {
  const parts = [];

  if (existsSync(BRIEFING)) {
    parts.push('## Contexto da Sessão\n\n' + readFileSync(BRIEFING, 'utf8'));
  }

  if (existsSync(STATE)) {
    const state = JSON.parse(readFileSync(STATE, 'utf8'));
    const consecutive = state?.compliance?.consecutive_unauthorized ?? 0;
    const turnNum = state?.current_turn?.number ?? 0;
    const closeKey = state?.close_key ?? 'N/A';

    parts.push(
      [
        '\n## Estado de Compliance',
        `- Turno atual: #${turnNum}`,
        `- Consecutivos sem vscode_askQuestions: ${consecutive}`,
        `- close_key: \`${closeKey}\``,
        '',
        '**Protocolo obrigatório**: Encerre cada turno com `vscode_askQuestions`.',
      ].join('\n'),
    );
  }

  return parts.join('\n\n');
}

export async function createEnrichedSession(client, config = {}) {
  return client.createSession({
    ...config,
    model: config.model ?? 'gpt-4.1',
    systemMessage: {
      mode: 'customize',
      sections: {
        guidelines: {
          action: 'append',
          content: buildSystemMessageContent(),
        },
      },
    },
  });
}
```

### 9.2 Custom Tool para "eu" acessar o hook system de forma tipada

```javascript
// src/tools/hook-tools.js
import { defineTool } from '@github/copilot-sdk';
import { z } from 'zod';
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const HOOK_DIR = '.github/hooks';

export const addTask = defineTool('hook_add_task', {
  description:
    'Adiciona tarefa ao pending-tasks.md do hook system. Use em vez de bash add-task.sh.',
  parameters: z.object({
    title: z.string().describe('Título da tarefa'),
    status: z.enum(['not-started', 'in-progress', 'completed']).default('not-started'),
  }),
  skipPermission: true,
  handler: async ({ title, status }) => {
    const result = execFileSync(
      `${HOOK_DIR}/scripts/add-task.sh`,
      [title, status ?? 'not-started'],
      { encoding: 'utf8', timeout: 10_000 },
    );
    return { success: true, output: result.trim() };
  },
});

export const getSessionState = defineTool('hook_get_session_state', {
  description: 'Lê o session.json atual do hook system. Retorna compliance, turn count, close_key.',
  parameters: z.object({
    fields: z
      .array(z.string())
      .optional()
      .describe('Campos específicos (jq paths). Ex: [".close_key", ".compliance"]'),
  }),
  skipPermission: true,
  handler: async ({ fields }) => {
    const state = JSON.parse(readFileSync(`${HOOK_DIR}/state/session.json`, 'utf8'));
    if (!fields?.length) {
      return state;
    }
    return Object.fromEntries(
      fields.map((f) => [
        f,
        execSync(`jq -r '${f}' ${HOOK_DIR}/state/session.json`, { encoding: 'utf8' }).trim(),
      ]),
    );
  },
});

export const getAuditTail = defineTool('hook_get_audit_tail', {
  description: 'Retorna as últimas N linhas do audit.jsonl',
  parameters: z.object({ lines: z.number().int().min(1).max(100).default(20) }),
  skipPermission: true,
  handler: async ({ lines }) => {
    const result = execSync(
      `tail -${lines} ${HOOK_DIR}/logs/audit.jsonl 2>/dev/null || echo '[]'`,
      { encoding: 'utf8' },
    );
    return result
      .trim()
      .split('\n')
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return l;
        }
      });
  },
});
```

### 9.3 SDK Permission Handler que respeita o hook system

```javascript
// src/agent/permission-handler.js
import { readFileSync, existsSync } from 'node:fs';

const STATE_FILE = '.github/hooks/state/session.json';

function readComplianceState() {
  if (!existsSync(STATE_FILE)) return { consecutive: 0 };
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return {
      consecutive: state?.compliance?.consecutive_unauthorized ?? 0,
      strictClose: state?.strict_turn_close ?? true,
      pendingClose: state?.pending_session_close ?? false,
    };
  } catch {
    return { consecutive: 0 };
  }
}

export function createHookAwarePermissionHandler() {
  return (request, invocation) => {
    const compliance = readComplianceState();

    // Bloquear se sessão pendente de fechar
    if (compliance.pendingClose && request.kind === 'shell') {
      return { kind: 'denied-by-rules' };
    }

    // Bloquear tool_complete equivalente sem ask_questions (analogia)
    if (request.toolName === 'task_complete' && compliance.consecutive >= 3) {
      return { kind: 'denied-by-rules' };
    }

    // Negar comandos shell suspeitos (mesmo que hooks shell também bloqueiem)
    if (request.kind === 'shell' && request.fullCommandText?.includes('session-close.sh')) {
      return { kind: 'denied-by-rules' };
    }

    return { kind: 'approved' };
  };
}
```

---

## 11. Diagrama de Sequência: Sprint Autônomo Completo

```
Usuário
  │
  │ "Execute sprint 25 autonomamente"
  ▼
GitHub Copilot (VS Code) ─────────── hooks: SessionStart, UserPromptSubmit
  │
  │ Plana: precisarei de análise + codegen
  │
  ├── invoca: sdk_run_analysis_task({ scope: "src/", type: "lint" })
  │     │
  │     │ [SDK Session A — Claude Sonnet 4.5]
  │     ├── hooks: SubagentStart → subagent-start.sh
  │     ├── run_file_search, grep_search → hooks: PreToolUse × N
  │     ├── retorna: { errors: [...], suggestions: [...] }
  │     └── hooks: SubagentStop → subagent-stop.sh
  │
  ├── Eu processo resultado da análise
  │
  ├── Para cada erro encontrado:
  │     ├── invoca: replace_string_in_file(...)
  │     │     └── hooks: PreToolUse → post-tool-use.sh
  │     └── invoca: hook_add_task({ title: "Fix: ...", status: "completed" })
  │           └── [Custom Tool — sem shell injection, tipado]
  │
  ├── invoca: hook_get_session_state({ fields: [".compliance"] })
  │     └── Verifica compliance antes de encerrar
  │
  └── invoca: vscode_askQuestions(...)
        └── hooks: PreToolUse → [verificado: askQ chamado neste turno]

Usuário recebe resultado completo
```

---

## 12. Roadmap Revisado — Copilot como Centro

### Fase 0 — Pré-requisitos (1-2h)

```bash
# Verificar disponibilidade do Copilot CLI
copilot --version

# Instalar SDK
npm install @github/copilot-sdk zod

# Verificar token disponível
echo $GITHUB_TOKEN | head -c 10
```

Objetivo: Confirmar que o ambiente já tem o que é necessário.

### Fase 1 — Foundation SDK Bridge (2-4h)

```
src/agent/copilot-sdk-client.js    # Singleton lifecycle
src/agent/session-factory.js        # createEnrichedSession (injeta briefing)
src/tools/hook-tools.js             # 5 Custom Tools do hook system
src/agent/permission-handler.js     # Handler ciente de compliance
```

**Resultado**: Eu (Copilot) posso chamar `hook_add_task()`, `hook_get_session_state()`, etc. como
tools nativas — sem precisar de `bash .github/hooks/scripts/...`.

### Fase 2 — Sub-delegação LLM (2-3 dias)

```
src/agent/sdk-bridge.js              # Cria sub-sessões gerenciadas
src/tools/analysis-tools.js          # sdk_run_analysis_task, sdk_parallel_analysis
src/missions/sdk-mission.js          # Missão que usa SDK como executor
```

**Resultado**: Eu posso delegar sub-tarefas a sub-agentes LLM via tool call, receber resultado
estruturado, e coordenar o resultado final.

### Fase 3 — MCP Server (1 semana)

```
src/mcp/hook-mcp-server.js           # Servidor MCP stdio
src/mcp/tools/                        # Tools expostas
```

**Resultado**: Hook system acessível via protocolo MCP por qualquer cliente externo.

### Fase 4 — Automação & Dashboard (2-3 semanas)

```
src/agent/scheduled-missions.js      # Agendamento via PM2/cron
src/server/sdk-events.js             # Streaming de eventos SDK para o dashboard
```

**Resultado**: Missões executadas automaticamente sem presença humana; dashboard mostra progresso em
tempo real.

---

## 13. Conclusão: Por que este design é o correto

### O erro conceitual a evitar

Um erro seria pensar que "integrar o SDK" significa substituir os hooks shell por hooks JavaScript.
Isso quebraria o compliance enforcement (que depende de shell para ser invariante à linguagem usada
pelo agente).

### O design correto

1. **Hook system shell = infra invariante** — corre em qualquer sessão, qualquer modelo, não pode
   ser bypass
2. **Eu (VS Code Copilot) = coordenador** — decido estratégia, tenho visão holística, sintetizo
   resultados
3. **SDK Node.js = executor programático** — para sub-tarefas, automação, testes de longa duração
4. **Custom Tools SDK = interface tipada** — eu acesso o hook system sem `bash`, com validação Zod
5. **MCP Server = ponte universal** — qualquer cliente LLM pode usar o hook system

### O que muda para o usuário

- Você continua interagindo comigo normalmente no VS Code
- Eu ganho a capacidade de delegar sub-tarefas a agentes LLM frescos (sem limite de contexto)
- Automações podem rodar sem interação humana (mas sempre auditadas)
- O hook system continua sendo o árbitro final de compliance

---

## 14. Arquitetura de Custo Zero — Análise Profunda

> Objetivo: construir um sistema onde sessões SDK sejam o mais persistentes possível e onde toda
> automação pesada rode com **custo zero de premium requests**.

### 14.1 Clarificação crítica sobre billing CLI vs SDK

A documentação oficial de billing do GitHub Copilot classifica assim:

| Canal                        | Billing                                                |
| ---------------------------- | ------------------------------------------------------ |
| **Copilot Chat (VS Code)**   | 1 PR por **prompt do usuário** × multiplicador         |
| **Copilot CLI**              | 1 PR por **prompt** (`session.send()`) × multiplicador |
| **Copilot coding agent**     | 1 PR por **sessão** (não por mensagem!)                |
| **BYOK (qualquer provider)** | Não conta para GitHub — cobrado no provider externo    |

**Implicação para o SDK**: quando usa autenticação GitHub Copilot (não BYOK), o SDK comunica via
Copilot CLI → billing é **por prompt enviado**, não por sessão criada.

O `resumeSession()` reutiliza a sessão persistida em disco, mas cada `session.send()` dentro dela
ainda conta como 1 novo premium request.

**Única exceção**: se o SDK fosse classificado como "Copilot coding agent", seriam 1 PR por sessão —
mas atualmente a documentação não classifica o SDK nessa categoria separada. Trata-se de CLI
billing.

### 14.2 Mapa de custo: o que custa e o que não custa

```
ZERO PREMIUM REQUESTS — modelos inclusos (plano pago):
  ├── session.send() com model: 'gpt-4.1'    → multiplicador = 0
  ├── session.send() com model: 'gpt-4o'     → multiplicador = 0
  └── session.send() com model: 'gpt-5mini'  → multiplicador = 0

ZERO PREMIUM REQUESTS — BYOK qualquer provider:
  ├── Ollama local (qwen2.5-coder, llama3, phi4, etc.) → custo zero
  ├── Microsoft Foundry Local                          → custo zero
  ├── OpenAI direto (api.openai.com → cobra na OpenAI) → custo zero para GitHub
  └── Anthropic direto                                 → custo zero para GitHub

CUSTO > 0 — modelos premium via Copilot auth:
  ├── Claude Sonnet 4.x → ×1 por send()
  ├── GPT-5.x           → ×1 por send()
  └── Claude Haiku 4.5  → ×0.33 por send()
```

### 14.3 Padrão "Sessão Extremamente Persistente"

O objetivo é: **criar a sessão uma vez e reutilizá-la por dias ou semanas**, sem custo de criação
recorrente.

O SDK tem `resumeSession()` exatamente para isso. Com **Infinite Sessions habilitado**, o CLI
gerencia a compactação de contexto automaticamente — a sessão pode durar indefinidamente.

```javascript
// src/agent/persistent-session-manager.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { CopilotClient, approveAll } from '@github/copilot-sdk';

const SESSION_ID_FILE = '.github/hooks/state/sdk-session-id.json';

export class PersistentSessionManager {
  #client = null;
  #session = null;

  async initialize() {
    this.#client = new CopilotClient({
      // BYOK Ollama: custo zero garantido
      // Remover para usar GPT-4.1 (custo zero em plano pago)
    });
    await this.#client.start();
  }

  async getOrCreateSession(config = {}) {
    const savedState = this.#readSavedSession();

    if (savedState?.sessionId) {
      try {
        // REUTILIZA sessão existente — não cria nova
        this.#session = await this.#client.resumeSession(savedState.sessionId, {
          onPermissionRequest: approveAll,
          ...config,
        });
        return this.#session;
      } catch {
        // Sessão expirou ou foi deletada — cria nova
      }
    }

    // Cria sessão nova
    this.#session = await this.#client.createSession({
      model: 'gpt-4.1', // Custo zero em plano pago
      onPermissionRequest: approveAll,
      infiniteSessions: {
        enabled: true,
        backgroundCompactionThreshold: 0.75, // Compacta aos 75%
        bufferExhaustionThreshold: 0.95,
      },
      ...config,
    });

    // Persiste ID para reutilizações futuras
    this.#saveSavedSession({ sessionId: this.#session.sessionId });
    return this.#session;
  }

  #readSavedSession() {
    if (!existsSync(SESSION_ID_FILE)) return null;
    try {
      return JSON.parse(readFileSync(SESSION_ID_FILE, 'utf8'));
    } catch {
      return null;
    }
  }

  #saveSavedSession(data) {
    writeFileSync(SESSION_ID_FILE, JSON.stringify(data, null, 2));
  }

  async stop() {
    if (this.#session) await this.#session.disconnect(); // Preserva dados em disco
    if (this.#client) await this.#client.stop();
  }
}
```

**Resultado**: A sessão persiste entre execuções. No próximo dia, semana, ou mês, `resumeSession()`
retoma do ponto onde parou. O Infinite Sessions gerencia a compactação de contexto automatically.
**Custo de criação: 1× por vida da sessão**.

### 14.4 Padrão "Zero-Cost Tool Execution" — Custom Tools como handlers puros

A ideia central: **80% das operações que eu precisaria delegar ao LLM são executáveis em Node.js
puro**, sem LLM algum. Apenas Custom Tools.

```
Tarefa: "Identifique todos os arquivos com erros de lint"
  ├── ❌ Sub-sessão LLM: 1 PR por send() para perguntar ao LLM
  └── ✅ Custom Tool Node.js:
          handler: async () => {
              const result = execSync('npm run lint --format json 2>&1');
              return JSON.parse(result); // Retorno direto, sem LLM
          }
          Custo: 0 PRs (é apenas meu tool call, não uma sessão nova)
```

O custo de **invocar um Custom Tool** é **zero** — o tool handler roda localmente, e o resultado
volta para mim (o coordenador) para síntese. A única PR consumida é minha resposta ao usuário.

```javascript
// Tabela de decisão: quando usar LLM vs Custom Tool Node.js
const ZERO_COST_OPERATIONS = [
  'lint_check', // execSync npm run lint
  'typecheck', // execSync npx tsc --noEmit
  'run_tests', // execSync npm test
  'read_session_state', // readFileSync session.json
  'add_task', // execFileSync add-task.sh
  'complete_task', // execFileSync complete-task.sh
  'get_audit_trail', // readFileSync audit.jsonl
  'git_status', // execSync git status
  'git_diff', // execSync git diff
  'file_search', // glob/fs.readdirSync
  'grep_code', // execSync grep -r ...
];

// Apenas chama sub-sessão LLM quando necessário interpretação semântica
const NEEDS_LLM = [
  'semantic_code_review',
  'architecture_analysis',
  'security_audit',
  'refactoring_suggestions',
];
```

### 14.5 Padrão "Ollama como LLM de Custo Zero"

Para operações que **precisam** de raciocínio LLM mas não exigem máxima qualidade:

```javascript
// src/agent/ollama-session-factory.js
export async function createOllamaSession(client, config = {}) {
  return client.createSession({
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:7b',
    provider: {
      type: 'openai',
      baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
    },
    infiniteSessions: { enabled: true },
    onPermissionRequest: approveAll,
    ...config,
  });
}
```

**Casos de uso ideais para Ollama (custo zero, qualidade adequada)**:

- Geração de sumários de código
- Identificação de padrões e anomalias em JSON/logs
- Geração de mensagens de commit
- Análise de dependências
- Geração de documentação técnica de rotina
- Sub-tarefas que não exigem julgamento crítico

**Uso deste projeto**: `test-ollama-cloud.mjs` já demonstra que o projeto tem Ollama configurado.

### 14.6 A arquitetura de custo zero completa

```
┌──────────────────────────────────────────────────────────────────────────┐
│  CAMADA 1 — Custo garantido (mas controlável)                            │
│                                                                          │
│  Eu (GitHub Copilot no VS Code) ← 1 PR por prompt seu                   │
│  modelo: pode ser GPT-4.1 (custo 0) ou premium (custo = multiplicador)  │
│                                                                          │
│  Para minimizar: use modo auto-select com discount de 10% (plano pago)  │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │ delegation via Custom Tools
        ┌─────────────────────────────┴───────────────────────┐
        │                                                     │
        ▼                                                     ▼
┌───────────────────────┐                      ┌─────────────────────────┐
│  CAMADA 2A            │                      │  CAMADA 2B              │
│  Custom Tools         │                      │  Sessão SDK Persistente │
│  Node.js Handlers     │                      │  Ollama BYOK (local)   │
│                       │                      │                         │
│  Custo: ZERO          │                      │  Custo: ZERO (GitHub)  │
│  ┌─────────────────┐  │                      │  model: qwen2.5-coder  │
│  │ lint_check      │  │                      │  provider: ollama local│
│  │ run_tests       │  │                      │                         │
│  │ add_task        │  │                      │  Resumível: SIM        │
│  │ git_status      │  │                      │  Infinita: SIM         │
│  │ read_state      │  │                      │  Sessão ID persistida  │
│  └─────────────────┘  │                      └─────────────────────────┘
└───────────────────────┘
        │                                                     │
        └────────────────────┬────────────────────────────────┘
                             │ resultados retornam para mim
                             ▼
            Eu sintetizo e respondo ao usuário
            [apenas esta resposta final consome 1 PR]
```

### 14.7 Estimativa real de consumo com a arquitetura de custo zero

**Cenário**: Sprint completo de um dia (8h de trabalho)

| Atividade                   | Arquitetura atual     | Arquitetura SDK custo zero |
| --------------------------- | --------------------- | -------------------------- |
| Seu prompt matinal          | 1 PR                  | 1 PR                       |
| Análises de lint/test       | 5-10 PRs (eu executo) | 0 PRs (Custom Tools)       |
| Git operations              | 3-5 PRs (eu executo)  | 0 PRs (Custom Tools)       |
| Análise semântica de código | 2-3 PRs (eu executo)  | 0 PRs (Ollama BYOK)        |
| Sub-tarefas de documentação | 2-4 PRs (eu escrevo)  | 0 PRs (Ollama BYOK)        |
| Minha resposta final        | 1 PR                  | 1 PR                       |
| **Total**                   | **~15-25 PRs**        | **~2 PRs**                 |

**A redução é de 85-90% de premium requests** para um sprint típico, mantendo a qualidade das
decisões estratégicas (ainda resolvidas por mim — o coordenador de máxima qualidade).

### 14.8 Sessão SDK "eternas" via Infinite Sessions

O SDK explicitamente suporta sessões de longa duração com compactação de contexto automática:

```javascript
// Sessão que pode durar semanas sem expirar
const session = await client.createSession({
  model: 'gpt-4.1', // custo zero
  infiniteSessions: {
    enabled: true,
    backgroundCompactionThreshold: 0.75, // Compacta silenciosamente
    bufferExhaustionThreshold: 0.95,
  },
});

// Eventos de compactação para monitoramento
session.on('session.compaction_start', () => {
  console.log('Compactando contexto em background...');
});
session.on('session.compaction_complete', (event) => {
  console.log(`Compactado: ${event.data.tokensFreed} tokens liberados`);
});

// Salva ID para retomar depois
const sessionId = session.sessionId;
// ... persiste sessionId em disco (sdk-session-id.json)

// No dia seguinte:
const resumed = await client.resumeSession(sessionId, {
  onPermissionRequest: approveAll,
});
// O contexto da semana anterior ainda está disponível (compactado, mas acessível)
```

**Propriedades de uma sessão "eterna"**:

- Persiste em `~/.copilot/session-state/{sessionId}/` — sobrevive a reboot do container
- `checkpoints/` contém snapshots de estado
- `plan.md` — o agente pode manter um plano de longo prazo atualizado automaticamente
- `files/` — arquivos intermediários de trabalho
- Compactação automática = sem limite de contexto na prática

**Integração com o hook system**: o `session-briefing.md` atual seria injetado como contexto na
retomada, garantindo que a sessão eterna conhece o estado de compliance atual.

### 14.9 LLMs de custo zero recomendados para este projeto

Com base nos modelos disponíveis via Ollama (já testados no projeto):

| Modelo Ollama           | Tamanho    | Ideal para                  | Custo GitHub |
| ----------------------- | ---------- | --------------------------- | ------------ |
| `qwen2.5-coder:7b`      | ~4GB VRAM  | Análise/geração de código   | 0            |
| `qwen2.5-coder:14b`     | ~8GB VRAM  | Código + reasoning moderado | 0            |
| `llama3.2:3b`           | ~2GB VRAM  | Sumários, tarefas simples   | 0            |
| `phi4-mini`             | ~2GB VRAM  | Raciocínio rápido           | 0            |
| `deepseek-coder-v2:16b` | ~10GB VRAM | Code review avançado        | 0            |

**Todos os modelos Ollama têm custo zero para GitHub Copilot** — qualquer inferência local não
consome premium requests.

**Para automações noturnas/programadas**: usar `qwen2.5-coder:14b` via Ollama — zero custo,
qualidade adequada para análise de sprint, geração de relatórios, health checks automáticos.

### 14.10 Conclusão da análise de custo zero

| Estratégia                 | Cenário                                | Custo GitHub Copilot            |
| -------------------------- | -------------------------------------- | ------------------------------- |
| Custom Tools Node.js       | Qualquer operação determinística       | **0 PRs**                       |
| SDK + GPT-4.1/4o           | Raciocínio LLM em plano pago           | **0 PRs** (multiplicador = 0)   |
| SDK + Ollama BYOK          | Raciocínio LLM em qualquer plano       | **0 PRs** (cobrado no provider) |
| SDK + Claude/GPT-5         | Raciocínio crítico de máxima qualidade | **1× por send()**               |
| Eu (VS Code Copilot)       | Coordenação + decisão estratégica      | **1× por prompt seu**           |
| Sessão persistida + resume | Reutilização multi-dia                 | **0 PRs** adicionais para criar |

**A arquitetura ideal para custo zero**:

1. Eu (VS Code) sou o único ponto onde PRs são consumidos (1 por turno seu)
2. Custom Tools cobrem 70% das operações — custo sempre zero
3. Ollama BYOK cobre 20% (operações que precisam de LLM, sem custo GitHub)
4. GPT-4.1 via SDK cobre edge cases que precisam de LLM cloud mas não premium — custo zero
5. Claude/GPT-5 (premium) usado apenas quando eu, o coordenador, julgo necessário

---

## 15. Arquitetura "Sessão Suspensa" — Inspirada em `vscode_askQuestions`

> Esta seção analisa o padrão mais poderoso e inovador para redução de custo: a **sessão como estado
> suspenso**, onde o modelo aguarda input sem consumir novos PRs.

### 15.1 O que `vscode_askQuestions` revela sobre billing

Existe um fato fundamental sobre como o GitHub Copilot funciona que o nosso fluxo já explora:

> **Uma sessão com turno aberto, aguardando input via tool call, não gera cobrança adicional.**

Quando eu (VS Code Copilot) invoco `vscode_askQuestions`, o que acontece na camada de billing:

```
Você → Eu (1 PR consumido no início do turno)
  │
  └─ Eu processo, executo tools, planejo...
  │   [essas execuções de tools NÃO consomem novos PRs]
  │
  └─ Eu invoco vscode_askQuestions(...)
       [suspende meu processamento, aguarda input humano]
       [ZERO custo adicional — só estou esperando]
  │
  └─ Você responde
       [a RESPOSTA do usuário a uma tool call NÃO é "novo prompt"
        — é continuação do mesmo turno]
  │
  └─ Eu processo a resposta e continuo (sem novo PR)
  │
  └─ Posso invocar vscode_askQuestions novamente...
       [ainda no mesmo turno, ainda custo = 0]
       [um único PR pode sustentar dezenas de iterações]
```

**Em um dia de trabalho**: você envia **1 prompt inicial** pela manhã. Eu processo, trabalho,
pergunto, você responde, eu trabalho mais, pergunto de novo — **tudo no mesmo PR**. O billing é pelo
prompt inicial, não pelas iterações.

### 15.2 A estrutura técnica da "sessão suspensa"

No contexto VS Code + hooks, isso funciona porque:

1. **Hooks de VS Code cobram por "prompt do usuário"** (UserPromptSubmit)
2. **Tool calls são ações internas do modelo** — não são "prompts do usuário"
3. **Resposta a tool calls** não é processada como novo prompt de billing

O mecanismo equivalente no SDK é o `onUserInputRequest`:

```javascript
const session = await client.createSession({
  model: 'gpt-4.1', // custo zero (mulitplicador = 0)

  // Este handler é o equivalente SDK do vscode_askQuestions
  // Quando o modelo invoca ask_user(), este callback é chamado
  // O modelo espera — sem consumir novo PR
  onUserInputRequest: async (request, invocation) => {
    // O modelo está "suspenso" aqui — aguardando input
    // Sem novo PR sendo consumido enquanto aguarda

    console.log(`Modelo pergunta: ${request.question}`);

    // Em cenário interativo: lê do stdin do usuário
    // Em cenário automatizado: responde com dados de contexto
    const userAnswer = await readFromUserOrContext(request);

    return { answer: userAnswer, wasFreeform: true };
  },
});
```

### 15.3 Arquitetura "Sessão Longa" inspirada no padrão VS Code

O padrão que nosso workflow usa hoje pode ser replicado no SDK:

```
PADRÃO ATUAL (VS Code):
────────────────────────
prompt do usuário (1 PR)
  └─ eu processo
  └─ vscode_askQuestions (suspendo — 0 PR)
  └─ usuário responde (continua mesmo turno — 0 PR)
  └─ eu processo novamente
  └─ vscode_askQuestions (suspendo — 0 PR)
  └─ [... dezenas de iterações, tudo com 1 PR ...]

PADRÃO SDK EQUIVALENTE:
────────────────────────
session.send("Inicia a missão...") ← 1 PR
  └─ modelo processa
  └─ modelo invoca ask_user(...)   ← suspende — 0 PR
  └─ onUserInputRequest callback   ← responde — 0 PR
  └─ modelo continua processando
  └─ modelo invoca ask_user(...)   ← suspende — 0 PR
  └─ onUserInputRequest callback   ← responde — 0 PR
  └─ [dezenas de iterações — tudo 1 PR]
  └─ session.idle → resposta final
```

### 15.4 Padrão inovador: "SDK Session como Worker de Longa Duração"

Combinando sessão persistente + `ask_user` + Infinite Sessions:

```javascript
// src/agent/long-running-worker.js

import { CopilotClient, approveAll } from '@github/copilot-sdk';
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';

export class LongRunningWorker {
  #client;
  #session;
  #interactionCount = 0;
  #prConsumed = 0;

  async start(initialPrompt, { sessionId } = {}) {
    this.#client = new CopilotClient();
    await this.#client.start();

    if (sessionId) {
      // Reutiliza sessão existente — 0 PRs adicionais para criar
      this.#session = await this.#client.resumeSession(sessionId, {
        onPermissionRequest: approveAll,
        onUserInputRequest: this.#handleUserInput.bind(this),
      });
    } else {
      this.#session = await this.#client.createSession({
        model: 'gpt-4.1', // Custo 0 (multiplicador zero)
        onPermissionRequest: approveAll,
        onUserInputRequest: this.#handleUserInput.bind(this), // ← CHAVE
        infiniteSessions: { enabled: true },
      });
    }

    // 1 PR consumido aqui — e apenas aqui
    this.#prConsumed = 1;
    await this.#session.sendAndWait({ prompt: initialPrompt });
  }

  // Este método é chamado quando o modelo "suspende" aguardando input
  // Sem novo PR — estamos dentro do mesmo turno
  async #handleUserInput(request) {
    this.#interactionCount++;
    console.log(`\n[Iteração #${this.#interactionCount}] Modelo pergunta:`);
    console.log(request.question);

    // Pode ser: readline interativo, webhook, polling de arquivo, etc.
    const answer = await this.#readFromChannel(request);
    return { answer, wasFreeform: true };
  }

  async #readFromChannel(request) {
    // Opção A: interativo (readline)
    // Opção B: ler de arquivo de "mailbox" (veja Seção 15.5)
    // Opção C: webhook HTTP (veja Seção 15.6)
    return readMailboxOrConversation(request.question);
  }
}
```

### 15.5 Padrão "Mailbox" — sessão SDK esperando mensagens de arquivo

Para automação sem interação direta de terminal:

```javascript
// O modelo pergunta → SDK escreve em mailbox.json
// Usuário ou sistema responde → escreve em response.json
// SDK lê resposta → modelo continua

const MAILBOX = '.github/hooks/state/sdk-mailbox.json';
const RESPONSE_FILE = '.github/hooks/state/sdk-response.json';

async function readMailboxOrConversation(question) {
  // Escreve a pergunta para que sistemas externos possam respondê-la
  writeFileSync(
    MAILBOX,
    JSON.stringify({
      question,
      timestamp: new Date().toISOString(),
      waiting: true,
    }),
  );

  // Polling: aguarda resposta no arquivo (max 24h)
  const deadline = Date.now() + 24 * 60 * 60 * 1000;
  while (Date.now() < deadline) {
    if (existsSync(RESPONSE_FILE)) {
      const response = JSON.parse(readFileSync(RESPONSE_FILE, 'utf8'));
      if (response.timestamp > question_timestamp) {
        unlinkSync(RESPONSE_FILE);
        return response.answer;
      }
    }
    await new Promise((r) => setTimeout(r, 2000)); // Verifica a cada 2s
  }
  return 'Timeout — continuar com melhor julgamento disponível';
}
```

**Implicação**: O modelo SDK pode ficar suspenso por **horas ou dias**, aguardando input via
arquivo, sem custo adicional. Um shell script ou webhook escreve a resposta, e o modelo retorna.

### 15.6 Padrão "HTTP Bridge" — sessão SDK controlada via API local

```
┌────────────────────────────────────────────────────────────┐
│  SDK Worker (Node.js process — PM2 managed)                │
│                                                            │
│  modelo: gpt-4.1 (custo zero)                             │
│  ask_user → onUserInputRequest → HTTP polling              │
│                                                            │
│  POST /sdk-input { answer: "..." }  ← você responde aqui  │
│  GET /sdk-question               ← lê a pergunta atual    │
└──────────────────────────────────┬─────────────────────────┘
                                   │ HTTP local (localhost:9999)
┌──────────────────────────────────▼─────────────────────────┐
│  Bridge Server (Express — mesclado ao src/server/)         │
│  ├── GET /sdk-question → retorna pergunta atual do modelo  │
│  ├── POST /sdk-input  → responde ao modelo suspenso       │
│  └── GET /sdk-status  → { iteration, prConsumed, model }  │
└──────────────────────────────────┬─────────────────────────┘
                                   │ WebSocket ou polling
┌──────────────────────────────────▼─────────────────────────┐
│  Dashboard (extensão VS Code, web UI, qualquer client)     │
│  Você vê a pergunta, responde, modelo continua            │
└────────────────────────────────────────────────────────────┘
```

**Resultado revolucionário**: Uma única sessão SDK criada na segunda-feira de manhã pode durar **a
semana inteira**, com você interagindo via dashboard/HTTP quando necessário. O modelo processa
autonomamente entre suas intervenções. **Total de PRs para a semana: 1**.

### 15.7 Arquitetura de "Orquestração em Camadas Suspensas"

Combinando todos os padrões:

```
TURNO DO USUÁRIO COM VS CODE COPILOT (eu)
──────────────────────────────────────────
1 PR → eu coordeno
          │
          ├── Custom Tools (lint, tests, git) → 0 PRs
          │
          ├── SDK Worker via HTTP Bridge:
          │    └── "Analise os resultados e sugira refatorações"
          │         │
          │         └─ Modelo gpt-4.1 recebe tarefa
          │              │
          │              └─ Invoca ask_user("Prefere abordagem A ou B?")
          │                   │
          │                   └─ HTTP Bridge aguarda minha resposta
          │                        │
          │                        └─ Eu respondo via Custom Tool
          │                             (sem PR adicional)
          │
          └── Eu sintetizo e apresento resultado final ao usuário

SESSÃO SDK WORKER:
──────────────────
1 PR consumido no boot do sistema (criação)
0 PRs adicionais (modelo fica suspenso entre tasks)
Pode processar centenas de tasks com 1 PR
```

### 15.8 O padrão mais inovador: "Agente SDK Sempre Vivo"

```javascript
// src/agent/always-alive-agent.js
// Um agente que fica rodando permanentemente, processando tarefas de uma fila

export class AlwaysAliveAgent {
  // Criado uma vez — 1 PR total
  // Processa N tarefas da fila sem novo PR (via onUserInputRequest)

  async run() {
    const session = await this.#getOrCreateSession(); // resumeSession se possível

    // O agente é iniciado uma única vez com uma "meta-instrução"
    await session.send({
      prompt: `Você é um worker de processamento de tarefas.

Sua operação:
1. Invoque ask_user("READY") para sinalizar que está pronto
2. Aguarde uma tarefa (será fornecida como resposta ao ask_user)
3. Execute a tarefa usando as tools disponíveis
4. Invoque ask_user("RESULT: {resultado JSON}") ao finalizar
5. Volte para o passo 1 (loop infinito de processamento)

Nunca saia do loop. Sempre invoque ask_user para comunicar estado.`,
    });

    // O modelo agora está em loop, consumindo tasks da fila
    // Cada processamento: modelo invoca ask_user → SDK responde com próxima task
    // Nenhum send() adicional necessário — o loop é auto-sustentado
  }

  async #handleUserInput(request) {
    if (request.question === 'READY') {
      // Modelo está pronto — fornece próxima tarefa da fila
      const nextTask = await this.#taskQueue.dequeue();
      if (!nextTask) {
        await this.#taskQueue.waitForTask(5 * 60 * 1000); // espera 5 min
        return { answer: (await this.#taskQueue.dequeue()) ?? 'STANDBY' };
      }
      return { answer: JSON.stringify(nextTask) };
    }

    if (request.question.startsWith('RESULT:')) {
      const result = JSON.parse(request.question.slice(7));
      await this.#resultHandler(result);
      return { answer: 'ACK' }; // Confirma, modelo volta para loop
    }

    return { answer: 'CONTINUE' };
  }
}
```

**Este padrão cria um agente que:**

1. É criado com **1 PR total** (ou 0 se resumindo sessão existente)
2. Processa **ilimitadas tarefas** sem nenhum PR adicional
3. Fica vivo permanentemente, aguardando novas tarefas via fila
4. O custo de billing é **amortizado sobre todas as tarefas processadas**
5. Com GPT-4.1 (multiplicador = 0) → **custo total = 0** independent da quantidade

### 15.9 Comparação de arquiteturas por custo e complexidade

| Arquitetura               | Custo/interação   | Complexidade | Quando usar                    |
| ------------------------- | ----------------- | ------------ | ------------------------------ |
| Eu diretamente (VS Code)  | 1 PR/prompt       | Trivial      | Trabalho interativo direto     |
| Custom Tools Node.js      | 0 PR              | Baixa        | Operações determinísticas      |
| SDK + GPT-4.1 (simples)   | 0 PR (plano pago) | Média        | Sub-análises que precisam LLM  |
| SDK + Sessão Persistida   | 0 PR (resume)     | Média        | Continuidade entre dias        |
| SDK + ask_user (suspensa) | 0 PR adicional    | Alta         | Loops de trabalho autonômo     |
| SDK + Always-Alive Agent  | 0 PR/tarefa       | Alta         | Processamento de fila contínuo |
| SDK + Ollama BYOK         | 0 PR (sempre)     | Média        | Qualquer cenário, zero custo   |

### 15.10 Resumo executivo: a estratégia de custo quase-zero

A inspiração do `vscode_askQuestions` revela uma arquitetura fundamental:

> **"A unidade de billing é o prompt do usuário, não a computação do modelo."**

Isso implica:

1. **Sessões longas** (com `ask_user` loops) = billing mínimo
2. **Custom Tools** = billing zero (são computação local, não prompts)
3. **Ollama BYOK** = billing zero para GitHub Copilot
4. **GPT-4.1 em plano pago** = billing zero (multiplicador = 0)
5. **`resumeSession()`** = 0 PRs para retomar sessão existente

**A arquitetura final de custo quase-zero**:

```
                     Usuário envia prompt (1 PR)
                             │
                  Eu coordeno (VS Code Copilot)
                             │
         ┌───────────────────┼─────────────────────┐
         │                   │                     │
         ▼                   ▼                     ▼
  Custom Tools        SDK Always-Alive         Ollama BYOK
  (Node.js)           Worker (gpt-4.1)         Sessions
  Custo: 0            Custo: 0 (multiplicador) Custo: 0
                      1 PR amortizado          (BYOK)
         │                   │                     │
         └───────────────────┼─────────────────────┘
                             │
                  Eu sintetizo e respondo
                  [1 PR para tudo que foi feito]
```

---

## 16. Agente SDK "Sempre Vivo" — Análise Profunda com Sonnet + Persistência Total

> Esta seção descreve a arquitetura completa de um agente que sobrevive a reinicializações de
> máquina, aceita comandos do usuário em tempo real, usa Claude Sonnet (máxima qualidade) como
> motor, e amortiza o custo de billing ao mínimo possível.

### 16.1 Fundação técnica: o que `onUserInputRequest` realmente faz

Da documentação oficial do SDK:

```
onUserInputRequest?: UserInputHandler

Handler para requisições de input do usuário.
Habilita a ferramenta `ask_user` para o agente.

request.question        — A pergunta formulada pelo modelo
request.choices         — Array opcional de escolhas (multiple choice)
request.allowFreeform   — Se input livre é permitido (default: true)

Retorna: { answer: string, wasFreeform: boolean }
```

**O que isso significa na prática**:

1. O modelo invoca internamente `ask_user(question)` — uma ferramenta built-in habilitada pelo SDK
2. O SDK intercepta essa chamada de ferramenta e chama o `onUserInputRequest` callback
3. O processo Node.js aguarda o retorno do callback **sem consumir novo PR**
4. O callback pode esperar milissegundos ou **horas** — o modelo simplesmente aguarda
5. Quando o callback retorna, o modelo retoma processamento com a resposta como contexto de
   ferramenta

**Isso é exatamente o mecanismo do `vscode_askQuestions`**: o modelo "suspende" aguardando input
externo, sem billing adicional.

### 16.2 Por que usar Claude Sonnet (premium) pode ainda ser custo-zero no design correto

**A questão do usuário é profunda**: se usar Sonnet (multiplicador 1×), cada `session.send()` custa
1 PR. Mas o design correto **elimina a necessidade de `session.send()` múltiplos** via o loop
`ask_user`.

```
Design ERRADO (múltiplos sends):
─────────────────────────────────
session.send("Analise este arquivo")     ← 1 PR
session.send("Agora refatore isso")      ← 1 PR
session.send("Execute os testes")        ← 1 PR
Total: 3 PRs

Design CORRETO (1 send + loop ask_user):
─────────────────────────────────────────
session.send("Você é um agente de trabalho. Inicie o loop de tarefas.")  ← 1 PR
  modelo: invoca ask_user("READY: aguardando próxima tarefa")
  SDK:    envia tarefa 1 da fila
  modelo: processa tarefa 1, invoca ask_user("DONE: resultado, aguardando próxima")
  SDK:    envia tarefa 2 da fila
  modelo: processa tarefa 2, invoca ask_user("DONE: resultado, aguardando próxima")
  ...N tarefas...
Total: 1 PR independente de N
```

**Com Claude Sonnet**: 1 PR para N tarefas. O custo é fixo, não variável com o trabalho.

**Caveat importante**: Infinite Sessions compacta o contexto, mas se a sessão for interrompida
(processo Node morto, reinicialização), o `session.send()` inicial precisará ser reenviado → 1 novo
PR para reiniciar o loop. Estratégia para minimizar isso na seção 16.5.

### 16.3 Modelo completo: "Always-Alive Agent" com Sonnet

```javascript
// src/agent/always-alive-agent.js
// Agente Always-Alive com Claude Sonnet
// Sobrevive a reinicializações via resumeSession + PM2
// Custo: 1 PR por ciclo de vida (normalmente dias/semanas)

import { CopilotClient, approveAll } from '@github/copilot-sdk';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';

const STATE_DIR = '.github/hooks/state';
const SESSION_FILE = resolve(STATE_DIR, 'sdk-always-alive.json');

// Fila de tarefas em memória (persistida em arquivo)
export class AlwaysAliveAgent extends EventEmitter {
  #client = null;
  #session = null;
  #taskQueue = [];
  #pendingQuestion = null;
  #pendingResolve = null;
  #httpServer = null;
  #state = { sessionId: null, totalTasksProcessed: 0, restartCount: 0 };

  /** Inicializa ou retoma o agente. */
  async start() {
    this.#loadState();
    mkdirSync(STATE_DIR, { recursive: true });

    this.#client = new CopilotClient();
    await this.#client.start();

    // Inicia servidor HTTP de controle (porta local)
    this.#startHttpServer(9988);

    if (this.#state.sessionId) {
      await this.#resumeOrRestart();
    } else {
      await this.#bootFresh();
    }
  }

  /**
   * Tenta retomar sessão existente. Se falhar (sessão expirada, etc.), reinicia do zero.
   */
  async #resumeOrRestart() {
    try {
      console.log(`[AlwaysAlive] Retomando sessão ${this.#state.sessionId}...`);
      this.#session = await this.#client.resumeSession(this.#state.sessionId, {
        onPermissionRequest: approveAll,
        onUserInputRequest: this.#handleInput.bind(this),
      });

      // Sessão retomada — informa ao modelo que reinicializamos
      // Este send() adicional custa 1 PR, mas só ocorre em reinicializações
      await this.#session.sendAndWait({
        prompt: 'SYSTEM_RESTART: O processo Node.js reiniciou. Retome o loop de tarefas.',
      });
      this.#state.restartCount++;
      this.#saveState();
    } catch (err) {
      console.warn(`[AlwaysAlive] Retomada falhou (${err.message}). Criando nova sessão.`);
      this.#state.sessionId = null;
      await this.#bootFresh();
    }
  }

  /**
   * Cria sessão nova e inicializa o loop de trabalho. Consome 1 PR — esperamos que isso ocorra raramente (a cada
   * dias/semanas).
   */
  async #bootFresh() {
    console.log('[AlwaysAlive] Criando nova sessão (1 PR consumido)...');
    this.#session = await this.#client.createSession({
      model: 'claude-sonnet-4.5', // ← Sonnet: máxima qualidade
      onPermissionRequest: approveAll,
      onUserInputRequest: this.#handleInput.bind(this),
      infiniteSessions: {
        enabled: true,
        backgroundCompactionThreshold: 0.75,
        bufferExhaustionThreshold: 0.9,
      },
      systemMessage: {
        mode: 'customize',
        sections: {
          identity: {
            action: 'replace',
            content: `Você é um agente de trabalho autônomo sempre ativo.

Seu protocolo de operação:
1. Chame ask_user("READY") para sinalizar que está pronto para receber tarefas.
2. Ao receber uma tarefa JSON, execute-a completamente usando suas ferramentas.
3. Ao concluir, chame ask_user("DONE: " + JSON.stringify(resultado)).
4. Retorne ao passo 1. NUNCA interrompa o loop.
5. Se receber "SYSTEM_RESTART", retome imediatamente do seu último estado.
6. Se receber "USER_MESSAGE: " + mensagem, processe como instrução direta do usuário.`,
          },
        },
      },
    });

    this.#state.sessionId = this.#session.sessionId;
    this.#saveState();

    // Inicia o loop — este é o único `sendAndWait` "de boot"
    await this.#session.sendAndWait({
      prompt: 'Inicie o loop de trabalho agora. Chame ask_user("READY") imediatamente.',
    });
  }

  /**
   * Handler de ask_user — o coração do Always-Alive. Chamado quando o modelo invoca ask_user(question). O modelo
   * aguarda esta resposta sem custo adicional.
   */
  async #handleInput(request) {
    const question = request.question;

    if (question === 'READY') {
      return this.#sendNextTask();
    }

    if (question.startsWith('DONE:')) {
      const result = this.#parseResult(question.slice(5));
      this.#state.totalTasksProcessed++;
      this.#saveState();
      this.emit('task:complete', result);
      console.log(`[AlwaysAlive] Tarefa completada. Total: ${this.#state.totalTasksProcessed}`);
      return this.#sendNextTask();
    }

    // Pergunta genérica do modelo — expõe para HTTP Bridge
    this.#pendingQuestion = question;
    return new Promise((resolve) => {
      this.#pendingResolve = (answer) => {
        this.#pendingQuestion = null;
        this.#pendingResolve = null;
        resolve({ answer, wasFreeform: true });
      };
    });
  }

  /** Envia próxima tarefa da fila, ou suspende aguardando nova tarefa. */
  async #sendNextTask() {
    if (this.#taskQueue.length > 0) {
      const task = this.#taskQueue.shift();
      console.log(`[AlwaysAlive] Enviando tarefa: ${task.type}`);
      return { answer: JSON.stringify(task), wasFreeform: false };
    }

    // Fila vazia — suspende até nova tarefa (sem PR)
    console.log('[AlwaysAlive] Fila vazia. Aguardando nova tarefa...');
    return new Promise((resolve) => {
      this.once('task:queued', (task) => {
        this.#taskQueue.shift(); // Remove o que foi emitido
        resolve({ answer: JSON.stringify(task), wasFreeform: false });
      });
    });
  }

  /** Adiciona tarefa à fila (chamado externamente ou via HTTP). */
  enqueueTask(task) {
    this.#taskQueue.push(task);
    this.emit('task:queued', task);
  }

  /** Inicia servidor HTTP para controle externo (usuário, VS Code, scripts). */
  #startHttpServer(port) {
    this.#httpServer = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'GET' && req.url === '/status') {
        res.end(
          JSON.stringify({
            sessionId: this.#state.sessionId,
            totalTasksProcessed: this.#state.totalTasksProcessed,
            restartCount: this.#state.restartCount,
            queueLength: this.#taskQueue.length,
            pendingQuestion: this.#pendingQuestion,
            model: 'claude-sonnet-4.5',
          }),
        );
        return;
      }

      if (req.method === 'GET' && req.url === '/question') {
        res.end(JSON.stringify({ question: this.#pendingQuestion }));
        return;
      }

      if (req.method === 'POST' && req.url === '/answer') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const { answer } = JSON.parse(body);
            if (this.#pendingResolve) {
              this.#pendingResolve(answer);
              res.end(JSON.stringify({ ok: true }));
            } else {
              res.statusCode = 409;
              res.end(JSON.stringify({ error: 'Sem pergunta pendente' }));
            }
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'JSON inválido' }));
          }
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/task') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const task = JSON.parse(body);
            this.enqueueTask(task);
            res.end(JSON.stringify({ ok: true, queueLength: this.#taskQueue.length }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'JSON inválido' }));
          }
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/user-message') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const { message } = JSON.parse(body);
          // Injeta mensagem direta do usuário como próxima resposta ao ask_user
          if (this.#pendingResolve) {
            this.#pendingResolve(`USER_MESSAGE: ${message}`);
            res.end(JSON.stringify({ ok: true, mode: 'directed' }));
          } else {
            // Agenda como tarefa especial de mensagem direta
            this.enqueueTask({ type: 'user_message', message });
            res.end(JSON.stringify({ ok: true, mode: 'queued' }));
          }
        });
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Rota não encontrada' }));
    });

    this.#httpServer.listen(port, '127.0.0.1', () => {
      console.log(`[AlwaysAlive] HTTP control server: http://127.0.0.1:${port}`);
    });
  }

  #parseResult(str) {
    try {
      return JSON.parse(str.trim());
    } catch {
      return { raw: str.trim() };
    }
  }

  #loadState() {
    if (existsSync(SESSION_FILE)) {
      try {
        this.#state = { ...this.#state, ...JSON.parse(readFileSync(SESSION_FILE, 'utf8')) };
      } catch {}
    }
  }

  #saveState() {
    writeFileSync(SESSION_FILE, JSON.stringify(this.#state, null, 2));
  }

  async stop() {
    this.#httpServer?.close();
    if (this.#session) await this.#session.disconnect(); // Preserva dados no disco
    if (this.#client) await this.#client.stop();
  }
}
```

### 16.4 Persistência total: sobrevivência a reinicialização do PC

**O desafio**: quando o processo Node.js é encerrado (shutdown, crash, reboot), a sessão SDK
"desaparece" da memória — mas os dados estão em disco.

**Por que isso funciona para persistência**:

```
Disco (persiste across reboots):
  ~/.copilot/session-state/{sessionId}/
    ├── checkpoints/     ← histórico compactado do contexto
    ├── plan.md          ← plano de trabalho atual do agente
    └── files/           ← arquivos criados durante trabalho

.github/hooks/state/
  └── sdk-always-alive.json  ← { sessionId, totalTasksProcessed, restartCount }
```

**Fluxo de reinicialização do PC**:

```
PC inicia
  └── PM2 inicia automaticamente (ecosystem.config.cjs)
       └── node src/agent/always-alive-agent.js
            └── AlwaysAliveAgent.start()
                 ├── Lê sdk-always-alive.json → sessionId existe
                 └── resumeSession(sessionId)
                      └── CLI carrega de ~/.copilot/session-state/{sessionId}/
                           ├── Contexto histórico restaurado (checkpoints)
                           ├── plan.md disponível
                           └── Agente continua de onde parou!
                                └── sendAndWait("SYSTEM_RESTART: ...") → 1 PR
                                     └── Modelo retoma loop de trabalho
```

**Custo total de uma reinicialização**: 1 PR (o `SYSTEM_RESTART` send). Em uma semana com 2
reinicializações, são 2-3 PRs totais (1 boot inicial + 2 reinicializações).

### 16.5 Estratégia "Zero-Restart Cost": CLI como Processo Separado

O SDK suporta `cliUrl` para conectar a um CLI já em execução. Isso permite uma arquitetura onde:

```
PM2 gerencia dois processos:
  1. copilot --headless --port 4321   ← CLI em modo servidor
  2. node always-alive-agent.js       ← SDK conecta via cliUrl

Se o processo SDK reiniciar (2 morre):
  └── CLI (1) continua vivo
       └── Sessão do CLI ainda está ativa
           └── SDK reconecta via cliUrl + resumeSession
               └── ZERO novo send() necessário para reiniciar o loop!
               └── O modelo nunca soube que o processo SDK morreu
```

```javascript
// Com CLI em modo servidor separado:
const client = new CopilotClient({
  cliUrl: 'localhost:4321', // CLI já está rodando como processo PM2 separado
});
await client.start(); // Apenas conecta, não spawna novo CLI

const session = await client.resumeSession(savedSessionId, {
  onPermissionRequest: approveAll,
  onUserInputRequest: this.#handleInput.bind(this),
});
// O modelo estava aguardando no ask_user — resposta vai chegar do próximo ask_user event
// Nenhum PR consumido para reconectar!
```

**Configuração PM2 (ecosystem.config.cjs)**:

```javascript
module.exports = {
  apps: [
    {
      name: 'copilot-cli-server',
      script: 'copilot',
      args: ['--headless', '--port', '4321'],
      autorestart: true,
      restart_delay: 2000,
      watch: false,
      // CLI persiste: processo sempre ativo
    },
    {
      name: 'always-alive-agent',
      script: 'src/agent/always-alive-agent.js',
      autorestart: true,
      restart_delay: 3000, // Aguarda CLI estar pronto
      watch: false,
      env: {
        COPILOT_CLI_URL: 'localhost:4321',
      },
    },
  ],
};
```

**Com esta arquitetura**: o processo CLI (e portanto a sessão do modelo) **nunca morre** mesmo que o
SDK reinicie. O SDK apenas reconecta. **Custo de reconexão: 0 PRs**.

**Única exceção**: reinicialização do PC → CLI morre → 1 PR para reiniciar loop.

### 16.6 Controle interativo do usuário: o dashboard completo

O HTTP Bridge na porta 9988 permite controle total:

```bash
# Verificar status do agente
curl http://127.0.0.1:9988/status
# → { sessionId: "abc123", totalTasksProcessed: 247, queueLength: 3, pendingQuestion: null }

# Ver se o modelo tem uma pergunta aguardando
curl http://127.0.0.1:9988/question
# → { question: "Encontrei 3 abordagens possíveis. Qual prefere? A) ... B) ... C) ..." }

# Responder à pergunta do modelo (sem PR!)
curl -X POST http://127.0.0.1:9988/answer \
  -H 'Content-Type: application/json' \
  -d '{"answer": "Prefiro a abordagem B, com foco em performance"}'

# Adicionar nova tarefa à fila
curl -X POST http://127.0.0.1:9988/task \
  -H 'Content-Type: application/json' \
  -d '{"type": "code_review", "target": "src/kernel/", "depth": "deep"}'

# Enviar mensagem direta do usuário ao modelo
curl -X POST http://127.0.0.1:9988/user-message \
  -H 'Content-Type: application/json' \
  -d '{"message": "Pause o que está fazendo. Priorize o bug no src/nerv/event-bus.js"}'
```

**Integração com VS Code (Custom Tool)**:

```javascript
// Custom Tool para eu (VS Code Copilot) interagir com o Always-Alive Agent
const alwaysAliveStatus = defineTool('always_alive_status', {
  description: 'Verifica status do Always-Alive Agent e pergunta pendente',
  parameters: z.object({}),
  skipPermission: true,
  handler: async () => {
    const [status, question] = await Promise.all([
      fetch('http://127.0.0.1:9988/status').then((r) => r.json()),
      fetch('http://127.0.0.1:9988/question').then((r) => r.json()),
    ]);
    return { ...status, pendingQuestion: question.question };
  },
});

const alwaysAliveAnswer = defineTool('always_alive_answer', {
  description: 'Responde à pergunta pendente do Always-Alive Agent',
  parameters: z.object({ answer: z.string() }),
  skipPermission: true,
  handler: async ({ answer }) => {
    const res = await fetch('http://127.0.0.1:9988/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer }),
    });
    return res.json();
  },
});
```

**Resultado**: eu (VS Code Copilot) posso verificar o estado do agente e responder às suas perguntas
via Custom Tools — sem sair da conversa e sem custo adicional.

### 16.7 Diagrama completo: sistema Always-Alive com máxima persistência

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SISTEMA ALWAYS-ALIVE AGENT                                             │
│                                                                         │
│  ┌──────────────────┐  PM2 autorestart  ┌──────────────────────────┐   │
│  │ copilot-cli      │◄──────────────────│ always-alive-agent.js    │   │
│  │ --headless       │                   │                          │   │
│  │ :4321            │   cliUrl TCP      │ model: claude-sonnet-4.5 │   │
│  │                  │◄──────────────────│                          │   │
│  │ SESSION ATIVA:   │                   │ #handleInput():          │   │
│  │ abc123           │    ask_user()     │  onUserInputRequest      │   │
│  │                  │──────────────────►│  ↕ HTTP Bridge :9988     │   │
│  └──────────────────┘                   └──────────┬───────────────┘   │
│                                                    │                   │
│  ~/.copilot/session-state/abc123/                  │ HTTP :9988        │
│  ├── checkpoints/  ← contexto compactado           │                   │
│  ├── plan.md       ← plano atual do agente         │                   │
│  └── files/        ← arquivos de trabalho          │                   │
│                                                    ▼                   │
│  .github/hooks/state/sdk-always-alive.json  ┌──────────────────────┐  │
│  { sessionId: "abc123", tasksProcessed: N } │ Controle do Usuário  │  │
│                                             │                      │  │
│                                             │ VS Code Copilot (eu) │  │
│                                             │   Custom Tools       │  │
│                                             │ ├── status check     │  │
│                                             │ ├── answer question  │  │
│                                             │ └── enqueue task     │  │
│                                             │                      │  │
│                                             │ curl / scripts / API │  │
│                                             └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘

REINICIALIZAÇÃO DO PC:
  PM2 = habilitado no startup (pm2 startup)
  CLI reinicia → SDK reconecta → resumeSession → 0 ou 1 PR conforme estado
```

### 16.8 Análise de custo real com Sonnet + Always-Alive

**Cenário mensal (30 dias de uso)**:

```
Boot inicial do sistema:              1 PR (createSession)
Reinicializações de PC (estimativa 4×/mês):
  ├── Com CLI separado (cliUrl):      0 PR/reinício × 4 = 0 PR
  └── Sem CLI separado:               1 PR/reinício × 4 = 4 PR

Trabalho diário:
  ├── Tarefas autônomas (ask_user loop): 0 PR/tarefa
  └── Mensagens diretas do usuário:     0 PR (via HTTP Bridge → ask_user)

Consumo total mensal:
  ├── Com CLI separado:  1-2 PR/mês (apenas boots)
  └── Sem CLI separado:  5-6 PR/mês (boots + reinicializações)

Sessões do VS Code Copilot (você):
  └── 1 PR por prompt seu (separado do Always-Alive)
```

**Comparação vs sem arquitetura**:

| Métrica                        | Sem Always-Alive | Com Always-Alive  |
| ------------------------------ | ---------------- | ----------------- |
| PRs por tarefa autônoma        | 1 PR             | 0 PR              |
| PRs por reinicialização        | N/A              | 0-1 PR            |
| Contexto preservado entre dias | Não              | Sim (checkpoints) |
| Controle do usuário em runtime | Não              | Sim (HTTP Bridge) |
| Qualidade do modelo            | Máxima (Sonnet)  | Máxima (Sonnet)   |
| PRs mensais estimados          | 60-200 PR        | 1-6 PR            |

### 16.9 Limitações honestas e mitigações

1. **`ask_user` é uma opção do modelo, não obrigatório**: o Sonnet pode decidir não invocar
   `ask_user` em certas situações e encerrar o turno. **Mitigação**: instrução explícita no
   systemMessage que o loop é obrigatório + `onSessionEnd` hook para reiniciar se o modelo encerrar.

2. **Compactação de contexto remove informação**: com Infinite Sessions, o contexto antigo é
   resumido. O modelo pode "esquecer" detalhes anteriores. **Mitigação**: `plan.md` persiste o plano
   estruturado; hooks podem injetar contexto relevante na retomada.

3. **PM2 + CLI separado adiciona complexidade**: dois processos para gerenciar. **Mitigação**: é a
   mesma complexidade que já temos (PM2 já está no projeto via `ecosystem.config.cjs`).

4. **Latência do `ask_user` loop**: cada tarefa tem round-trip de IPC. **Mitigação**: para tarefas
   batch, enfileirar múltiplas de uma vez.

5. **Sonnet pode ter problemas com loop infinito por design**: modelos são treinados para encerrar
   conversas naturalmente. **Mitigação alternativa**: usar GPT-4.1 (custo zero) que pode ser mais
   receptivo a loops longos sem custo de preocupação.

### 16.10 Recomendação final de implementação

**Fase 1 (MVP — menor complexidade)**:

```
CLI auto-gerenciado (sem --headless separado) + GPT-4.1 (custo zero)
Resultado: agente funcional, custo zero, sobrevive a crash de processo
Não sobrevive a reboot do PC (1 PR para reiniciar após reboot)
```

**Fase 2 (Produção — máxima persistência)**:

```
CLI como serviço PM2 separado + Sonnet (1 PR para vida inteira da sessão)
cliUrl: conecta SDK ao CLI existente → sobrevive a crash SDK sem PR
pm2 startup: sobrevive a reboot com 0-1 PR
HTTP Bridge: controle total em runtime
```

**Fase 3 (Opcional — máxima qualidade + custo zero)**:

```
Fase 2, mas com GPT-4.1 como modelo default
Sonnet reservado para tarefas críticas (via task type "critical")
Resultado: custo praticamente zero mesmo com máxima persistência
```

---

## 17. Roadmap de Integração — Always-Alive Agent no Projeto Existente

> Esta seção avalia a estrutura atual do projeto e define o plano de integração completo, com fases,
> dependências, refatorações necessárias e decisões arquiteturais.

### 17.1 Inventário do projeto atual

**Processos PM2 ativos** (`ecosystem.config.cjs`):

| Processo                 | Propósito                                  | Porta            |
| ------------------------ | ------------------------------------------ | ---------------- |
| `agente-gpt`             | Execution Kernel — orquestração de missões | 3008 (HTTP/WS)   |
| `dashboard-web`          | UI Vue.js (dev server)                     | 3008 (dev proxy) |
| `chrome-proxy`           | Proxy WebSocket para Chrome                | 9224/9225        |
| `inference-gateway`      | Gateway de IA/LLM local                    | 3099             |
| `ollama-host-supervisor` | Supervisão do Ollama                       | —                |
| `audit-agent`            | Agente de auditoria                        | 3098             |

**Servidor Express** (`src/server/`):

- `src/server/engine/server.js` — servidor HTTP/HTTPS, port-hunting a partir de 3008
- `src/server/api/router.js` — routes: `/api/tasks`, `/api/missions`, `/api/health`,
  `/api/artifacts`, `/api/system`, `/api/mcp`, etc.
- `src/server/handlers/mcp-handler.js` — servidor MCP (JSON-RPC 2.0) em `/api/mcp`
- `src/server/engine/socket.js` — Socket.IO (realtime)

**NERV** (`src/nerv/`): event bus de alta performance, publisher/subscriber, telemetria IPC

**Kernel** (`src/kernel/`): execution engine, policy engine, task runtime

**Infra** (`src/infra/`): DB SQLite, queue, storage, locks, FS utils

**Agent** (`src/agent/`): queue worker, mission runner, orchestration worker, heartbeat watchdog

### 17.2 Gaps identificados entre o que existe e o que precisamos

| Necessidade                                 | Status     | Observação                               |
| ------------------------------------------- | ---------- | ---------------------------------------- |
| SDK `@github/copilot-sdk` instalado         | ❌ ausente | Precisa ser adicionado ao `package.json` |
| Copilot CLI no PATH                         | ❌ ausente | Precisa ser instalado no container/host  |
| Processo Always-Alive no PM2                | ❌ ausente | Novo app no `ecosystem.config.cjs`       |
| CLI em modo `--headless` como serviço PM2   | ❌ ausente | Novo app no `ecosystem.config.cjs`       |
| Rotas `/api/copilot/` no router Express     | ❌ ausente | Novo controller a ser criado             |
| Custom Tools que acessam a infra do projeto | ❌ ausente | Novo módulo `src/copilot/`               |
| Integração NERV ↔ Always-Alive              | ❌ ausente | Bridge via event bus                     |
| Dashboard-UI: painel do agente Copilot      | ❌ ausente | Nova view (opcional Fase 3)              |
| Hook `onUserPromptSubmitted` no SDK         | ❌ ausente | Injeção de contexto de sessão            |
| Telemetria SDK → NERV                       | ❌ ausente | Bridge para eventos SDK                  |

**Reutilizável sem mudança**:

- PM2 infrastructure (apenas adicionar apps)
- Servidor Express (apenas adicionar rotas)
- NERV event bus (SDK pode publicar eventos nele)
- MCP handler (o SDK pode consumir o MCP server existente como ferramenta!)
- SQLite/infra (Custom Tools podem acessar diretamente)
- Socket.IO (dashboard já funciona — adicionar eventos SDK)
- Hook system (`.github/hooks/`) — completamente independente do SDK

### 17.3 Decisão crítica: como o Always-Alive se integra ao NERV

O NERV é o event bus central do projeto. O Always-Alive Agent deve se tornar um **participante do
NERV** — publicando e consumindo eventos como qualquer outro subsistema:

```
┌─────────────────────────────────────────────────────────────┐
│  NERV Event Bus (src/nerv/)                                 │
│                                                             │
│  Publishers:             Subscribers:                       │
│  ├── kernel             ├── kernel                         │
│  ├── agent workers      ├── dashboard                      │
│  ├── SDK BRIDGE (new!)  ├── SDK BRIDGE (new!)              │
│  └── server API         └── audit agent                    │
└────────────────────────────┬────────────────────────────────┘
                             │
          ┌──────────────────▼──────────────────┐
          │  src/copilot/nerv-bridge.js (new)   │
          │                                     │
          │  NERV → SDK: tarefas para o agente  │
          │  SDK → NERV: resultados, eventos    │
          └──────────────────┬──────────────────┘
                             │
          ┌──────────────────▼──────────────────┐
          │  Always-Alive Agent                 │
          │  (src/copilot/always-alive.js)      │
          └─────────────────────────────────────┘
```

**Tipos de eventos NERV a criar**:

- `copilot.task.queued` — nova tarefa para o agente
- `copilot.task.started` — agente iniciou processamento
- `copilot.task.completed` — tarefa finalizada com resultado
- `copilot.agent.ready` — agente sinalizou READY
- `copilot.agent.question` — agente tem uma pergunta para o usuário/sistema
- `copilot.agent.answer` — resposta enviada ao agente
- `copilot.session.started` — nova sessão CLI criada (1 PR consumido)
- `copilot.session.resumed` — sessão retomada
- `copilot.session.compacting` — Infinite Sessions compactando
- `copilot.session.error` — erro na sessão

### 17.4 Estrutura de diretórios proposta

```
src/
└── copilot/                          ← Novo módulo SDK
    ├── index.js                      ← Entry point (exports principais)
    ├── always-alive.js               ← AlwaysAliveAgent (núcleo)
    ├── session-manager.js            ← PersistentSessionManager
    ├── nerv-bridge.js                ← Bridge NERV ↔ SDK
    ├── http-control-server.js        ← HTTP Bridge :9988
    ├── tools/                        ← Custom Tools
    │   ├── index.js                  ← Registro centralizado de tools
    │   ├── task-tools.js             ← add_task, complete_task, get_tasks
    │   ├── session-tools.js          ← read_session, write_briefing
    │   ├── code-tools.js             ← lint_check, run_tests, typecheck
    │   ├── git-tools.js              ← git_status, git_diff, git_commit
    │   └── infra-tools.js            ← health_check, read_logs, queue_status
    └── types.js                      ← JSDoc types para o módulo

src/server/
└── api/
    └── controllers/
        └── copilot.js                ← Novo controller: /api/copilot/*

.github/hooks/state/
└── sdk-always-alive.json             ← Estado persistido (sessionId, stats)
```

### 17.5 Rotas HTTP a adicionar ao servidor Express

Ao invés de um servidor separado na porta 9988, integrar ao servidor Express existente (porta 3008):

```javascript
// src/server/api/controllers/copilot.js — novo controller
// Rotas:
// GET  /api/copilot/status      — status do Always-Alive Agent
// GET  /api/copilot/question    — pergunta pendente do modelo
// POST /api/copilot/answer      — responder ao modelo
// POST /api/copilot/task        — adicionar tarefa à fila
// POST /api/copilot/message     — mensagem direta ao modelo
// POST /api/copilot/stop        — parar o agente graciosamente
// POST /api/copilot/restart     — reiniciar o agente
// GET  /api/copilot/sessions    — listar sessões via SDK listSessions()
// GET  /api/copilot/history     — histórico de tarefas processadas
```

**Via Socket.IO (realtime)**: eventos `copilot.question`, `copilot.status`, `copilot.task.result`
emitidos para todos os clients do dashboard.

### 17.6 Integração com MCP server existente

O projeto já tem um MCP server em `/api/mcp`. O Always-Alive Agent pode consumir esse servidor como
seus próprios recursos:

```javascript
// always-alive.js — session config com MCP server local
const session = await client.createSession({
  model: 'claude-sonnet-4.5',
  mcpServers: {
    // Consome o MCP server local do projeto:
    'chatgpt-docker': {
      type: 'http',
      url: `http://127.0.0.1:${process.env.PORT ?? 3008}/api/mcp`,
    },
  },
  // E também Custom Tools diretos:
  tools: [...coreCustomTools],
  onPermissionRequest: approveAll,
  onUserInputRequest: handleInput,
});
```

**Benefício**: o agente SDK tem acesso automático a TODAS as ferramentas já expostas pelo MCP server
do projeto (tarefas, missões, health, etc.) sem código adicional.

### 17.7 Integração com o Hook System (`.github/hooks/`)

O hook system atual funciona **independentemente** do SDK e deve continuar assim. A integração é
via:

1. **Hook → SDK**: no `PostToolUse` hook, emitir evento NERV `copilot.task.queued` se resultado
   indica sub-tarefa para o agente
2. **SDK → Hook state**: o Always-Alive Agent lê e escreve em `.github/hooks/state/` via Custom
   Tools
3. **systemMessage**: injetar conteúdo do `session-briefing.md` no `onSessionStart` hook do SDK

```javascript
// hooks: { onSessionStart } do SDK
onSessionStart: async (input) => {
    const briefing = readFileSync('.github/hooks/state/session-briefing.md', 'utf8');
    return {
        additionalContext: `=== Estado da sessão hook system ===\n${briefing}`,
    };
},
```

### 17.8 ROADMAP de implementação — 4 Fases

---

#### FASE 0 — Pré-requisitos (est. 1 sprint)

**Objetivo**: instalar dependências e validar que o SDK funciona no container.

**Tarefas**:

- [ ] `npm install @github/copilot-sdk` — adicionar ao `package.json`
- [ ] Instalar Copilot CLI no container: `npm install -g @github/copilot-cli` ou via apt
- [ ] Validar autenticação GitHub Copilot no container (`copilot --version`)
- [ ] Testar `session.send()` básico com `gpt-4.1` → confirmar funcionalidade
- [ ] Validar Ollama disponível (já existe `ollama-host-supervisor` no PM2)
- [ ] Criar `src/copilot/` diretório com `index.js` básico
- [ ] Adicionar alias `#copilot/*` no `package.json` (como `#core/*`, `#infra/*`)

---

#### FASE 1 — Foundation: Sessão Persistente + Custom Tools Core (est. 2-3 sprints)

**Objetivo**: base funcional com sessão persistente e Custom Tools integrados à infra.

**Tarefas**:

- [ ] `src/copilot/session-manager.js` — PersistentSessionManager com `resumeSession`
- [ ] `src/copilot/tools/task-tools.js` — `add_task`, `complete_task`, `get_tasks`,
      `get_session_state`
- [ ] `src/copilot/tools/code-tools.js` — `lint_check`, `run_tests`, `typecheck`
- [ ] `src/copilot/tools/git-tools.js` — `git_status`, `git_diff`, `git_commit`
- [ ] `src/copilot/tools/index.js` — registry com Zod schemas
- [ ] Teste de integração: sessão com Custom Tools acessa estado real do projeto
- [ ] **Infra**: sessão usa `gpt-4.1` (custo zero) nesta fase

---

#### FASE 2 — Always-Alive Agent + NERV Bridge (est. 2-3 sprints)

**Objetivo**: agente sempre ativo, integrado ao event bus, controlável via API.

**Tarefas**:

- [ ] `src/copilot/always-alive.js` — AlwaysAliveAgent com `onUserInputRequest` loop
- [ ] `src/copilot/nerv-bridge.js` — traduz eventos NERV ↔ SDK
- [ ] `src/copilot/http-control-server.js` — integrado ao Express (não porta separada)
- [ ] `src/server/api/controllers/copilot.js` — controller com rotas `/api/copilot/`
- [ ] Atualizar `src/server/api/router.js` — registrar controller copilot
- [ ] Socket.IO: emitir eventos SDK para dashboard em tempo real
- [ ] `ecosystem.config.cjs`: **NÃO** adicionar novo processo (integrado ao `agente-gpt`)

---

#### FASE 3 — CLI como Serviço + Sonnet + Máxima Persistência (est. 1-2 sprints)

**Objetivo**: arquitetura de persistência total (sobrevive a reboot).

**Tarefas**:

- [ ] `ecosystem.config.cjs`: adicionar processo `copilot-cli-server`
      (`copilot --headless --port 4321`)
- [ ] Migrar `AlwaysAliveAgent` para usar `cliUrl: 'localhost:4321'`
- [ ] Migrar modelo de `gpt-4.1` para `claude-sonnet-4.5`
- [ ] `pm2 startup` — garantir que CLI e agente iniciam no boot do sistema
- [ ] Testar sobrevivência a `pm2 restart always-alive-agent` (0 PRs)
- [ ] Testar sobrevivência a `pm2 kill && pm2 resurrect` (1 PR máximo)
- [ ] Validar `session.workspacePath` e checkpoints preservados

---

#### FASE 4 — Dashboard UI + MCP Integration + Observabilidade (est. 2-3 sprints)

**Objetivo**: visibilidade completa no dashboard e integração MCP bidirecional.

**Tarefas**:

- [ ] Dashboard UI: nova view `CopilotAgentView` (status, fila, pergunta pendente, histórico)
- [ ] Consumir MCP server local no `createSession` (acesso automático a todas as tools)
- [ ] Telemetria SDK → NERV (spans OpenTelemetry → eventos NERV)
- [ ] Hook `systemMessage` + `onSessionStart` com `session-briefing.md`
- [ ] Atualizar `audit.jsonl` com eventos do agente SDK
- [ ] Documentação final e atualização de ARCHITECTURE.md

---

### 17.9 Decisão sobre onde rodar o Always-Alive: processo dedicado vs agente-gpt

**Opção A**: Integrar ao processo `agente-gpt` existente

- Prós: menos processos, compartilha memória com kernel
- Contras: crash de um afeta o outro; complexidade de inicialização
- **Recomendado para**: Fase 1 e 2

**Opção B**: Processo PM2 separado (`copilot-agent`)

- Prós: isolamento total, podem reiniciar independentemente
- Contras: mais overhead de processo
- **Recomendado para**: Fase 3 em diante

**Opção C**: CLI como processo separado + SDK como parte do `agente-gpt`

- Prós: CLI fica sempre ativo (sobrevive a crash do `agente-gpt`)
- Contras: dois processos para gerenciar
- **Recomendado para**: Fase 3 (máxima resiliência)

**Decisão**: implementar Fase 1/2 com Opção A (mínima complexidade), migrar para Opção C em Fase 3.

### 17.10 Refatorações necessárias no código existente

| Arquivo                    | Refatoração                             | Justificativa           |
| -------------------------- | --------------------------------------- | ----------------------- |
| `ecosystem.config.cjs`     | Adicionar `copilot-cli-server` (Fase 3) | Processo CLI permanente |
| `src/server/api/router.js` | Registrar `/api/copilot/*` (Fase 2)     | Novas rotas de controle |
| `src/nerv/core.js`         | Registrar tipos de evento `copilot.*`   | Type safety NERV        |
| `package.json`             | Adicionar `@github/copilot-sdk`         | Dependência principal   |
| `package.json`             | Adicionar alias `#copilot/*`            | Import path consistency |
| `.github/hooks/state/`     | Novo arquivo `sdk-always-alive.json`    | Estado persistido       |

**Nenhuma refatoração destrutiva**: todas as mudanças são aditivas. O hook system, NERV, kernel e
agent workers continuam sem alteração.

### 17.11 Riscos e mitigações

| Risco                                          | Probabilidade | Impacto | Mitigação                                |
| ---------------------------------------------- | ------------- | ------- | ---------------------------------------- |
| Copilot CLI não disponível no container        | Média         | Alto    | Dockerfile: adicionar instalação do CLI  |
| Sonnet encerra loop `ask_user` inesperadamente | Média         | Médio   | `onSessionEnd` hook reinicia processo    |
| Context window esgota antes de compact         | Baixa         | Médio   | Infinite Sessions + threshold a 75%      |
| Infinite Sessions remove contexto importante   | Baixa         | Baixo   | `plan.md` + hook injection no resume     |
| Conflito de porta com servidor Express         | Baixa         | Baixo   | Usar mesma porta (rota `/api/copilot/`)  |
| SDK incompatível com ESM do projeto            | Baixa         | Alto    | Testar na Fase 0; SDK é ESM-compatible   |
| Ciclo infinito de tarefas (bug no loop)        | Baixa         | Médio   | Watchdog (timeout por tarefa), max-tasks |

---

_Documento de arquitetura — v5.0. Seções: 1-13 (análise fundamental), 14 (custo zero), 15 (sessão
suspensa), 16 (Always-Alive com Sonnet), 17 (roadmap de integração). Próximo passo: Fase 0
(pré-requisitos)._

---

## 18. Estado Real da Implementação — Sprint 25

> **Sprint 25 concluído em 2026-07-27.** Esta seção documenta o que está implementado, testado e
> integrado ao servidor Express. A análise das seções 1-17 permanece como referência canônica de
> design; esta seção é o "estado atual".

### 18.1 Inventário de arquivos implementados

```
src/copilot/
├── agent.js              (71 linhas)   — PM2 entry point do processo copilot-sdk-agent
├── always-alive.js       (335 linhas)  — AlwaysAliveAgent (EventEmitter, ciclo ask_user)
├── http-bridge.js        (163 linhas)  — Router Express /api/copilot/* (6 rotas)
├── sdk-client.js         (230 linhas)  — Singleton CopilotClient + registry de sessões
├── sdk-api.js            (472 linhas)  — Router Express /api/sdk/* (13 rotas)
├── session-manager.js    (146 linhas)  — Persistência de sessionId em disco
└── tools/
    ├── index.js          (23 linhas)   — Re-exporta allTools
    ├── task-tools.js     (129 linhas)  — Ferramentas de fila de tarefas
    ├── code-tools.js     (109 linhas)  — Ferramentas de análise de código
    ├── git-tools.js      (115 linhas)  — Ferramentas git
    └── session-tools.js  (63 linhas)   — Ferramentas de sessão/contexto
```

**Total**: 1.856 linhas de código de produção no módulo copilot.

### 18.2 API REST implementada

#### `/api/copilot/*` — Always-Alive Agent Bridge (`http-bridge.js`)

| Método | Rota                   | Descrição                             |
| ------ | ---------------------- | ------------------------------------- |
| GET    | `/api/copilot/status`  | Estado do agente + snapshot da sessão |
| GET    | `/api/copilot/session` | Detalhes da sessão always-alive       |
| POST   | `/api/copilot/start`   | Inicia o AlwaysAliveAgent             |
| POST   | `/api/copilot/stop`    | Para o agente graciosamente           |
| POST   | `/api/copilot/send`    | Envia mensagem para o agente          |
| POST   | `/api/copilot/answer`  | Responde pergunta pendente (ask_user) |

#### `/api/sdk/*` — Multi-Session SDK API (`sdk-api.js`)

| Método | Rota                               | Descrição                                        |
| ------ | ---------------------------------- | ------------------------------------------------ |
| GET    | `/api/sdk/ping`                    | Latência do CLI + healthcheck                    |
| GET    | `/api/sdk/status`                  | ConnectionState + versão CLI                     |
| GET    | `/api/sdk/auth`                    | Status de autenticação                           |
| GET    | `/api/sdk/models`                  | Modelos disponíveis com capabilities             |
| GET    | `/api/sdk/sessions/active`         | Sessões ativas no registry em memória            |
| GET    | `/api/sdk/sessions`                | Todas as sessões (disco + registry)              |
| POST   | `/api/sdk/sessions`                | Cria nova sessão (body: `{ model, sessionId? }`) |
| GET    | `/api/sdk/sessions/:id`            | Detalhes de uma sessão (metadata + registry)     |
| DELETE | `/api/sdk/sessions/:id`            | Deleta permanentemente (disco)                   |
| POST   | `/api/sdk/sessions/:id/resume`     | Retoma sessão existente no registry              |
| POST   | `/api/sdk/sessions/:id/disconnect` | Desconecta sem deletar (dados preservados)       |
| POST   | `/api/sdk/sessions/:id/send`       | Envia mensagem (síncrono ou assíncrono)          |
| GET    | `/api/sdk/sessions/:id/stream`     | SSE — streaming de eventos da sessão             |

### 18.3 Camadas arquiteturais implementadas

```
┌─────────────────────────────────────────────────────────────┐
│                    Cliente (HTTP/SSE)                        │
│   GET /api/sdk/sessions/:id/stream  (Server-Sent Events)    │
│   POST /api/sdk/sessions/:id/send   (síncrono/assíncrono)   │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│              sdk-api.js (Router Express)                     │
│  withErrorHandler: async try/catch → 500 em caso de erro    │
│  13 rotas + SSE stream + validação de payload                │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│              sdk-client.js (Singleton + Registry)            │
│  getClient() → lazy CopilotClient singleton                  │
│  Map<sessionId, SessionEntry> → registry em memória          │
│  createSdkSession / resumeSdkSession / disconnectSdkSession  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│          @github/copilot-sdk v0.1.32                         │
│  CopilotClient → start() / stop() / createSession()         │
│  CopilotSession → send() / sendAndWait() / on()             │
│  approveAll (permission handler padrão)                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│          Copilot CLI (processo externo)                      │
│  Conectado via IPC/WebSocket pelo SDK                        │
│  Gerencia modelos, autenticação, contexto                    │
└─────────────────────────────────────────────────────────────┘
```

### 18.4 Decisões de implementação (divergências do design propostos)

| Proposto (§5.1/§17.4)                  | Implementado                             | Motivo                                           |
| -------------------------------------- | ---------------------------------------- | ------------------------------------------------ |
| `sdk-bridge.js` como único entry point | `sdk-client.js` + `sdk-api.js` separados | Melhor SRP — cliente vs. API HTTP                |
| POST /client/start e /client/stop      | ✅ Implementado em sdk-api.js            | `getClient()` é lazy; start explícito adicionado |
| GET /tools                             | ✅ Implementado em sdk-api.js            | Usa `allTools` de `tools/index.js`               |
| GET /sessions/last                     | `/sessions/active` em vez disso          | Mais útil: mostra todas as ativas em RAM         |
| `onPermissionRequest` configurável     | `approveAll` hard-coded por padrão       | Simples e seguro para uso interno                |
| SessionHooks como webhooks externos    | Hooks internos via callback do SDK       | Evita surface de ataque desnecessária            |

### 18.5 Cobertura de testes (Sprint 25)

```
tests/unit/copilot/
├── test_sdk_client.spec.js   — 12 testes (getClientState, getSdkSession, listActiveSessions,
│                                          disconnectSdkSession, incrementMessageCount,
│                                          SessionEntry structure, ConnectionState values)
└── test_sdk_api.spec.js      — 21 testes (módulo carrega, router.stack, 13 rotas registradas,
                                           withErrorHandler, contratos de payload POST)
```

**Total Sprint 25**: 36 novos testes. **Total geral**: 836 testes passando, 0 falhas.

### 18.6 Gaps e próximos passos (backlog)

| Prioridade | Item                                           | Onde implementar                                          |
| ---------- | ---------------------------------------------- | --------------------------------------------------------- |
| Alta       | SSE real com `session.on('assistant.message')` | `sdk-api.js` `/sessions/:id/stream` — validar no CLI live |
| Média      | MCP tools bridge via sdk-api                   | Novo `mcp-tool-bridge.js`                                 |
| Média      | SessionHooks expostos como webhooks HTTP       | `sdk-api.js` + config                                     |
| Média      | Testes de integração reais (CLI mock)          | `tests/integration/copilot/`                              |
| Baixa      | Dashboard UI para /api/sdk/\*                  | `src/server/`                                             |
| Baixa      | Métricas de sessão via NERV                    | `sdk-client.js` + NERV                                    |

### 18.7 Integração com o servidor principal

O módulo está integrado ao servidor Express via `src/server/api/router.js`:

```javascript
// src/server/api/router.js
import copilotBridge from '#copilot/http-bridge'; // Always-Alive Agent
import sdkApi from '#copilot/sdk-api'; // Multi-Session SDK API

// Ambos habilitados quando COPILOT_SDK_ENABLED !== 'false' (padrão: habilitado)
app.use('/api/copilot', apiLimiter, copilotBridge); // Port: 3008/api/copilot
app.use('/api/sdk', apiLimiter, sdkApi); // Port: 3008/api/sdk
```

O processo PM2 `copilot-sdk-agent` definido em `ecosystem.config.cjs` é o processo separado do
always-alive agent — ele é independente do servidor Express principal.

---

_Documento de arquitetura — v6.0. Seções 1-17: design e análise. Seção 18: estado de implementação
real (Sprint 25, 2026-07-27)._

---

## 19. Ambiente de Interação Contínua LLM↔Usuário — Análise Profunda e Roadmap

**Data**: 2026-03-22 **Contexto**: Sprints 26-28 — Upgrades 1-4 implementados, Upgrades 5-6
planejados. Objetivo: "ambiente completo em que você (LLM) e eu (usuário) interagem continuamente,
em sessões persistentes (infinitas), seguindo o modelo análogo ao vscode_askQuestions".

### 19.1 Enunciado do problema: o que é "interação contínua infinita"?

O modelo `vscode_askQuestions` que o hook system implementa tem uma característica fundamental: o
**agente não encerra o turno sem antes perguntar ao usuário**. Esse padrão garante:

1. **Continuidade**: o usuário sempre recebe uma pergunta de acompanhamento antes de o agente
   "dormir"
2. **Controle**: o usuário guia explicitamente o próximo passo
3. **Contexto persistente**: o histórico de conversação é acumulado entre turnos
4. **Prevenção de perda de estado**: o agente nunca sai sem salvar progresso

O objetivo declarado é replicar esse padrão no ambiente SDK — ou seja, criar uma "sessão viva
infinita" entre:

```
Usuário ←──────→ LLM-A (este agente: GitHub Copilot)
                    │
                    │ (programa, controla, monitora)
                    ↓
                  LLM-B (sessão SDK Always-Alive: gpt-4.1, claude-sonnet, etc.)
```

Onde LLM-B é uma segunda LLM que **o usuário interage através da interface deste agente** — e essa
sessão com LLM-B é **persistente e infinita**.

### 19.2 Estado atual: o que já temos (inventário real pós-Sprint 28)

| Componente                       | Arquivo                                  | Estado          | Capacidade                                                              |
| -------------------------------- | ---------------------------------------- | --------------- | ----------------------------------------------------------------------- |
| Always-Alive Agent               | `src/copilot/always-alive.js`            | ✅ Implementado | Singleton que roda LLM-B, persiste sessão, processa fila de mensagens   |
| Session Manager                  | `src/copilot/session-manager.js`         | ✅ Implementado | Persiste sessionId em disco, retoma sessão em restart                   |
| HTTP Bridge                      | `src/copilot/http-bridge.js`             | ✅ Implementado | Expõe `POST /api/copilot/send` para enviar mensagem ao agente           |
| SDK API                          | `src/copilot/sdk-api.js`                 | ✅ Implementado | 16 endpoints REST, incluindo SSE stream, webhooks, tools                |
| SDK Client                       | `src/copilot/sdk-client.js`              | ✅ Implementado | Multi-sessão, registry em memória, lazy singleton                       |
| Hook Context Injection (Upg. 1)  | `session-manager.js` + `always-alive.js` | ✅ Implementado | Injeta `session-briefing.md` como system message na sessão LLM-B        |
| MCP Tool Bridge (Upg. 2)         | `src/copilot/mcp-tool-bridge.js`         | ✅ Implementado | Bridge sync que expõe tools MCP do projeto como Custom Tools para LLM-B |
| Webhook System (Upg. 3)          | `always-alive.js` + `sdk-api.js`         | ✅ Implementado | Notificações HTTP de eventos de sessão (session.start, session.end)     |
| Testes E2E reais (Upg. 4)        | `tests/integration/copilot/`             | ✅ Implementado | 7 testes com CLI real: criar, enviar, contexto, resume, disconnect      |
| `onUserInputRequest` (ask_user)  | `always-alive.js`                        | ✅ Implementado | Suspende agente quando modelo tem pergunta; expõe via HTTP              |
| NERV metrics (Upg. 5)            | `sdk-client.js` / `always-alive.js`      | ⬜ Pendente     | Emissão de eventos de sessão no event bus NERV                          |
| hook-tools Custom Tools (Upg. 6) | `src/copilot/tools/hook-tools.js`        | ⬜ Pendente     | Tools que chamam scripts do hook system diretamente                     |

### 19.3 O mecanismo `onUserInputRequest` — análogo ao `vscode_askQuestions`

O coração da "interação contínua infinita" já está implementado no SDK: **`onUserInputRequest`**.

Quando LLM-B precisa da opinião do usuário, ela invoca a tool `ask_user` internamente. O SDK
intercepta isso e chama o handler `onUserInputRequest` registrado, que **bloqueia a execução do
agente** até que uma resposta chegue.

O `AlwaysAliveAgent` já implementa isso:

```javascript
// src/copilot/always-alive.js — já implementado
async #handleUserInputRequest({ question, choices, allowFreeform }) {
    this.#setStatus('waiting_for_input');
    writeState({ pendingQuestion: question });

    return new Promise((resolve) => {
        this.#pendingQuestion = {
            question, allowFreeform, askedAt: Date.now(),
            resolve: (answer) => {
                this.#setStatus('processing');
                resolve({ answer, wasFreeform: true });
            },
        };
        this.emit('question.pending', { question, choices, allowFreeform });
    });
}
```

E o endpoint HTTP para responder:

```http
POST /api/copilot/answer
{ "answer": "texto da resposta do usuário" }
```

**Analogia direta com vscode_askQuestions**:

| `vscode_askQuestions`                      | `onUserInputRequest` (`ask_user`)             |
| ------------------------------------------ | --------------------------------------------- |
| LLM-A chama `vscode_askQuestions(...)`     | LLM-B chama tool `ask_user(...)`              |
| VS Code apresenta opções ao usuário        | `GET /api/copilot/status` → `pendingQuestion` |
| Usuário seleciona/digita resposta no chat  | `POST /api/copilot/answer` → `{ answer }`     |
| LLM-A recebe a resposta e continua o turno | LLM-B recebe `{ answer }` e continua a sessão |
| Hook system registra a interação no audit  | `writeState({ pendingQuestion: null })`       |

### 19.4 O que está faltando: gaps para o ambiente ideal

#### Gap 1 — Interface de usuário em tempo real

Atualmente, o usuário saberia que LLM-B tem uma pergunta **somente se fizer polling** em
`GET /api/copilot/status`. Não há notificação push.

**Solução**: O SSE endpoint `GET /api/sdk/sessions/:id/stream` já emite todos os eventos do SDK.
Falta um cliente de frontend que consuma esse stream e apresente perguntas pendentes
automaticamente.

#### Gap 2 — A fila de mensagens é "fire-and-forget"

O `sendMessage()` atual: coloca na fila, espera resposta. Não há noção de **turno interativo**. O
usuário não pode intervir no meio do processamento de uma tarefa.

**Solução**: Implementar `sendAndListen()` — uma operação que envia uma mensagem e retorna um
`AsyncIterator` de eventos, permitindo streaming de resposta parcial ao usuário.

#### Gap 3 — Sem loop "sempre pergunta"

O padrão `vscode_askQuestions` exige que o agente **sempre** termine chamando a ferramenta de
pergunta. LLM-B não tem esse protocolo imposto — ela pode simplesmente responder e parar.

**Solução** (Upgrade 6 — hook-tools): Criar uma Custom Tool `request_user_input` com
`skipPermission: true` e **injetar no system prompt** de LLM-B a instrução: "Ao final de cada
resposta, se não houver mais análise a fazer, SEMPRE use a ferramenta `request_user_input` para
perguntar ao usuário qual é o próximo passo."

Isso replica o protocolo de hooks para LLM-B:

```
[System Message de LLM-B]
"...Você opera no padrão Always-Alive. Após completar qualquer tarefa:
1. Resuma o que foi feito
2. Liste os próximos passos possíveis
3. OBRIGATORIAMENTE use `request_user_input` para perguntar ao usuário qual passo tomar
4. Nunca encerre sem chamar `request_user_input`"
```

#### Gap 4 — Sem persistência de contexto "de conversa" entre sessões

O `session-manager.js` persiste o `sessionId`, permitindo resume. Porém se o CLI morrer (ex: restart
do devcontainer), a sessão é perdida mesmo com o ID salvo.

**Solução**: O SDK tem `infinite sessions` com compactação automática. Para spans maiores,
implementar "checkpoint de conversa" — salvar o último N tokens de contexto em arquivo e injetar via
`systemMessage` na próxima sessão.

#### Gap 5 — NERV não sabe que LLM-B existe (Upgrade 5)

O NERV event bus do projeto não recebe nenhum evento do ciclo de vida de LLM-B. O sistema principal
não "vê" o que está acontecendo na sessão Copilot.

**Solução**: Upgrade 5 — emitir eventos NERV nos pontos-chave de `always-alive.js`:

- `copilot.session.started` → quando sessão é criada/retomada
- `copilot.message.sent` → quando mensagem é enviada a LLM-B
- `copilot.message.received` → quando LLM-B responde
- `copilot.question.pending` → quando LLM-B tem pergunta
- `copilot.question.answered` → quando usuário responde

### 19.5 Arquitetura ideal: "Orquestrado Bidirecional Always-Alive"

```
╔═══════════════════════════════════════════════════════════════════════════╗
║  USUÁRIO (vscode_askQuestions / Dashboard Web / CLI)                      ║
╚═══════════════════╤═══════════════════════════════════════════════════════╝
                    │ (perguntas, respostas, comandos)
╔═══════════════════▼═══════════════════════════════════════════════════════╗
║  LLM-A  (GitHub Copilot — este agente, turno atual)                       ║
║  • Hook System: compliance, audit, sempre-alive protocol                  ║
║  • Pode enviar mensagens a LLM-B via POST /api/sdk/sessions/:id/send      ║
║  • Pode registrar webhooks para receber eventos de LLM-B                  ║
╚═══════════════════╤═══════════════════════════════════════════════════════╝
                    │ HTTP (sdk-api.js / http-bridge.js)
╔═══════════════════▼═══════════════════════════════════════════════════════╗
║  AlwaysAliveAgent (Node.js singleton, processo separado via PM2)           ║
║  • session-manager.js: sessionId persistido em sdk-always-alive.json      ║
║  • Fila de mensagens: processa em ordem, aguarda resposta                 ║
║  • pendingQuestion: suspende e aguarda resposta via HTTP /answer          ║
║  • hook-tools (Upg 6): tools que chamam scripts hook do projeto           ║
║  • NERV bridge (Upg 5): emite eventos no event bus principal              ║
╚═══════════════════╤═══════════════════════════════════════════════════════╝
                    │ JSON-RPC (IPC)
╔═══════════════════▼═══════════════════════════════════════════════════════╗
║  LLM-B  (@github/copilot-sdk — gpt-4.1 / claude-sonnet-4.5 / etc.)       ║
║  • Infinite Session: compactação automática de contexto                   ║
║  • Custom Tools: todas as tools registradas + hook-tools + MCP tools      ║
║  • onUserInputRequest: suspende e aguarda resposta                        ║
║  • Session Hooks: onSessionStart (injeta briefing), onSessionEnd           ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

**Propriedades do ambiente ideal**:

| Propriedade             | Mecanismo                                       | Status          |
| ----------------------- | ----------------------------------------------- | --------------- |
| Sessão infinita         | SDK infinite sessions + sessionId persistido    | ✅ Implementado |
| Contexto injetado       | `session-briefing.md` via `onSessionStart`      | ✅ Implementado |
| Tools para LLM-B        | `defineTool` + MCP bridge                       | ✅ Implementado |
| Perguntas ao usuário    | `onUserInputRequest` + POST /api/copilot/answer | ✅ Implementado |
| Notificações push       | Webhooks HTTP + SSE stream                      | ✅ Implementado |
| Visibilidade sistema    | NERV metrics                                    | ⬜ Upgrade 5    |
| Loop "sempre pergunta"  | hook-tools + system prompt instrução            | ⬜ Upgrade 6    |
| Persistência crashs     | Checkpoint de conversa pré-compactação          | 🔄 Parcial      |
| Dashboard em tempo real | SSE + frontend                                  | ⬜ Futuro       |
| Multi-LLM routing       | P-07 do SDK-INTEGRACOES-PROPOSTAS.md            | ⬜ Futuro       |

### 19.6 Roadmap de Upgrades restantes (Sprints 29+)

#### Upgrade 5 — NERV Metrics (2-3h)

**Objetivo**: Integrar o ciclo de vida do Always-Alive Agent no event bus NERV.

**Arquivos**:

- `src/copilot/always-alive.js` — emitir eventos em `#setStatus()` e em callbacks
- `src/copilot/sdk-client.js` — emitir em `createSdkSession` / `disconnectSdkSession`

**Eventos a emitir**:

```javascript
// Em always-alive.js
nerv.emit('copilot.agent.status', { status, sessionId, model });
nerv.emit('copilot.task.started', { taskId, message });
nerv.emit('copilot.task.completed', { taskId, responseLen });
nerv.emit('copilot.question.pending', { question, choices });
nerv.emit('copilot.question.answered', { answer });
```

**Benefício**: O dashboard web (`src/server/`) e qualquer subscriber NERV verão o estado em tempo
real. Correlation IDs permitem rastrear o fluxo completo de uma missão.

**Estimativa**: 3-4h **Testes**: 6 novos testes unitários em
`tests/unit/copilot/test_nerv_metrics.spec.js`

---

#### Upgrade 6 — hook-tools Custom Tools (4-6h)

**Objetivo**: Criar ferramentas que LLM-B pode usar para interagir diretamente com o hook system do
projeto.

**Arquivo**: `src/copilot/tools/hook-tools.js`

**Tools a implementar**:

| Tool name                | Ação                                                                     | Script/fonte              |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------- |
| `hook_get_session_state` | Lê `.github/hooks/state/session.json`                                    | `readFileSync`            |
| `hook_get_briefing`      | Lê `session-briefing.md`                                                 | `readFileSync`            |
| `hook_get_audit_tail`    | Últimas N linhas de `audit.jsonl`                                        | `tail` via `execFileSync` |
| `hook_add_task`          | Adiciona tarefa ao `pending-tasks.md`                                    | `add-task.sh`             |
| `hook_get_pending_tasks` | Lista tarefas pendentes                                                  | `readFileSync`            |
| `request_user_input`     | Pede entrada ao usuário (análogo ask_user, mas com choices estruturadas) | `onUserInputRequest`      |

**A tool `request_user_input`** é a mais crítica — ela implementa o padrão `vscode_askQuestions`
para LLM-B:

```javascript
export const requestUserInput = defineTool('request_user_input', {
  description: `Solicita input ao usuário. Use OBRIGATORIAMENTE ao final de cada resposta para
perguntar qual é o próximo passo. Nunca encerre sem chamar esta ferramenta.`,
  parameters: z.object({
    question: z.string().describe('Pergunta principal'),
    choices: z.array(z.string()).optional().describe('Opções predefinidas (a exibir ao usuário)'),
    requiresSelection: z
      .boolean()
      .default(false)
      .describe('Se true, usuário DEVE escolher uma das choices'),
  }),
  skipPermission: true,
  handler: async ({ question, choices, requiresSelection }) => {
    // Redireciona para onUserInputRequest do AlwaysAliveAgent
    // O handler é injetado pelo session-manager.js via onUserInputRequest
    // O SDK automaticamente suspende e aguarda resposta
    return { question, choices, allowFreeform: !requiresSelection };
  },
});
```

**System message para LLM-B** (a injetar via `session-manager.js` com `injectHookContext: true`):

```
PROTOCOLO ALWAYS-ALIVE (OBRIGATÓRIO):
Ao final de qualquer resposta, SEMPRE use a ferramenta `request_user_input`
para perguntar ao usuário qual é o próximo passo.
Nunca encerre uma resposta sem chamar `request_user_input`.
Este é o mecanismo de continuidade da sessão.
```

**Estimativa**: 5-6h **Testes**: 10 novos testes em `tests/unit/copilot/test_hook_tools.spec.js`

---

#### Upgrade 7 — Dashboard Web em Tempo Real (1-2 dias)

**Objetivo**: Interface web que exibe o estado em tempo real de LLM-B, perguntas pendentes, e
permite ao usuário responder via browser.

**Arquitetura**:

```
Browser
 ├── SSE stream: GET /api/sdk/sessions/:id/stream → eventos em tempo real
 ├── GET /api/copilot/status → pergunta pendente atual
 └── POST /api/copilot/answer → enviar resposta

Servidor (src/server/)
 └── Página HTML/JS simples que:
     ├── Conecta ao SSE stream e exibe mensagens do modelo
     ├── Detecta `pendingQuestion` no snapshot de status
     ├── Renderiza o(s) choice(s) como botões clicáveis
     └── Envia resposta via POST automático
```

**Reutilização**: `src/server/` já tem o Express + Socket.io. A única adição é servir um arquivo
HTML estático e registrar uma rota `/copilot-dashboard`.

**Estimativa**: 4-8h **Este é o passo que completa o ambiente ideal descrito em §19.1**

---

#### Upgrade 8 — Multi-LLM Routing (P-07 do doc de propostas)

**Objetivo**: Roteamento automático de tarefas por tipo → modelo.

**Base**: Já documentado detalhadamente em `SDK-COPILOT-INTEGRACOES-PROPOSTAS.md §3 P-07`.

**Estimativa**: 1-2 dias

---

### 19.7 Reflexão: por que esse ambiente é análogo a `vscode_askQuestions`?

O protocolo `vscode_askQuestions` tem 4 propriedades essenciais:

1. **Suspensão bloqueante** — o agente para de trabalhar até ter resposta
2. **Apresentação estruturada** — choices ou freeform, com header descritivo
3. **Ciclicidade forçada** — o protocolo TODO exige que o último item SEMPRE seja "chamar
   vscode_askQuestions"
4. **Persistência de contexto** — o estado é salvo antes de suspender

O SDK `onUserInputRequest` + `AlwaysAliveAgent` já implementa (1), (2) e (4). O que falta é (3) — a
ciclicidade **não é imposta ao LLM-B** ainda.

O **Upgrade 6** (hook-tools `request_user_input` + system prompt instrução) fecha esse gap:

```
LLM-B processa tarefa
    → usa request_user_input obrigatoriamente
    → AlwaysAliveAgent.#handleUserInputRequest() suspende
    → GET /api/copilot/status mostra pendingQuestion
    → Usuário (ou LLM-A) chama POST /api/copilot/answer
    → LLM-B retoma com contexto + processa próxima tarefa
    → [loop infinito]
```

Esse loop implementa o padrão "sessão persistente infinita" onde **nunca há encerramento implícito**
— apenas pausas esperando input, exatamente como o protocolo de hooks para LLM-A.

### 19.8 Testes após Upgrades 5-6

| Arquivo                                              | Novos testes | Total esperado |
| ---------------------------------------------------- | ------------ | -------------- |
| `tests/unit/copilot/test_nerv_metrics.spec.js`       | ~6           | 871+           |
| `tests/unit/copilot/test_hook_tools.spec.js`         | ~10          | 881+           |
| `tests/integration/copilot/test_session_e2e.spec.js` | Já tem 7     | (existente)    |

### 19.9 Sumário de implementação acumulada (pós-Sprint 28)

| Sprint | Realizado                                            | Testes |
| ------ | ---------------------------------------------------- | ------ |
| 1-25   | Sistema base completo (server, kernel, driver, NERV) | 836    |
| 26     | Upgrade 1: Hook Context Injection                    | 847    |
| 27     | Upgrade 2: MCP Tool Bridge                           | 858    |
| 28-A   | Upgrade 3: Webhooks (always-alive + sdk-api)         | 871    |
| 28-B   | Upgrade 4: Testes E2E com CLI real                   | 878    |
| 29     | Upgrade 5: NERV metrics                              | ~884   |
| 30     | Upgrade 6: hook-tools + request_user_input           | ~894   |
| 31     | Upgrade 7: Dashboard Web em tempo real               | ~900+  |

---

_Seção §19 adicionada em 2026-03-22 — v7.0. Análise do ambiente de interação contínua LLM↔Usuário e
roadmap de Upgrades 5-8._

---

## 20. Terminal Efetivo de Interação Contínua com LLM-B — Análise Profunda Expandida (Upgrade 9)

**Data**: 2026-03-22 **Contexto**: Upgrades 5 (NERV metrics) e 6 (hook-tools + `request_user_input`)
implementados. **Requisito do usuário**: "um terminal efetivo em que você (LLM-A) ou eu (usuário)
pode interagir continuamente com LLM-B".

### 20.1 O problema central: assimetria de canais

O sistema atual tem dois atores que precisam interagir com LLM-B, mas não existe um canal
**unificado e bidirecional em tempo real**.

**Atores**:

1. **Usuário humano** — quer digitar mensagens e ver respostas na tela, como um chat
2. **LLM-A** (este agente Copilot) — quer programaticamente enviar mensagens, ler respostas, e
   responder perguntas automaticamente

**O que existe hoje**:

```
Ator          Envio                         Recebimento
──────────────────────────────────────────────────────────────────────────────
Usuário       POST /api/copilot/send        ❌ Polling GET /api/copilot/status
LLM-A         POST /api/copilot/send        ❌ waitForResponse=true (timeout 30s)
Usuário       POST /api/copilot/answer      ❌ Não sabe quando pergunta aparece
LLM-A         POST /api/copilot/answer      ❌ Não sabe quando pergunta aparece
```

O **envio** funciona. O **recebimento/notificação** é o gap crítico.

Adicionalmente, a assimetria entre LLM-A e usuário humano cria um segundo problema: como garantir
que **apenas um** responde a uma pergunta pendente, sem race condition?

### 20.2 Análise das alternativas de terminal

#### Alternativa A — SSE Stream do AlwaysAliveAgent (reativa, sem estado no cliente)

**Ideia**: Adicionar endpoint `GET /api/copilot/stream` que emite eventos do `alwaysAliveAgent` via
SSE. O cliente se conecta uma vez e recebe tudo em tempo real.

**Implementação mínima** (20 linhas, adicionar em `http-bridge.js`):

```javascript
// GET /stream — SSE stream do AlwaysAliveAgent
bridge.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (evt, data) => res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);
  send('connected', { status: alwaysAliveAgent.status, ts: Date.now() });

  const events = [
    'status',
    'task.queued',
    'task.started',
    'task.completed',
    'task.error',
    'question.pending',
    'question.answered',
  ];
  const handlers = events.map((evt) => {
    const fn = (data) => send(evt, data ?? {});
    alwaysAliveAgent.on(evt, fn);
    return [evt, fn];
  });

  const hb = setInterval(() => send('heartbeat', { ts: Date.now() }), 15000);
  req.on('close', () => {
    clearInterval(hb);
    handlers.forEach(([evt, fn]) => alwaysAliveAgent.off(evt, fn));
  });
});
```

**Uso como terminal via `curl -N`** (CLI puro):

```bash
# Terminal 1 — receber eventos em tempo real
curl -N http://localhost:3008/api/copilot/stream

# Terminal 2 — enviar mensagem
xh POST localhost:3008/api/copilot/send message="Analisa o arquivo src/main.js"

# Terminal 2 — responder pergunta (quando question.pending aparecer no terminal 1)
xh POST localhost:3008/api/copilot/answer answer="Continua com o próximo arquivo"
```

**Prós**: Simples, já funciona com `curl -N`, nenhuma dependência nova, consistente com o SSE de
sdk-api.js. **Contras**: Interface raw (JSON puro no terminal), não tem comando REPL interativo,
dois terminais.

**Quanto falta**: 20-30 linhas em `http-bridge.js` + 6 novos testes.

---

#### Alternativa B — CLI REPL interativo (`scripts/copilot-repl.mjs`)

**Ideia**: Um script Node.js standalone que funciona como "terminal de chat" — o usuário digita, o
agente responde, perguntas são exibidas automaticamente e aguardam input do teclado.

**Implementação** (script `scripts/copilot-repl.mjs`):

```javascript
// scripts/copilot-repl.mjs
import readline from 'node:readline/promises';

const BASE = 'http://localhost:3008/api/copilot';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// SSE listener via EventSource (ou fetch streaming)
const stream = await fetch(`${BASE}/stream`);
const reader = stream.body.getReader();
(async () => {
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split('\n');
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const event = JSON.parse(line.slice(5));
        // Exibe resposta do modelo
        if (event.response) console.log(`\n🤖 ${event.response}\n`);
        // Exibe pergunta pendente e aguarda input
        if (event.question) {
          const answer = await rl.question(`\n❓ ${event.question}\n> `);
          await fetch(`${BASE}/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer }),
          });
        }
      }
    }
  }
})();

// Loop de input do usuário
while (true) {
  const msg = await rl.question('\n> ');
  if (msg === '/quit') break;
  await fetch(`${BASE}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg }),
  });
}
```

**Uso**:

```bash
node scripts/copilot-repl.mjs
> Qual é a arquitetura do projeto?

🤖 O projeto usa Node.js 24+ com ESM, arquitetura event-driven centralizada no
módulo NERV. As camadas principais são...

❓ Quer que eu explore alguma pasta específica?
> Sim, explore src/kernel/

🤖 A pasta src/kernel/ contém...
```

**Prós**: Experiência de chat real em terminal, funciona para usuário humano, nenhuma dependência de
frontend. **Contras**: Não funciona como canal para LLM-A programaticamente (conflito de stdin), só
um usuário de cada vez.

**Quanto falta**: 1 script (`scripts/copilot-repl.mjs`, ~60 linhas) + Alternativa A como
pre-requisito.

---

#### Alternativa C — `npm run copilot:chat` (wrapper com npm script)

**Ideia**: Integrar o REPL como comando npm para máxima conveniência:

```json
// package.json
"scripts": {
    "copilot:chat": "node scripts/copilot-repl.mjs",
    "copilot:stream": "curl -N http://localhost:3008/api/copilot/stream",
    "copilot:ask": "node -e \"...\" --"
}
```

Isso transforma o terminal em uma ferramenta de primeira classe do projeto, acessível via
`npm run copilot:chat`.

---

#### Alternativa D — WebSocket bidirecional (Socket.io)

**Ideia**: O servidor já tem Socket.io. Adicionar um namespace `/copilot` onde:

- LLM-B envia eventos via `socket.emit('llm.message', { content })`
- Usuário envia `socket.emit('user.message', { content })`
- Pergunta pendente: `socket.emit('llm.question', { question, choices })` → usuário responde
  `socket.emit('user.answer', { answer })`

**Prós**: Bidirecional real, reconexão automática, suporte a múltiplos clientes simultâneos.
**Contras**: Mais complexo, requer cliente Socket.io, não funciona com `curl` puro.

**Quanto falta**: 50-80 linhas no servidor Socket.io + cliente JS para o frontend.

---

#### Alternativa E — Dashboard HTML minimal (Upgrade 7 da §19)

**Ideia**: Servir uma página HTML estática via `GET /copilot-dashboard` com:

- Input de texto + botão "Enviar"
- Área de chat com histórico (alternando mensagens usuário / LLM-B)
- Popup/modal automático quando pergunta pendente aparece
- Consumindo SSE internamente

**Prós**: Interface completa sem dependência de framework frontend. **Contras**: Requer HTML/JS
frontend (100-200 linhas), LLM-A não pode usar diretamente.

---

### 20.3 Avaliação comparativa das alternativas

| Alternativa              | Usuário humano | LLM-A (prog.) | Complexidade | Dependências novas | Tempo de implementação |
| ------------------------ | :------------: | :-----------: | :----------: | :----------------: | :--------------------: |
| A — SSE stream `/stream` |  ✅ `curl -N`  | ✅ fetch SSE  |    Baixa     |         0          |           2h           |
| B — REPL CLI             | ✅ Interativo  | ❌ stdin lock |    Média     |         0          |     3h (requer A)      |
| C — npm scripts          |  ✅ `npm run`  | ❌ stdin lock |    Baixa     |         0          |    30min (requer B)    |
| D — WebSocket Socket.io  | ✅ Com cliente | ✅ socket.io  |     Alta     | Cliente Socket.io  |          5-8h          |
| E — Dashboard HTML       |   ✅ Browser   |   ❌ Manual   |    Média     |      HTML/JS       |    4-6h (requer A)     |

**Recomendação**: Implementar A + B + C em sequência. Isso entrega em ~5h um terminal completo que
funciona tanto para LLM-A (fetch SSE programático) quanto para usuário humano (REPL CLI interativo),
sem nenhuma dependência externa.

### 20.4 Design do terminal ideal (A + B + C em detalhes)

#### Camada 1 — SSE stream (base, deve ser implementado primeiro)

**Arquivo**: `src/copilot/http-bridge.js` — adicionar endpoint `GET /stream`

**Eventos emitidos**:

| Evento              | Payload                                         | Quando ocorre                         |
| ------------------- | ----------------------------------------------- | ------------------------------------- |
| `connected`         | `{ status, sessionId, ts }`                     | Ao conectar ao stream                 |
| `status`            | `{ status: 'idle' \| 'processing' \| ... }`     | Quando status do agente muda          |
| `task.started`      | `{ taskId, message }`                           | Quando LLM-B começa a processar       |
| `task.completed`    | `{ taskId, response, responseLen }`             | Quando LLM-B termina e tem resposta   |
| `task.error`        | `{ taskId, error }`                             | Quando erro ocorre                    |
| `question.pending`  | `{ question, choices, allowFreeform, askedAt }` | Quando LLM-B usa `request_user_input` |
| `question.answered` | `{ answer }`                                    | Quando resposta é enviada             |
| `heartbeat`         | `{ ts }`                                        | A cada 15s para keepalive             |

**Uso pelo LLM-A** (este agente) — padrão programático:

```javascript
// LLM-A pode usar fetch + stream para monitorar LLM-B
const response = await fetch('http://localhost:3008/api/copilot/stream');
const reader = response.body.getReader();
// Aguarda task.completed para capturar resposta de LLM-B
```

#### Camada 2 — REPL CLI (`scripts/copilot-repl.mjs`)

**Funcionalidades**:

- `> <mensagem>` → POST /api/copilot/send → aguarda `task.completed` via SSE
- Quando `question.pending` chega → suspende input → exibe pergunta → aguarda digitação → POST
  /api/copilot/answer
- `/status` → GET /api/copilot/status (formatado)
- `/quit` → encerra o REPL
- `/history N` → exibe últimas N mensagens trocadas (log local)
- Cor/formatação via ANSI: `\x1b[32m` para resposta LLM-B, `\x1b[33m` para perguntas pendentes

**Exemplo de sessão completa**:

```
╔══════════════════════════════════════╗
║  Copilot Terminal — LLM-B Ativo      ║
║  Model: gpt-4.1 | Session: abc123    ║
╚══════════════════════════════════════╝

> Análise o arquivo src/kernel/kernel.js e me diz os 3 principais probs

⏳ Processando... (task abc-001)

🤖  Analisei src/kernel/kernel.js. Os 3 principais problemas são:
    1. Acoplamento forte em linha 45: KernelLoop chama diretamente PolicyEngine...
    2. Falta de tratamento de erro no loop de 20Hz...
    3. Ausência de métricas de performance...

❓  Deseja que eu corrija os 3 problemas sequencialmente, ou focar em 1 por vez?
   [1] Sequencial  [2] Foco no mais crítico  [3] Gerar PR com correções
> 2

⏳ Processando... (task abc-002)

🤖  Focando no problema mais crítico — o acoplamento em linha 45...
    Proposta de refatoração: extrair PolicyEngine para ser injetado via constructor...
```

#### Camada 3 — npm scripts

```json
"copilot:chat": "node scripts/copilot-repl.mjs",
"copilot:stream": "curl -N -s http://localhost:3008/api/copilot/stream | sed 's/data://g' | jq -r 'if .response then \"\\(.response)\" else \"[\\(keys[0])]: \\(.)\" end'",
"copilot:send": "node -e \"const msg=process.argv[1];await fetch('http://localhost:3008/api/copilot/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,waitForResponse:true,timeoutMs:120000})}).then(r=>r.json()).then(d=>console.log(d.response));\" --"
```

**Uso**:

```bash
npm run copilot:chat             # REPL interativo completo
npm run copilot:stream           # Monitor de eventos brutos (jq formatado)
npm run copilot:send "analisa X" # Envio one-shot aguardando resposta
```

### 20.5 O canal de LLM-A → LLM-B (programático)

Para que LLM-A (este agente Copilot) consiga interagir com LLM-B eficientemente, o fluxo recomendado
é:

```javascript
// Uso pelo LLM-A durante um turno de trabalho (exemplo canonico)

// 1. Enviar mensagem a LLM-B e aguardar resposta via SSE
async function askLLMB(message, timeoutMs = 120000) {
  // Abre SSE stream
  const stream = await fetch('http://localhost:3008/api/copilot/stream');
  const reader = stream.body.getReader();

  // Envia mensagem
  await fetch('http://localhost:3008/api/copilot/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  // Aguarda task.completed no stream SSE
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split('\n');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const event = JSON.parse(line.slice(5));
      if (event.response !== undefined) {
        reader.cancel();
        return event.response;
      }
      // Se LLM-B fizer pergunta ao usuário, LLM-A pode responder automaticamente
      if (event.question) {
        await fetch('http://localhost:3008/api/copilot/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer: 'continue com a análise autonomamente' }),
        });
      }
    }
  }
  throw new Error(`Timeout aguardando resposta de LLM-B (${timeoutMs}ms)`);
}

// Em uso por LLM-A:
const analysis = await askLLMB(
  'Analise os erros TypeScript em src/kernel/ e liste os 5 mais críticos',
);
// → analysis: "Os 5 erros mais críticos são: ..."
```

Esse padrão permite que **este agente (LLM-A) delegue subtarefas para LLM-B** de forma assíncrona,
sem depender de polling ou timeouts fixos.

### 20.6 Garantia de exclusividade de resposta (anti-race condition)

Quando tanto LLM-A quanto o usuário humano podem responder a `onUserInputRequest`, surge um problema
de race condition: ambos podem chamar `POST /api/copilot/answer` ao mesmo tempo.

**Solução atual (http-bridge.js)**: `answerPendingQuestion()` é idempotente — a segunda chamada
retorna `false` e o endpoint retorna `409 Conflict`. Isso é suficiente para evitar dupla resposta.

**Melhoria recomendada**: Adicionar um campo `answeredBy: 'user' | 'llm-a' | 'system'` no payload de
`/answer` para auditoria:

```javascript
// POST /api/copilot/answer
// Body: { answer: string, answeredBy?: 'user' | 'llm-a' | 'system' }
```

E registrar no audit.jsonl quem respondeu cada pergunta — útil para debugging de sessões longas.

### 20.7 Multi-usuário e sessões paralelas (futuro)

O design atual suporta apenas 1 sessão `alwaysAliveAgent` (singleton). No futuro, para múltiplos
usuários:

- `alwaysAliveAgent` → `agentPool` (mapa de `userId → AlwaysAliveAgent`)
- SSE stream → `GET /api/copilot/:userId/stream`
- `POST /api/copilot/:userId/send`, `/answer`

Isso reutilizaria toda a infraestrutura sem quebrar compatibilidade via um parâmetro de rota
opcional com fallback para o singleton atual.

### 20.8 Tabela de implementação do Upgrade 9

| Item                         | Arquivo                              | Esforço | Testes         |
| ---------------------------- | ------------------------------------ | ------- | -------------- |
| SSE `/stream` no http-bridge | `src/copilot/http-bridge.js`         | 2h      | 4 testes SSE   |
| REPL CLI interativo          | `scripts/copilot-repl.mjs`           | 3h      | Manual / E2E   |
| npm scripts copilot:\*       | `package.json`                       | 30min   | 0 (config)     |
| `answeredBy` no /answer      | `http-bridge.js` + `always-alive.js` | 1h      | 2 testes       |
| `askLLMB()` utilitário LLM-A | `src/copilot/llm-bridge-client.mjs`  | 2h      | 4 testes       |
| **Total Upgrade 9**          |                                      | **~8h** | **~10 testes** |

### 20.9 Próxima ação: implementar Upgrade 9 — SSE stream primeiro

O artefato de maior impacto e menor risco é o **SSE stream do alwaysAliveAgent**
(`GET /api/copilot/stream`). Ele é:

- Pré-requisito para o REPL CLI (Camada 2)
- Pré-requisito para o `askLLMB()` utilitário do LLM-A
- Já tem padrão estabelecido em `sdk-api.js` (`GET /sessions/:id/stream`)
- ~30 linhas de código + 4 testes unitários

---

_Seção §20 adicionada em 2026-03-22 — v8.0. Design e proposta do terminal efetivo de interação
contínua com LLM-B (Upgrade 9: SSE stream + REPL CLI + npm scripts)._

---

## 21. Arquitetura de Sessão Verdadeiramente Infinita — Análise do SDK, Gaps e Upgrade 10

**Data**: 2026-03-22 (segunda iteração — pós-leitura da documentação oficial) **Estímulo**:
Aprofundamento sobre "conversa contínua" e "sessão infinita" real. **Fontes consultadas**: README
oficial `@github/copilot-sdk v0.1.32`, código de `always-alive.js`, `session-manager.js`.

### 21.1 O que o SDK realmente oferece para sessions infinitas

Após leitura da documentação oficial, ficou claro que o SDK já tem **suporte nativo** a duas
funcionalidades críticas que NÃO estão sendo plenamente exploradas na arquitetura atual:

#### A) InfiniteSessions com compactação automática (JÁ ATIVO, mas silencioso)

O `session-manager.js` já configura
`infiniteSessions: { enabled: true, backgroundCompactionThreshold: 0.75 }`. Isso significa que:

- Quando o contexto atinge 75% do limite da janela, o SDK inicia compactação em background
- A sessão **nunca morre por estouro de contexto** — é compactada silenciosamente
- Um `workspacePath` é criado em `~/.copilot/session-state/{sessionId}/` com checkpoints

**O que NÃO está sendo feito**: os eventos de compactação não são capturados nem emitidos:

```javascript
// Eventos que existem mas não estão sendo subscritos em always-alive.js:
session.on('session.compaction_start', (event) => {
  // event.data contém token counts antes da compactação
});
session.on('session.compaction_complete', (event) => {
  // event.data contém token counts depois da compactação
});
```

Sem esses listeners, o sistema não sabe quando está compactando, não pode alertar o usuário, e não
tem métricas de uso de contexto.

#### B) Streaming de tokens (`assistant.message_delta`) — NÃO CONFIGURADO

O SDK suporta `streaming: true` em `createSession()`, que habilita o evento
`assistant.message_delta` com `deltaContent` — tokens chegando incrementalmente como no ChatGPT web.

**Estado atual**: `always-alive.js` usa `sendAndWait()` **sem streaming** — a resposta só chega
quando o modelo termina completamente. Para conversas longas (análise de código, geração de
arquivos), isso pode significar 30-120 segundos sem nenhum feedback para o usuário.

**Estado ideal**: Com streaming ativo, cada token aparece imediatamente no terminal/interface, como
`process.stdout.write(event.data.deltaContent)`.

#### C) `sendAndWait()` trunca a resposta em 500 chars (BUG ATUAL)

No `always-alive.js` linha 325:

```javascript
this.emit('task.completed', { taskId: task.id, response: text.slice(0, 500) });
```

A resposta emitida via evento e enviada para o cliente HTTP é truncada em 500 chars. O
`task.resolve(text)` recebe o texto completo, mas **o SSE event e o http-bridge recebem apenas os
primeiros 500 caracteres**. Para o "terminal efetivo", isso é um problema grave — respostas longas
chegam cortadas.

### 21.2 Mapa completo de gaps entre o atual e o ideal

| Capacidade                   | SDK suporta? | always-alive.js? | Gap                                        | Impacto                   |
| ---------------------------- | :----------: | :--------------: | ------------------------------------------ | ------------------------- |
| Sessão persistente em disco  |    ✅ sim    |      ✅ sim      | —                                          | —                         |
| Compactação automática       |    ✅ sim    |  ✅ habilitada   | Eventos não capturados, sem métricas       | Médio (visibilidade)      |
| Streaming de tokens          |    ✅ sim    |      ❌ não      | Sem `streaming: true`, sem `message_delta` | **Alto** (UX fatal)       |
| Resposta completa ao cliente |    ✅ sim    | ❌ trunca 500ch  | `text.slice(0, 500)` em task.completed     | **Alto** (dados perdidos) |
| SSE stream global do agente  | ✅ via Node  |  ❌ não existe   | Nenhum endpoint `/api/copilot/stream`      | **Alto** (sem canal push) |
| Eventos de compactação       | ✅ SDK emite | ❌ não subscrito | `session.compaction_start/complete`        | Médio (observabilidade)   |
| `workspacePath` exposto      |    ✅ sim    |  ❌ não exposto  | Campo não retornado em nenhuma rota        | Baixo                     |
| Múltiplos modelos em sessões |    ✅ sim    | ❌ fixo `#model` | Não pode alterar modelo sem nova sessão    | Baixo                     |

### 21.3 Proposta de arquitetura para conversa infinita LLM-A ↔ LLM-B

O cenário ideal é:

```
USUÁRIO humano
     │
     │  (digita: "Analisa os erros TypeScript")
     ▼
[REPL CLI / Terminal Web] ──── POST /api/copilot/send ────►
                                                         AlwaysAliveAgent
                                                              │
     ◄──── SSE `/api/copilot/stream` [assistant.delta] ──── │ (token streaming)
     │   ← token1                                            │
     │   ← token2                                            LLM-B (sessão infinita)
     │   ← token3                                            │
     │   ← ...                                               │
     │   ← [session.compaction_start]                        │ (compacta sem perder contexto)
     │   ← ...                                               │
     │   ← [task.completed]                                  │
     │
     │  (LLM-B pergunta: "Quer que eu corrija?")
     │   ◄ [question.pending] via SSE
     │
     │  (digita: "Sim, corrija")
     ▼
  POST /api/copilot/answer

──────────────────────────────────────────────────────────────────────────────

LLM-A (este agente Copilot)
     │
     │  (decide delegar análise longa para LLM-B)
     ▼
import { askLLMB } from './llm-bridge-client.js';
const result = await askLLMB('Analisa src/kernel/** e lista os 5 maiores bugs', {
    onDelta: (chunk) => process.stdout.write(chunk),  // streaming em tempo real
    onQuestion: (q) => `Continue autonomamente com a melhor opção`,  // resposta automática
});
// result = string completa com análise de LLM-B
```

### 21.4 Redesign do `#processQueue()` para suporte a streaming

Para habilitar streaming real de tokens, o `#processQueue()` deve ser reescrito para:

1. Ativar `streaming: true` na criação da sessão
2. Emitir eventos `task.delta` com cada token recebido
3. Corrigir o truncamento de 500 chars em `task.completed`

**Design proposto** (sem quebrar a API existente — adição de novos eventos):

```javascript
// NOVO: #processQueue() com streaming
#processQueue() {
    if (this.#status !== 'idle' || this.#queue.length === 0 || !this.#session) return;
    const session = this.#session;
    const task = this.#queue.shift();
    if (!task) return;

    this.#setStatus('processing');
    this.emit('task.started', { taskId: task.id });

    void (async () => {
        let accumulator = '';
        let resolvedByDelta = false;

        // Subscreve ao streaming de tokens
        const unsubDelta = session.on('assistant.message_delta', (event) => {
            const chunk = event.data.deltaContent ?? '';
            accumulator += chunk;
            // Emite chunk para clientes SSE em tempo real
            this.emit('task.delta', { taskId: task.id, chunk });
        });

        try {
            const event = await session.sendAndWait({ prompt: task.message });
            const text = event?.data?.content ?? accumulator; // fallback para delta
            unsubDelta();

            this.#setStatus('idle');
            // CORREÇÃO: sem truncamento — resposta completa
            this.emit('task.completed', { taskId: task.id, response: text, responseLen: text.length });
            task.resolve(text);
        } catch (/** @type {any} */ e) {
            unsubDelta();
            this.#setStatus('idle');
            this.emit('task.error', { taskId: task.id, error: e.message });
            task.reject(e);
        } finally {
            this.#processQueue();
        }
    })();
}
```

**Mudanças chave**:

- Novo evento `task.delta` com `{ taskId, chunk }` para streaming
- Remoção do `.slice(0, 500)` em `task.completed`
- Adição de `responseLen` para auditoria sem truncamento

### 21.5 Redesign da criação de sessão para capturar eventos de compactação

Em `session-manager.js`, após criar/retomar a sessão, adicionar listeners para compactação:

```javascript
// APÓS session = await client.createSession(createConfig) ou client.resumeSession():
session.on('session.compaction_start', (event) => {
  log(
    'INFO',
    `[PersistentSession] Compactando contexto... tokens antes: ${event.data?.tokensBefore ?? '?'}`,
  );
  // Emite evento para que AlwaysAliveAgent possa repassar ao stream SSE
  sessionOptions.onCompactionStart?.(event.data);
});
session.on('session.compaction_complete', (event) => {
  log(
    'INFO',
    `[PersistentSession] Compactação completa. tokens depois: ${event.data?.tokensAfter ?? '?'}`,
  );
  sessionOptions.onCompactionComplete?.(event.data);
});
```

E no `always-alive.js`, adicionar handlers:

```javascript
const { session, isResumed } = await initOrResumeSession(this.#client, {
  // ... config atual ...
  onCompactionStart: (data) => this.emit('session.compaction_start', data),
  onCompactionComplete: (data) => this.emit('session.compaction_complete', data),
});
```

### 21.6 Arquitetura completa do SSE stream com streaming de tokens

Com as mudanças propostas, o endpoint `GET /api/copilot/stream` passa a emitir:

```
event: connected
data: {"status":"idle","sessionId":"abc123","ts":1742000000000}

event: task.started
data: {"taskId":"t-001","message":"Analisa src/kernel/"}

event: task.delta
data: {"taskId":"t-001","chunk":"Analisei"}

event: task.delta
data: {"taskId":"t-001","chunk":" os arquivos"}

event: task.delta
data: {"taskId":"t-001","chunk":" em src/kernel/…"}

event: session.compaction_start
data: {"tokensBefore":85000,"threshold":0.75}

event: session.compaction_complete
data: {"tokensAfter":12000,"savedTokens":73000}

event: task.delta
data: {"taskId":"t-001","chunk":"Os principais"}

event: task.completed
data: {"taskId":"t-001","response":"Analisei os arquivos em src/kernel/…Os principais…","responseLen":4382}

event: heartbeat
data: {"ts":1742000015000}
```

Isso permite:

- **Cliente REPL**: `process.stdout.write(chunk)` para simular streaming visual
- **LLM-A**: acumular `chunk`s até `task.completed` para ter resposta completa
- **Frontend**: atualizar UI incrementalmente como ChatGPT web

### 21.7 O `llm-bridge-client.mjs` — utilitário de conversa para LLM-A

Este módulo é o artefato mais importante para **LLM-A conversar com LLM-B de forma contínua**:

```javascript
// src/copilot/llm-bridge-client.mjs
/**
 * Cliente de conversa para LLM-A interagir com LLM-B via http-bridge + SSE.
 *
 * Permite conversas de múltiplos turnos, com streaming, respostas automáticas a perguntas e timeout configurável.
 *
 * @example
 *   // Turno simples
 *   const response = await askLLMB('Analisa src/kernel/**');
 *
 *   // Com opções avançadas
 *   const response = await askLLMB('Lê e corrige os TypeScript errors', {
 *     maxTurns: 10, // Continua até 10 turnos de conversa
 *     autoAnswer: true, // Responde automaticamente a perguntas do modelo
 *     onDelta: process.stdout.write.bind(process.stdout), // Streaming visual
 *     timeoutMs: 300_000, // 5 minutos para tarefas longas
 *   });
 */

const BASE = 'http://localhost:3008/api/copilot';

/**
 * @param {string} message
 * @param {{
 *   maxTurns?: number;
 *   autoAnswer?: boolean;
 *   onDelta?: (chunk: string) => void;
 *   onQuestion?: (q: { question: string; choices?: string[] }) => string | Promise<string>;
 *   timeoutMs?: number;
 *   answeredBy?: 'llm-a' | 'user' | 'system';
 * }} [opts]
 * @returns {Promise<string>}
 */
export async function askLLMB(message, opts = {}) {
  const {
    maxTurns = 1,
    autoAnswer = true,
    onDelta,
    onQuestion,
    timeoutMs = 120_000,
    answeredBy = 'llm-a',
  } = opts;

  // 1. Abre SSE stream antes de enviar mensagem
  const streamRes = await fetch(`${BASE}/stream`);
  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();

  // 2. Envia mensagem
  await fetch(`${BASE}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  // 3. Lê stream até task.completed ou timeout
  let accumulator = '';
  const deadline = Date.now() + timeoutMs;
  let turnsLeft = maxTurns;
  let buffer = '';

  while (Date.now() < deadline && turnsLeft >= 0) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value);
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // última linha pode estar incompleta

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      let event;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }

      // Streaming de token
      if (event.chunk !== undefined && onDelta) {
        onDelta(event.chunk);
        accumulator += event.chunk;
      }

      // Pergunta pendente do modelo
      if (event.question !== undefined) {
        let answer = 'Continue autonomamente.';
        if (onQuestion) {
          answer = await onQuestion({ question: event.question, choices: event.choices });
        } else if (autoAnswer && event.choices?.length > 0) {
          answer = event.choices[0]; // primeiro choice como default
        }
        await fetch(`${BASE}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer, answeredBy }),
        });
        turnsLeft--;
      }

      // Resposta final completa
      if (event.response !== undefined) {
        reader.cancel();
        return event.response || accumulator;
      }

      // Erro
      if (event.error !== undefined) {
        reader.cancel();
        throw new Error(`LLM-B error: ${event.error}`);
      }
    }
  }

  reader.cancel();
  if (accumulator) return accumulator;
  throw new Error(`Timeout de ${timeoutMs}ms aguardando LLM-B`);
}

/**
 * Conversa de múltiplos turnos — envia N mensagens sequencialmente.
 *
 * @param {string[]} messages
 * @param {Parameters<typeof askLLMB>[1]} [opts]
 * @returns {Promise<{ question: string; answer: string }[]>}
 */
export async function converseLLMB(messages, opts = {}) {
  const conversation = [];
  for (const message of messages) {
    const answer = await askLLMB(message, opts);
    conversation.push({ question: message, answer });
  }
  return conversation;
}

/**
 * Delega uma sub-tarefa para LLM-B e aguarda conclusão. Ideal para uso em fluxos autônomos de LLM-A.
 *
 * @param {string} task - Descrição da tarefa para LLM-B
 * @param {string} [context] - Contexto adicional opcional
 * @returns {Promise<string>}
 */
export async function delegateToLLMB(task, context = '') {
  const prompt = context ? `Contexto: ${context}\n\nTarefa: ${task}` : task;
  return askLLMB(prompt, {
    maxTurns: 5,
    autoAnswer: true,
    timeoutMs: 300_000, // 5 minutos
    answeredBy: 'llm-a',
  });
}
```

### 21.8 O REPL CLI com streaming visual

Com o SSE stream e `task.delta`, o REPL CLI se torna muito mais rico:

```javascript
// scripts/copilot-repl.mjs (versão com streaming)
import readline from 'node:readline/promises';

const BASE = 'http://localhost:3008/api/copilot';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// SSE stream para receber eventos em tempo real
async function* sseEvents(url) {
  const res = await fetch(url);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value);
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event:')) continue; // pula linha de evento
      if (!line.startsWith('data:')) continue;
      try {
        yield JSON.parse(line.slice(5).trim());
      } catch {
        /* skip */
      }
    }
  }
}

console.log('\x1b[36m╔══════════════════════════════════════╗');
console.log('║  🤖  Copilot Terminal — LLM-B        ║');
console.log('╚══════════════════════════════════════╝\x1b[0m\n');

const statusRes = await fetch(`${BASE}/status`).then((r) => r.json());
console.log(
  `\x1b[90mStatus: ${statusRes.status} | Session: ${statusRes.sessionId?.slice(0, 12)}...\x1b[0m\n`,
);

// Inicia leitura de stream em background
let questionResolver = null;
(async () => {
  for await (const event of sseEvents(`${BASE}/stream`)) {
    if (event.chunk !== undefined) {
      process.stdout.write('\x1b[32m' + event.chunk + '\x1b[0m');
    }
    if (event.response !== undefined) {
      process.stdout.write('\n\n');
    }
    if (event.question !== undefined) {
      process.stdout.write(`\n\x1b[33m❓ ${event.question}\x1b[0m`);
      if (event.choices?.length) {
        event.choices.forEach((c, i) => process.stdout.write(`\n   [${i + 1}] ${c}`));
      }
      // Sinaliza para o REPL que há uma pergunta aguardando
      questionResolver?.(event);
    }
    if (event.tokensBefore !== undefined) {
      console.log(`\x1b[90m\n[Compactando contexto... ${event.tokensBefore} → aguarde]\x1b[0m`);
    }
    if (event.tokensAfter !== undefined) {
      console.log(`\x1b[90m[Compactação completa. ${event.tokensAfter} tokens no contexto]\x1b[0m`);
    }
  }
})();

while (true) {
  const input = await rl.question('\x1b[34m> \x1b[0m');
  const msg = input.trim();

  if (!msg) continue;
  if (msg === '/quit' || msg === '/q') break;
  if (msg === '/status') {
    const s = await fetch(`${BASE}/status`).then((r) => r.json());
    console.log(JSON.stringify(s, null, 2));
    continue;
  }
  if (msg.startsWith('/answer ')) {
    await fetch(`${BASE}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: msg.slice(8), answeredBy: 'user' }),
    });
    continue;
  }

  await fetch(`${BASE}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg }),
  });
}

rl.close();
console.log('\x1b[90m[Terminal encerrado]\x1b[0m');
```

### 21.9 Tabela de implementação do Upgrade 10 — Sessão Infinita + Terminal Completo

| Item                               | Arquivo                                  | Esforço  | Testes   | Prioridade |
| ---------------------------------- | ---------------------------------------- | -------- | -------- | ---------- |
| Corrigir truncamento 500ch         | `always-alive.js` linha ~325             | 30min    | 1 teste  | 🔴 CRÍTICO |
| Adicionar `task.delta` (streaming) | `always-alive.js` #processQueue          | 2h       | 3 testes | 🔴 CRÍTICO |
| Evento compactação em always-alive | `always-alive.js` + `session-manager.js` | 1h       | 2 testes | 🟡 MÉDIO   |
| SSE `/stream` em http-bridge       | `http-bridge.js`                         | 2h       | 4 testes | 🔴 CRÍTICO |
| `llm-bridge-client.mjs`            | `src/copilot/llm-bridge-client.mjs`      | 3h       | 4 testes | 🔴 CRÍTICO |
| REPL CLI com streaming visual      | `scripts/copilot-repl.mjs`               | 2h       | Manual   | 🟡 MÉDIO   |
| npm scripts `copilot:*`            | `package.json`                           | 20min    | 0        | 🟢 BAIXO   |
| `workspacePath` em GET /session    | `http-bridge.js`                         | 20min    | 1 teste  | 🟢 BAIXO   |
| **Total Upgrade 10**               |                                          | **~11h** | **~15**  |            |

### 21.10 Sequência de implementação recomendada (ordem de impacto)

```
Sprint 1 (crítico, ~3h):
  1. Corrigir truncamento 500ch em always-alive.js         ← 30min
  2. Adicionar evento task.delta ao #processQueue          ← 2h
  3. 4 testes unitários                                    ← 30min

Sprint 2 (terminal funcional, ~4h):
  4. SSE /stream em http-bridge.js                        ← 2h
  5. 4 testes unitários do SSE                            ← 1h
  6. Testar manualmente: curl -N .../stream               ← 1h

Sprint 3 (llm-bridge-client, ~4h):
  7. src/copilot/llm-bridge-client.mjs                    ← 3h
  8. 4 testes unitários                                    ← 1h

Sprint 4 (UX completo, ~2h):
  9. scripts/copilot-repl.mjs                             ← 1.5h
 10. npm scripts copilot:*                                 ← 20min
 11. workspacePath em GET /session                         ← 20min
```

### 21.11 Reflexão final — "sessão infinita" é mais que contexto: é continuidade de conversação

A verdadeira sessão infinita com LLM-B não é apenas "não estoura a janela de contexto" (isso o SDK
já resolve com `infiniteSessions`). É:

1. **Continuidade de identidade**: LLM-B sempre sabe quem é, qual o projeto, qual o estado atual —
   via `systemMessage` injetado com `injectHookContext: true`
2. **Continuidade de memória**: Os `checkpoints/` em `workspacePath` contêm o histórico compactado —
   LLM-B pode ser "relembrada" do que fez antes via `/ler checkpoints/`
3. **Continuidade de contexto técnico**: A sessão resume exatamente de onde parou — arquivos
   modificados, erros conhecidos, tarefas pendentes — tudo persiste em disco
4. **Continuidade de interação**: O SSE stream + REPL CLI garantem que **já conversa intermediária**
   não é perdida — LLM-A ou o usuário pode retomar do ponto exato
5. **Continuidade semântica da conversa**: LLM-B não "esquece" — a compactação resume, não apaga. O
   modelo pode ser perguntado "O que você fez antes?" e responderá com base no checkpoint compactado

Para LLM-A (este agente), a "sessão infinita com LLM-B" significa:

- Poder **delegar subtarefas longas** (`delegateToLLMB(task)`) sem timeout
- Poder **monitorar progresso** via stream (`task.delta`)
- Poder **responder perguntas automaticamente** (`autoAnswer: true`)
- Poder **conversar em múltiplos turnos** (`converseLLMB([...])`)
- Saber quando a sessão está **compactando** para não enviar novas mensagens durante o processo

---

_Seção §21 adicionada em 2026-03-22 — v9.0. Análise profunda dos gaps entre SDK 0.1.32 e
implementação atual; proposta completa de Upgrade 10 (streaming + SSE + llm-bridge-client + REPL
CLI) para sessão verdadeiramente infinita e terminal efetivo LLM-A↔LLM-B._

---

## 22. Sprints 7–9: Shutdown Gracioso, Health Check e Dialog Loop (2026)

_Adicionado em 2026-03-23 — v10.0. Documentação das implementações de produção dos Sprints 7, 8 e 9:
graceful shutdown, health check endpoint e o arquiteturalmente central Dialog Loop (padrão §15.8 em
produção)._

---

### 22.1 Sprint 7 — Graceful Shutdown com Drenagem de Fila

**Problema:** O `AlwaysAliveAgent` não tinha encerramento controlado. Ao receber sinal de parada
(`/stop`), mensagens em processamento eram descartadas silenciosamente.

**Solução implementada em `src/copilot/always-alive.js`:**

```javascript
async stop() {
    if (this.#status === 'stopped') return;
    this.#setStatus('stopping');

    // 1. Aguarda task em andamento finalizar (timeout: 30s)
    if (this.#inFlightTask) {
        await Promise.race([
            this.#inFlightTask,
            new Promise(r => setTimeout(r, 30_000))
        ]);
    }

    // 2. Drena a fila (rejeita tarefas pendentes com erro cancelamento)
    for (const pending of this.#queue) {
        pending.reject(new Error('Agent stopping — task cancelled'));
    }
    this.#queue.length = 0;

    // 3. Limpa estado e emite evento
    this.#setStatus('stopped');
    this.emit('stopped');
}
```

**Garantias:**

- Task in-flight recebe no máximo 30s para concluir antes do force-stop
- Fila pendente é drenada com rejeição limpa (sem perda silenciosa)
- Idempotente: múltiplas chamadas a `stop()` são seguras

**Testes:** 13 testes unitários em `test_always_alive_graceful_shutdown.spec.js`

---

### 22.2 Sprint 8 — MAX_QUEUE_SIZE e Endpoint `/health`

#### MAX_QUEUE_SIZE

Limite estático de 100 mensagens na fila para prevenir acúmulo ilimitado de memória:

```javascript
static MAX_QUEUE_SIZE = 100;

sendMessage(content) {
    if (this.#queue.length >= AlwaysAliveAgent.MAX_QUEUE_SIZE) {
        return Promise.reject(new Error('Queue full (MAX_QUEUE_SIZE=100)'));
    }
    // ... enfileira normalmente
}
```

**Comportamento:** Rejeita imediatamente com erro descritivo quando fila cheia. O caller é
responsável por backpressure (retry com espera).

#### Endpoint `GET /health`

Endpoint padronizado para probes de liveness/readiness:

```javascript
// GET /health — 200 (healthy) | 503 (unhealthy)
bridge.get('/health', (_req, res) => {
  const status = alwaysAliveAgent.getStatus();
  const healthy = status === 'idle' || status === 'processing';
  res.status(healthy ? 200 : 503).json({
    healthy,
    status,
    sessionId: alwaysAliveAgent.getSessionId() ?? null,
    queueSize: alwaysAliveAgent.getQueueSize(),
    starvationAlert: alwaysAliveAgent.isStarvationAlert(),
    uptime: alwaysAliveAgent.getUptime() ?? null,
  });
});
```

**Semântica:**

- `200`: agent `idle` ou `processing` — apto a receber mensagens
- `503`: agent `stopped`, `starting` ou `stopping` — não pronto
- Campos extras permitem dashboards de monitoramento sem polling `/status`

**Testes:** 11 testes unitários em `test_http_bridge.spec.js` (seção health)

---

### 22.3 Sprint 9 — Dialog Loop: Conversa Multi-Turno com Zero PRs Adicionais

Esta é a implementação mais arquiteturalmente significativa das três: o **Dialog Loop** resolve o
problema fundamental de interação LLM-A↔LLM-B de forma eficiente em PRs.

#### 22.3.1 O Problema: Custo de PR por Turno

Na arquitetura anterior, cada mensagem enviada à LLM-B consumia **1 PR (Pull Request)** do GitHub
Copilot:

```
LLM-A: sendMessage("Quais arquivos você modificou?")  → 1 PR usado
LLM-A: sendMessage("E os testes?")                    → 1 PR usado
LLM-A: sendMessage("Pode fazer isso diferente?")      → 1 PR usado
```

Para 50 turnos de conversa: **50 PRs consumidos**.

#### 22.3.2 A Solução: Protocolo ask_user em Loop Infinito

Baseado no padrão §15 (Arquitetura 'Sessão Suspensa'), a LLM-B pode entrar em um loop infinito de
`ask_user()` que consome **1 único PR** para toda a sessão de diálogo:

```javascript
// Boot prompt enviado à LLM-B (1 PR total)
const bootPrompt = `
Você é um assistente interativo. Execute este loop infinito:

while True:
    resposta = ask_user("READY: Aguardando pergunta do usuário")
    if resposta == "STOP_DIALOG": break
    processamento = [sua análise aqui]
    ask_user("REPLY: " + processamento)

Inicie o loop agora.
`;
```

**Cada `ask_user()` invocado pela LLM-B é interceptado pelo handler `#handleUserInputRequest`**, que
funciona como ponte entre o loop da LLM-B e o código Node.js do caller.

#### 22.3.3 Protocolo de Sinalização

O Dialog Loop usa um protocolo de mensagens estruturadas via `ask_user`:

| Prefixo da pergunta | Significado                                        | Ação do handler                                    |
| ------------------- | -------------------------------------------------- | -------------------------------------------------- |
| `READY:`            | LLM-B sinalizou que está pronta para receber input | Emite `dialog.ready`, aguarda `sendDialogTurn()`   |
| `REPLY: {texto}`    | LLM-B enviou uma resposta ao último turno          | Emite `dialog.reply`, extrai texto após `REPLY:`   |
| `STOP_DIALOG`       | Confirmação de encerramento                        | Emite `dialog.stopped`, retorna `{ answer: 'OK' }` |

#### 22.3.4 Implementação: `#handleUserInputRequest` Modificado

```javascript
async #handleUserInputRequest({ question, choices, allowFreeform }) {
    // MODO DIÁLOGO: intercepta padrões especiais
    if (this.#dialogLoopActive) {
        if (question.startsWith('READY')) {
            this.emit('dialog.ready', {});
            // Armazena resolve para sendDialogTurn() usar
            return new Promise(resolve => {
                this.#pendingQuestion = { resolve, choices, allowFreeform };
            });
        }

        if (question.startsWith('REPLY:')) {
            const reply = question.slice(6).trim();
            this.emit('dialog.reply', { reply });
            return new Promise(resolve => {
                this.#pendingQuestion = { resolve, choices, allowFreeform };
            });
        }

        if (question.startsWith('STOP_DIALOG')) {
            this.emit('dialog.stopped', {});
            this.#dialogLoopActive = false;
            return { answer: 'OK', wasFreeform: false };
        }
    }

    // MODO PADRÃO: expõe via HTTP Bridge
    // ...
}
```

#### 22.3.5 API Pública do Dialog Loop

**`startDialogLoop(bootPrompt): Promise<void>`**

Inicia o loop infinito na LLM-B. Retorna quando LLM-B sinaliza `READY:` pela primeira vez.

```javascript
agent.on('dialog.ready', ({ reply }) => {
  console.log('LLM-B pronta:', reply);
});

await agent.startDialogLoop(`
    Execute um loop infinito: a cada iteração, chame ask_user("READY: aguardando")
    e, após receber a mensagem, responda com ask_user("REPLY: " + suaResposta).
    Se receber "STOP_DIALOG", encerre.
`);
// Neste ponto: 1 PR usado, LLM-B aguardando no primeiro ask_user()
```

**`sendDialogTurn(message, { timeout }): Promise<string>`**

Envia uma mensagem ao loop e aguarda a resposta (REPLY):

```javascript
const reply = await agent.sendDialogTurn('Qual é a capital do Brasil?', { timeout: 30_000 });
console.log(reply); // "A capital do Brasil é Brasília."
// PRs usados: ainda apenas 1 (o boot prompt)
```

**`stopDialogLoop(): Promise<void>`**

Encerra o loop enviando `STOP_DIALOG` ao `ask_user` pendente:

```javascript
await agent.stopDialogLoop();
// LLM-B break do while loop, PR encerrado normalmente
```

#### 22.3.6 Integração com LlmBridgeClient

```javascript
// src/copilot/llm-bridge-client.js
const client = new LlmBridgeClient(alwaysAliveAgent);

await client.startDialogMode(bootPrompt, {
  onReady: (msg) => console.log('[READY]', msg),
  onReply: (reply) => console.log('[LLM-B]', reply),
  onDone: () => console.log('[DONE] Loop encerrado'),
});

const r1 = await client.dialogTurn('Olá!'); // → "Olá! Como posso ajudar?"
const r2 = await client.dialogTurn('Qual hora é?'); // → "Não tenho acesso ao relógio..."
await client.stopDialogMode();
```

#### 22.3.7 HTTP Routes para Dialog Loop

Rotas adicionadas ao `src/copilot/http-bridge.js`:

```
POST /api/copilot/dialog/start  — Inicia dialog loop com bootPrompt
POST /api/copilot/dialog/turn   — Envia turno, aguarda reply
POST /api/copilot/dialog/stop   — Encerra loop
```

**POST /dialog/start:**

```json
// Request:
{ "bootPrompt": "string — instruções para LLM-B" }

// Response 200:
{ "ok": true, "message": "Modo diálogo ativo. Use POST /dialog/turn para interagir." }

// Response 400 (bootPrompt ausente):
{ "ok": false, "error": "Campo \"bootPrompt\" (string) é obrigatório." }

// Response 409 (loop já ativo):
{ "ok": false, "error": "Dialog loop já está ativo." }
```

**POST /dialog/turn:**

```json
// Request:
{ "message": "string", "timeoutMs": 60000 }

// Response 200:
{ "ok": true, "reply": "string — resposta da LLM-B" }

// Response 400 (message ausente):
{ "ok": false, "error": "Campo \"message\" (string) é obrigatório." }

// Response 503 (timeout ou loop não ativo):
{ "ok": false, "error": "Dialog turn timeout after 60000ms" }
```

**POST /dialog/stop:**

```json
// Response 200:
{ "ok": true, "message": "Modo diálogo encerrado." }
```

#### 22.3.8 Eventos SSE para Dialog Loop

O stream SSE (`GET /stream`) transmite eventos em tempo real do dialog loop:

```javascript
const AGENT_EVENTS = [
  // ... eventos existentes ...
  'dialog.ready', // LLM-B sinalizou pronta (após startDialogLoop)
  'dialog.reply', // LLM-B enviou reply (após sendDialogTurn)
  'dialog.stopped', // Loop encerrado (após stopDialogLoop)
];
```

**Payload dos eventos:**

```json
// dialog.ready
{ "type": "dialog.ready" }

// dialog.reply
{ "type": "dialog.reply", "reply": "texto da resposta da LLM-B" }

// dialog.stopped
{ "type": "dialog.stopped" }
```

#### 22.3.9 Prova de Eficiência: E2E com 5 Turnos em 1 PR

Teste E2E realizado confirmou o funcionamento:

```
Session: 840d18bb-... (1 PR total)

Boot prompt → LLM-B inicia loop while True
  → ask_user("READY: Pronto.") ← interceptado → dialog.ready

sendDialogTurn("Olá, tudo bem?")
  → ask_user("REPLY: Tudo ótimo! Como posso ajudar?") ← dialog.reply

sendDialogTurn("Qual é a sua função?")
  → ask_user("REPLY: Sou um assistente...") ← dialog.reply

sendDialogTurn("Entendido. Pode descrever X?")
  → ask_user("REPLY: Claro! X significa...") ← dialog.reply

sendDialogTurn("Ótimo. Uma última pergunta...")
  → ask_user("REPLY: Com prazer...") ← dialog.reply

stopDialogLoop()
  → answerPendingQuestion("STOP_DIALOG")
  → LLM-B break ← dialog.stopped

PRs consumidos: 1 (apenas o boot prompt)
Turnos de conversa: 5
Economia: ~80% vs método anterior (5 PRs)
```

#### 22.3.10 Cobertura de Testes

| Arquivo                                 | Testes | Cobertura                                                                                               |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `test_always_alive_dialog_loop.spec.js` | 23     | startDialogLoop, sendDialogTurn, stopDialogLoop, interceptação READY/REPLY/STOP_DIALOG, timeout, guards |
| `test_http_bridge_dialog.spec.js`       | 22     | POST /dialog/\*, validação 400, error handling 503, SSE events                                          |
| **Total Sprint 9**                      | **45** | —                                                                                                       |

---

### 22.4 Evolução da Contagem de Testes

| Sprint                                        | Incremento | Total    |
| --------------------------------------------- | ---------- | -------- |
| Base (pré-sessão)                             | —          | 903      |
| Sprints 1–6 (streaming, diagnostics, backoff) | +79        | 982      |
| Sprint 7 (graceful shutdown)                  | +12        | 994      |
| Sprint 8 (MAX_QUEUE_SIZE + /health)           | +24        | 1018     |
| Sprint 9a (dialog loop — always-alive)        | +23        | 1041     |
| Sprint 9b (http routes dialog)                | +19        | 1060     |
| Sprint 9c (SSE dialog events)                 | +3         | **1063** |

---

### 22.5 Diagrama de Fluxo Completo do Dialog Loop

```
LLM-A (Node.js)               AlwaysAliveAgent          LLM-B (Copilot)
      │                               │                        │
      │  startDialogLoop(boot)        │                        │
      │──────────────────────────────▶│                        │
      │                               │  sendMessage(boot) → 1 PR
      │                               │───────────────────────▶│
      │                               │                        │ [while True:]
      │                               │                        │ ask_user("READY: ...")
      │                               │◀───────────────────────│
      │                               │ emit('dialog.ready')   │
      │◀─────────────────────────────│                        │
      │ [Promise resolvida]            │                        │
      │                               │                        │
      │  sendDialogTurn("Olá")        │                        │
      │──────────────────────────────▶│                        │
      │                               │ answerPendingQuestion  │
      │                               │───────────────────────▶│
      │                               │                        │ [processa "Olá"]
      │                               │                        │ ask_user("REPLY: Olá!")
      │                               │◀───────────────────────│
      │                               │ emit('dialog.reply')   │
      │◀─────────────────────────────│                        │
      │ reply: "Olá!"                 │                        │
      │                               │                        │
      │  stopDialogLoop()             │                        │
      │──────────────────────────────▶│                        │
      │                               │ answer("STOP_DIALOG")  │
      │                               │───────────────────────▶│
      │                               │                        │ [break]
      │                               │ emit('dialog.stopped') │
      │◀─────────────────────────────│                        │
```

---

_Seção §22 adicionada em 2026-03-23 — v10.0. Sprints 7–9 documentados: graceful shutdown com
drenagem de fila, MAX_QUEUE_SIZE + /health endpoint, e Dialog Loop (padrão §15.8) com zero PRs
adicionais por turno. 1063 testes, E2E validado._

---

## 23. Sprint 10 — Arquitetura de Lib Completa: `src/copilot/lib/`

> **Data**: 2026-07-15 **Versão**: v11.0 **Contexto**: Após investigação profunda da API do SDK
> v0.1.32 atualmente instalado, identificamos que a arquitetura atual mistura lógica de negócio nos
> pontos de entrada. Esta seção documenta a migração para uma camada de lib pura — similar ao padrão
> do hook system.

### 23.1 Diagnóstico: Gap Atual

A estrutura atual tem dois problemas fundamentais:

1. **Sem separação lib/app**: `always-alive.js` (757 linhas) carrega ao mesmo tempo a abstração de
   dialog loop E a lógica concreta do agente. `sdk-api.js` (587 linhas) faz operações de domínio
   diretamente nos handlers Express.

2. **APIs do SDK não cobertas** (lista dos gaps identificados via inspeção do `types.d.ts`):

| Campo/Método SDK                      | Disponível desde | Status no projeto                 |
| ------------------------------------- | ---------------- | --------------------------------- |
| `CopilotClientOptions.cliUrl`         | v0.1.x           | ❌ não usado                      |
| `SessionConfig.sessionId?`            | v0.1.x           | ❌ não usado                      |
| `SessionConfig.clientName?`           | v0.1.x           | ❌ não usado                      |
| `SessionConfig.reasoningEffort?`      | v0.1.x           | ❌ não usado                      |
| `SessionConfig.configDir?`            | v0.1.x           | ❌ não usado                      |
| `SessionConfig.availableTools?`       | v0.1.x           | ❌ não usado                      |
| `SessionConfig.excludedTools?`        | v0.1.x           | ❌ não usado                      |
| `SessionConfig.provider?` (BYOK)      | v0.1.x           | ❌ não usado                      |
| `SessionConfig.hooks?` (SessionHooks) | v0.1.x           | ❌ **zero cobertura**             |
| `SessionConfig.workingDirectory?`     | v0.1.x           | ❌ não usado                      |
| `SessionConfig.mcpServers?`           | v0.1.x           | ❌ não usado                      |
| `SessionConfig.customAgents?`         | v0.1.x           | ❌ não usado                      |
| `client.deleteSession(id)`            | v0.1.x           | ❌ sem rota REST                  |
| `session.registerTools(tools?)`       | v0.1.x           | ❌ hot-reload não impl            |
| `onPreToolUse` / `onPostToolUse`      | v0.1.x           | ❌ desconectado do hook system    |
| `onUserPromptSubmitted`               | v0.1.x           | ❌ injection de contexto não impl |
| `onSessionStart/End/Error`            | v0.1.x           | ❌ sem telemetria SDK             |

### 23.2 Estrutura da Lib Proposta

```
src/copilot/lib/
├── client.js          # CopilotClient singleton + lifecycle (extrai de sdk-client.js)
├── session.js         # createSession / resumeSession / lifecycle (extrai session-manager.js)
├── permissions.js     # PermissionHandler granular — substitui approveAll hardcoded (NOVO)
├── hooks.js           # SessionHooks builders (Sprint 11 — NOVO)
├── providers.js       # BYOK factory — Ollama, Azure, OpenAI custom (Sprint 12 — NOVO)
├── mcp.js             # MCPServerConfig builders — local (stdio) e remote (Sprint 12 — NOVO)
├── agents.js          # CustomAgentConfig builders (Sprint 13 — NOVO)
├── models.js          # listModels, routing, reasoningEffort helpers (Sprint 13 — NOVO)
├── tools-registry.js  # ToolRegistry dinâmico + hot-reload (Sprint 14 — NOVO)
├── telemetry.js       # Session lifecycle → NERV events (Sprint 14 — NOVO)
└── index.js           # Barrel de re-exportação
```

### 23.3 Regras arquiteturais da camada `/lib`

1. **Puro, sem side effects no import**: Sem singletons auto-inicializados, sem `log()` no nível do
   módulo, sem bootstrap automático.
2. **Factory functions** (não classes), salvo quando estado interno é necessário (`ToolRegistry`).
3. **Tipagem JSDoc total** com referências a `@github/copilot-sdk` types.
4. **Zero `execSync`/`curl`** — usar `fetch()` nativo do Node.js 24.
5. **Aliases `#copilot/lib/*`** adicionados ao `package.json` imports e `tsconfig.json` paths.
6. **Backward compatible**: `sdk-client.js` e `session-manager.js` continuam exportando as mesmas
   assinaturas (delegam para a lib).
7. **Cada arquivo de lib** tem arquivo de test correspondente em `tests/unit/copilot/`.

### 23.4 Sprint 10 — Descrição Completa

**Objetivo**: Implementar `lib/client.js`, `lib/session.js`, `lib/permissions.js` + padrão `cliUrl`
(CLI como processo PM2 separado — §16.5).

#### 23.4.1 `lib/client.js`

Responsabilidades:

- Singleton `CopilotClient` com suporte a `cliUrl` (conecta a CLI já em execução)
- `getClient(options?)` — cria ou retorna instância conectada
- `stopClient()` — encerramento gracioso com cleanup de sessões
- `forceStopClient()` — encerramento de emergência
- Registry em memória de sessões ativas: `Map<sessionId, SessionEntry>`
- `registerSessionLifecycleHandler(handler)` — escuta eventos de lifecycle
- `getClientState()` — status da conexão atual
- `incrementMessageCount(sessionId)` — contador de mensagens enviadas
- Suporte a `cliUrl` via env `COPILOT_CLI_URL` (PM2: CLI process separado)

#### 23.4.2 `lib/session.js`

Responsabilidades:

- `createManagedSession(client, options)` — cria sessão com injeção de contexto + persiste ID em
  disco
- `resumeManagedSession(client, sessionId, options)` — retoma sessão preservando state
- `initOrResumeManagedSession(client, options)` — tenta resumir, cria se falhar (fluxo canônico)
- `listAllSessions(client)` — integra disco + memória
- `deleteManagedSession(client, sessionId)` — remove de disco + registry
- `buildSystemMessage(options)` — factory de `systemMessage` com seções tipadas
- State persistence: `readState()`, `writeState(updates)`, `clearState()`
- Context injection: lê `session-briefing.md` + `session.json` para injetar no `systemMessage`

#### 23.4.3 `lib/permissions.js`

Responsabilidades:

- `createPermissionHandler(config)` → `PermissionHandler`:
  - `allowAll` — equivalente ao `approveAll` atual
  - `allowTools: string[]` — whitelist por nome de tool
  - `denyTools: string[]` — blacklist por nome
  - `denyPatterns: RegExp[]` — deny por regex no nome da tool
  - `onRequest?: (req) => Promise<bool | 'deny-and-log'>` — override callback
  - `auditMode: boolean` — aprova tudo mas loga cada permission request
- `createAuditOnlyPermission()` — helper: aprova tudo, loga tudo
- `createRestrictedPermission(allowedTools)` — helper: whitelist rígida

#### 23.4.4 Padrão `cliUrl` (Zero-Restart-Cost — §16.5)

```
PM2 gerencia dois processos:
  1. copilot --headless --port 4321      ← CLI persistente
  2. node src/copilot/agent.js           ← SDK conecta via cliUrl

Se SDK reiniciar: CLI continua vivo → SDK reconecta → 0 PRs adicionais
Se PC reiniciar: CLI reinicia → 1 PR para reboot do loop
```

Configuração via env `COPILOT_CLI_URL=localhost:4321`. Quando presente, `lib/client.js` passa
`{ cliUrl: process.env.COPILOT_CLI_URL }` ao construtor do `CopilotClient`.

### 23.5 Roadmap Sprint 10–15

| Sprint | Meta                                                       | Testes (acumulado) |
| ------ | ---------------------------------------------------------- | ------------------ |
| **10** | `lib/client`, `lib/session`, `lib/permissions`, cliUrl     | ~1123              |
| **11** | `lib/hooks.js` — SessionHooks completo + prompt injection  | ~1173              |
| **12** | `lib/providers.js`, `lib/mcp.js`, refactor mcp-tool-bridge | ~1228              |
| **13** | `lib/agents.js`, `lib/models.js`, reasoningEffort          | ~1273              |
| **14** | `lib/telemetry.js`, `lib/tools-registry.js`, hot-reload    | ~1323              |
| **15** | §24 doc, refator entrypoints finais, aliases completos     | ~1353              |

---

_Seção §23 adicionada em 2026-07-15 — v11.0. Diagnóstico de gaps API SDK v0.1.32, estrutura lib/
planejada, Sprint 10–15 roadmap. Decisão: cliUrl (§16.5) incluído no Sprint 10; BYOK Ollama opcional
(não padrão)._
