# Arquitetura: Assistentes (OpenCode/Copilot/Codex/Claude) + LLM Services (Ollama/Claude/etc)

## Objetivo

Integrar **Ollama + OpenCode** e múltiplos assistentes (Copilot, Codex CLI, Claude, etc.) em duas
frentes:

1. **Processo de programação (Dev Toolchain)**: acelerar engenharia com contexto, comandos
   padronizados e governança.
2. **Possibilidades do programa (Runtime)**: adicionar capacidades de LLM via API (ex.: judge,
   triage, sumarização), **sem substituir** o núcleo **Puppeteer → browser** (atuador base).

> Nota importante de realidade: **Claude não roda via Ollama**. “Ollama + Claude” normalmente
> significa “usar Ollama para modelos locais” **e** “usar Claude via Anthropic API” no mesmo
> toolchain/router, com políticas de quando cada um entra.

---

## Princípios arquiteturais (do repo + extensão)

### P0 — Puppeteer/browser é o atuador soberano

- O sistema continua “**connect-only**” (Chrome externo, DevContainer apenas conecta).
- Drivers UI (`src/driver/targets/*Driver.js`) seguem sendo a base do “fazer acontecer” no mundo
  real (DOM/biomecânica/SADI).

### P1 — LLM por API entra como _serviço auxiliar_, não como substituto

LLMs via API devem:

- **julgar/validar** saída (LLM-as-judge),
- **classificar** (triage),
- **resumir** e **normalizar**,
- **planejar** (gerar planos/estratégias),
- **avaliar risco/qualidade**, …mas não “tomar o lugar” do browser, a menos que uma task seja
  explicitamente do tipo “API-only”.

### P2 — Toolchain de dev é multi-assistente, mas com “contrato único”

Copilot, OpenCode, Codex CLI, Claude Code, etc. devem operar em cima de:

- uma **memória do projeto** (ex.: `OpenCode.md`),
- **comandos padronizados** (ex.: `.opencode/commands/*` + `npm run ...`),
- uma **governança de dados** (o que pode/ não pode sair da máquina),
- e (idealmente) uma camada de interoperabilidade (MCP).

---

## Plano A (Recomendado): Arquitetura em 3 camadas

### 1) Runtime Plane (programa)

Camada onde o agente roda.

**Componentes já existentes**

- **Kernel/NERV/Orchestrator**: coordenação e decisão.
- **ConnectionOrchestrator + Drivers UI**: conexão e atuação em páginas.

**Componentes a adicionar (sem quebrar o núcleo)**

1. **`LLMService` (porta única)**  
   Uma API interna (módulo) com interface pequena, ex.:
   - `generateText({ provider, model, messages, jsonSchema?, temperature?, timeoutMs? })`
   - `judgeJson({ prompt, response, rubric })`
   - `classify({ input, labels })`
   - `interpret({ input, goal, schema?, constraints? })` (normalização/extração)

2. **Providers (plugins)**
   - `ollama` (OpenAI-compatible, local/host)
   - `anthropic` (Claude via API)
   - `openai` (se aplicável)
   - “mock” (tests)

3. **Policy/Budget/Governance**
   - roteamento por **tipo de tarefa**, **sensibilidade**, **custo**, **latência**,
     **disponibilidade**
   - redaction/allowlist de dados antes de enviar para cloud
   - fallback determinístico (ex.: Ollama → OpenAI → Claude, ou inverso)

4. **Observabilidade**
   - eventos NERV: `llm.request`, `llm.response`, `llm.error`, `llm.fallback`
   - métricas: latência, taxa de erro, custo estimado, tokens

#### Pipeline dinâmico: “Global responde, Local interpreta e valida”

O objetivo aqui é exatamente o que você descreveu: **uma LLM local participa da validação e da
interpretação da resposta de uma LLM global**, sem substituir o atuador Puppeteer.

Pense em dois produtos de saída:

1. **Resposta “humana”** (texto final para usuário / relatório / dashboard)
2. **Resposta “operável”** (JSON normalizado para o Kernel/Orchestrator, com decisão e evidências)

Para isso, a arquitetura deve separar claramente:

- **Geração** (global/local),
- **Interpretação/Normalização** (preferencialmente local),
- **Validação** (determinística + LLM-as-judge local + LLM-as-judge global opcional),
- **Arbitragem** (decidir ACCEPT/RETRY/MANUAL_REVIEW),
- **Feedback loop** (pedir correção à global com critique da local),
- **Registro de artefatos** (para auditoria e aprendizado).

##### Fluxo (alto nível)

1. Driver UI (Puppeteer) executa a tarefa e extrai texto bruto (`rawText`) + artefatos (HTML/DOM
   snapshot parcial, selectors usados, status, timings).
2. **Interpretação local (Ollama)** converte `rawText` em **estrutura** (ex.: `ResponseV2`),
   aplicando schema e normalizando campos.
3. **Checks determinísticos** rodam em cima da estrutura (Zod, invariantes, consistência, regex,
   limites).
4. **Judge local (Ollama)** avalia qualidade (com rubrica) e gera critique/feedback em JSON.
5. **Judge global (Claude/OpenAI)** é opcional: entra como “second opinion” quando:
   - a local está incerta,
   - houve falha nos checks,
   - ou a tarefa é crítica (L1/L2 com políticas específicas).
6. **Arbitragem** consolida (determinístico + local + global) e decide:
   - `ACCEPT` (prossegue),
   - `RETRY` (pede correção),
   - `MANUAL_REVIEW` (intervenção humana/dash).
7. Se `RETRY`, a **global** recebe um prompt de reparo com:
   - evidências dos checks,
   - critique do judge local,
   - e instruções para retornar no schema exigido.
8. O sistema registra tudo (de forma governada) e aprende (ver seção “Loop de aprendizado”).

##### Objetos canônicos (contratos)

Para não virar “string soup”, formalize 3 contratos (objetos) no runtime:

1. `LLMRequest`
   - `purpose`: `interpret | judge | classify | plan | summarize | repair`
   - `dataClass`: `L0 | L1 | L2`
   - `allowCloud`: boolean (governança)
   - `modelHint`: string opcional
   - `timeoutMs`, `maxTokens`, `temperature`
   - `traceId` / `correlationId`

2. `ValidationReport`
   - `deterministic`: `{ passed, failures[] }`
   - `localJudge`: `{ score, verdict, reasoning, confidence, critique? }`
   - `globalJudge?`: `{ score, verdict, reasoning, confidence }`
   - `arbitration`: `{ decision, overallScore, reasons[], nextAction? }`
   - `repairPrompt?`: string (quando `decision=RETRY`)

3. `InterpretedResponse`
   - `schemaVersion`
   - `content`: `{ text, sections?, citations?, extractedEntities? }`
   - `actions?`: lista de ações propostas (sem executar) para o Orchestrator
   - `confidence`
   - `evidence`: links internos para artefatos (selectors, snapshots, etc.)

##### Arbitragem (como decidir sem “religião”)

Regras práticas (simples e eficientes):

- Se **determinístico falhar** em invariantes críticos → `RETRY` (sem discutir).
- Se determinístico passar e `localJudge.score >= T_accept` → `ACCEPT`.
- Se local incerta (`confidence` baixa) → chamar `globalJudge` e reavaliar.
- Se local e global divergem muito → `MANUAL_REVIEW` (ou `RETRY` com prompt mais restritivo).

O que torna isso “dinâmico” é que a política pode ser adaptativa:

- Tarefas L0 (públicas): cloud ok, mais “qualidade”.
- Tarefas L1: local preferencial, cloud apenas com redaction.
- Tarefas L2: só local + determinístico; se incerto, parar e pedir humano.

**Onde isso encaixa imediatamente neste repo (alto ROI)**

- `src/validation/llm_judge.js` já existe, mas precisa de um “driver” API (não UI).
- Use cases incrementais:
  - Judge de respostas de UI (barato/local).
  - Triage de falhas (CAPTCHA/limit/login) para escolher remediação.
  - Normalização/extração de resposta para schema.

### 2) Dev Plane (processo de programação)

Camada onde o time programa.

**Alvos**

- Ter **um workflow reproduzível**: “qualquer assistente consegue rodar as mesmas rotinas”.
- Reduzir “alucinação operacional”: comandos reais, resultados reais.

**Padrão recomendado**

- Tudo que é ação vira comando versionado do repo:
  - `npm run validate:all`, `npm run analyze:graph`, `npm run check:chrome`, etc.
- OpenCode ganha comandos por prompt:
  - `.opencode/commands/validate.md`, `.opencode/commands/triage-chrome.md`.
- Copilot/Codex/Claude passam a ser “interfaces” para o mesmo conjunto de ações.

#### Toolchain “dinâmico” (multi-assistente, com governança)

Se o objetivo é “integrar tudo”, a chave é **não acoplar ao UI do assistente** e sim a um conjunto
de contratos e rotinas do repo:

1. **Memória única do projeto**
   - `OpenCode.md` é um bom início; idealmente, também existirão:
     - `assistant/` (políticas, runbooks de contribuição, limites de autonomia),
     - `.github/*` (instruções para Copilot/PR templates),
     - `.vscode/*` (tasks e debug padronizados).

2. **Comandos únicos (fonte de verdade)**
   - O que é “ação” deve existir como `npm run ...` ou scripts em `scripts/`.
   - OpenCode chama via `.opencode/commands/*`.
   - VSCode Tasks chamam os mesmos comandos.
   - Codex CLI pode rodar os mesmos comandos no container e propor patches.

3. **Policy pack (o que pode sair da máquina)**
   - Definir L0/L1/L2 e aplicar:
     - no OpenCode (providers habilitados por padrão),
     - no Codex/Claude (quando usar cloud),
     - no runtime (router).

4. **Interop via MCP (cola dos assistentes)**
   - Um MCP server do projeto dá “tools seguras” para qualquer assistente:
     - ler status da fila, coletar logs, rodar validações, ver saúde do Chrome/proxy.
   - Benefício: reduz “prompt engineering” e aumenta auditabilidade.

### 3) Interop Plane (ponte entre assistentes e repo)

Uma camada que dá “superpoderes” com segurança e padronização.

**Recomendação forte: MCP server do projeto**

- Um servidor MCP (local) expõe operações seguras e úteis:
  - `queue_status`, `queue_add`, `chrome_health`, `graph_stats`, `config_get`, `logs_tail`…
- OpenCode consome MCP nativamente (config `mcp`).
- Outros agentes podem consumir via wrappers (quando suportarem).

---

## Roteamento prático (exemplos)

### Exemplo 1 — LLM-as-Judge local (Ollama)

- Entrada: prompt do usuário + texto extraído do UI driver.
- Saída: JSON de avaliação (completeness/relevance/quality).
- Política:
  - Default: **Ollama local** (custo ~zero, privacidade).
  - Fallback: Claude (Anthropic) somente se “confidence” baixo ou erro repetido.

### Exemplo 2 — Triage de falhas (cloud opcional)

Quando `triage.diagnoseStall()` detecta `LOGIN_REQUIRED`/`CAPTCHA`, o LLM pode:

- sugerir **remediação** (sem executar por conta própria),
- classificar severidade,
- gerar “runbook message” para dashboard.

### Exemplo 3 — Planejamento de estratégia

O LLM pode gerar um plano “textual/estruturado” que o Kernel consome, mas a execução continua no
browser driver (com guardrails).

---

## Governança e segurança (essencial em multi-assistente)

### Classificação de dados

Defina 3 níveis (exemplo):

- **L0 Público**: pode sair para cloud.
- **L1 Interno**: preferir local; cloud só com redaction.
- **L2 Sensível**: nunca sair; apenas local (Ollama) ou desabilitado.

### Prompt hygiene

- Remover tokens/sessões/cookies/URLs completas quando não necessário.
- Logging com “hash/preview” em vez de conteúdo completo (quando sensível).

### Contenção de blast radius

- Circuit breaker por provider: se falhar N vezes, desabilita temporariamente.
- Timeouts padronizados + retries limitados.

---

## Loop de aprendizado (para o programa “aprender” sem virar risco)

“Aprender” aqui deve ser entendido como um pipeline de melhoria contínua, não como “mágica”:

1. **Coleta de artefatos (governada)**
   - `traceId`, `taskId`, domínio alvo, selectors usados, timings, estados do driver,
     `ValidationReport` e decisão.
   - Conteúdo sensível deve ser redigido/hasheado (L2).

2. **Sinal de resultado (ground truth)**
   - sucesso/falha da task,
   - correções humanas (quando ocorrerem),
   - regressões detectadas em testes.

3. **Síntese (local-first)**
   - A LLM local gera “lições” estruturadas:
     - novos invariantes,
     - ajustes de rubrica do judge,
     - padrões de falha por domínio,
     - recomendações de refactor.

4. **Aplicação com guardrails**
   - Atualizar `dynamic_rules.json`/config/políticas (quando aplicável),
   - gerar issues/PRs (quando é código),
   - nunca auto-merge sem gates.

> Resultado: o sistema fica progressivamente mais robusto porque converte execução em “dados de
> engenharia” (telemetria + artefatos + decisões).

---

## Auto-programação (fase avançada, mas com trilhos)

Para “auto-programar” com segurança, trate como um **processo de PR automatizado**, não como “editar
código em produção”:

1. **Detecção**: identificar um problema recorrente (falha de selector, flake, timeout).
2. **Hipótese**: gerar um plano de correção (local-first; cloud opcional por política).
3. **Patch**: propor mudanças pequenas e rastreáveis (1 objetivo por PR).
4. **Validação**: rodar `npm run validate:all` + testes focados.
5. **Gate humano**: revisão e aprovação (obrigatória para áreas críticas).
6. **Deploy gradual**: habilitar atrás de flag/config quando possível.
7. **Avaliação**: medir se a taxa de erro caiu (telemetria).

Integrações que tornam isso viável:

- **OpenCode/Codex CLI**: geração e aplicação de patch + execução de validações.
- **MCP**: ferramentas seguras para ler logs/status e executar checks.
- **Runtime artifacts**: evidências para explicar “por que esse patch existe”.

Para contratos e detalhes operacionais do pipeline (interpretação/judge/reparo), ver:

- `DOCUMENTAÇÃO/ESPECIFICACAO_PIPELINE_LLM.md`
- `DOCUMENTAÇÃO/ROADMAP_OLLAMA_OPENCODE_ASSISTENTES.md` (roadmap detalhado: dev + runtime +
  interop + aprendizado)
- `DOCUMENTAÇÃO/DIAGRAMA_ECOSISTEMA_ASSISTENTES.md` (diagrama completo: Copilot + OpenCode +
  Ollama + runtime)

---

## Roadmap incremental (sem rework)

### Fase 1 — Padronização do Dev Toolchain (1–2 dias)

- OpenCode: multi-provider config (Ollama local + Claude + OpenAI).
- Comandos e memória do projeto (já iniciado).
- Checklist de governança e “o que pode sair”.

### Fase 2 — Ollama no Runtime como Judge (2–4 dias)

- Implementar `JudgeClient` (HTTP OpenAI-compatible).
- Injetar no `LLMJudge` via config/env.
- Adicionar testes de unidade para parsing/fallback/timeout.

### Fase 3 — LLMService + Policy Router (4–8 dias)

- Interface única + providers.
- Telemetria via NERV.
- Regras de roteamento por tarefa/sensibilidade.

### Fase 4 — MCP server do projeto (opcional, mas “cola” tudo) (3–6 dias)

- Expor ferramentas seguras do repo.
- Conectar OpenCode via `mcp`.

### Fase 5 — Loop de aprendizado + PRs assistidos (6–15 dias)

- Registrar artefatos (governados) por task e consolidar sinais de sucesso/falha.
- Implementar síntese local-first (“lições”) e geração de backlog (issues).
- Habilitar “PR assistido” (não-autônomo): gera patch + valida + abre PR rascunho.

---

## Decisões a fechar (para não “inventar” complexidade)

1. Quais capabilities runtime são “MVP” (judge? triage? planner?).
2. Qual nível de dados pode ir para cloud (L0/L1/L2)?
3. Onde OpenCode vai rodar na prática (host vs DevContainer)?
4. Modelo local alvo (qual família) para judge/triage (baixo custo/latência).
5. Onde guardar artefatos (e o que é permitido guardar) por nível L0/L1/L2.
6. Quais invariantes determinísticos são “hard fail” vs “soft fail”.
