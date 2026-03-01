# Roadmap detalhado: Ollama + OpenCode + Multi-assistentes (WSL/DevContainer) + LLM Services (runtime)

Este roadmap organiza **todas as etapas** (com explicação e critérios de aceite) para integrar:

- **Ollama** (LLM local) no ecossistema
- **OpenCode** no DevContainer (WSL com container)
- **Multi-assistentes** (Copilot, Codex CLI, Claude, etc.) com “contrato único”
- **LLM Services no runtime** (interpretação, validação local/global, reparo)
- Evolução para **aprendizado** e, no limite, **auto-programação com guardrails**

Pré-requisito conceitual (topologia):

- **Nível 0 — Windows**: host do Docker Desktop e rede do Docker.
- **Nível 1 — WSL sem container**: filesystem onde o repo vive.
- **Nível 2 — DevContainer**: onde o Node do projeto roda e onde o OpenCode deve rodar.

> No seu cenário (Docker Desktop no Windows + repo no WSL), a forma mais estável é: **Ollama no
> Windows (Nível 0)** e **OpenCode no DevContainer (Nível 2)** acessando via
> `http://host.docker.internal:11434`.

---

## Visão geral (macro-fases)

1. **Fundação do ambiente (Dev)**: conectividade, persistência, config, comandos e governança.
2. **Contrato único de ferramentas**: padronizar “ações reais” (scripts) e interfaces
   (OpenCode/VSCode/Codex).
3. **Interop (MCP)**: uma camada de ferramentas seguras (status da fila, logs, health checks).
4. **Runtime LLMService**: providers + router + telemetria + políticas.
5. **Pipeline dinâmico**: interpretação local + validação determinística + judges local/global +
   reparo.
6. **Aprendizado**: artefatos governados + síntese + backlog.
7. **Auto-programação (avançado)**: PR assistido com gates e validações.

Cada macro-fase é incremental (sem rework): você pode parar no meio e ainda terá ganhos reais.

---

## Antes de tudo: “um Ollama ou dois?” (dev vs runtime)

Vocês vão usar Ollama em dois eixos:

1. **Dev (CODE)**: OpenCode (no DevContainer) para programar, refatorar, rodar comandos e ajudar em
   arquitetura.
2. **Runtime (programa)**: interpretar/validar/julgar respostas extraídas do browser (pipeline LLM)
   e eventualmente planejar/reparar.

Isso pode ser feito de duas formas:

### Opção A (recomendada para começar): 1 servidor Ollama compartilhado

- **1 Ollama** rodando no Windows (Nível 0) em `:11434`.
- OpenCode (no DevContainer) e o runtime (Node no DevContainer) chamam o mesmo endpoint:
  - `http://host.docker.internal:11434/v1`
- Separação é lógica:
  - modelos diferentes por `purpose` (`code`, `judge`, `interpret`, etc.)
  - políticas no `LLMService`/router (dataClass L0/L1/L2, allowCloud, budgets)

Vantagens:

- mais simples de operar,
- um único cache de modelos,
- uma única porta para diagnosticar.

Riscos:

- **contenção de recursos** (OpenCode pode “roubar” GPU/CPU do judge runtime),
- latência variável em horários de pico de dev.

Quando usar:

- MVP, equipe pequena/média, e workloads não simultâneos.

### Opção B (quando precisar de isolamento/QoS): 2 servidores Ollama no mesmo host

- Dois processos/serviços Ollama no Windows em portas diferentes:
  - `:11434` para **dev (OpenCode)**
  - `:11435` para **runtime (programa)**
- Cada “cliente” aponta para o seu endpoint, evitando interferência direta.

Vantagens:

- isolamento de performance e fila,
- mais fácil impor limites por “lado”.

Riscos:

- operação um pouco mais complexa (2 serviços),
- decisão sobre diretório de modelos/caches (governança e espaço).

Quando usar:

- se o runtime precisa ser estável enquanto o time está programando,
- ou se vocês perceberem 503/overload/latência por concorrência.

> Recomendação: começar com **Opção A**; só migrar para **Opção B** quando houver evidência de
> contenção real (telemetria/latência/erros).

## Fase 0 — Decisões e guardrails (1–2 sessões)

### 0.1 Definir “o que nunca muda”

- Puppeteer/browser segue sendo o **atuador soberano** (UI drivers).
- LLMs por API entram como **serviços auxiliares** (judge/interpret/classify/plan/repair).
- Nada de “auto-merge” ou escrita autônoma em áreas críticas sem gate humano.

**Aceite**

- Documento de decisão (pode ser um parágrafo no `DOCUMENTAÇÃO/ARQUITETURA...`) confirmando isso.

### 0.2 Definir governança de dados (L0/L1/L2)

O objetivo é responder: “o que pode sair para cloud?”.

- **L0 (público)**: pode ir para cloud.
- **L1 (interno)**: preferir local; cloud apenas com redaction e `allowCloud=true`.
- **L2 (sensível)**: nunca vai para cloud; local-only (ou desabilita).

**Aceite**

- Uma tabela simples com exemplos: segredos, tokens, cookies, prompts com dados internos, etc.
- Política padrão (recomendação):
  - Dev toolchain: cloud ok para L0/L1 (opt-in), proibido para L2.
  - Runtime: `allowCloud` sempre opt-in.

### 0.3 Selecionar modelos mínimos

Evite “mil modelos” no início. Sugestão:

- **Local (Ollama)**: 1 modelo “coder” para `interpret/judge` (baixo custo/latência).
- **Global**: 1 modelo para “second opinion” e reparo quando permitido.

**Aceite**

- Lista de modelos e para quais `purpose` eles serão usados no MVP.

---

## Fase 1 — Integração do ambiente (Ollama + OpenCode) no WSL/DevContainer (0.5–2 dias)

### 1.1 Rodar Ollama no Windows (Nível 0) e expor porta

**Por que**

- `host.docker.internal` do DevContainer aponta de forma previsível para o Windows host do Docker
  Desktop.
- Cache/pesos fora do container e mais fácil aproveitar GPU do Windows.

**Passos**

1. Instalar Ollama no Windows.
2. Baixar um modelo: `ollama pull ...`
3. Validar no Windows: `curl http://127.0.0.1:11434/api/version`
4. Configurar para aceitar conexões externas:
   - `OLLAMA_HOST=0.0.0.0:11434` (ou equivalente do serviço)
5. Liberar firewall do Windows para `11434` (entrada).

**Aceite**

- Do DevContainer: `curl http://host.docker.internal:11434/api/version` retorna versão.
- Do OpenCode: comando `/ollama-check` passa (ver `.opencode/commands/ollama-check.md`).

### 1.2 Instalar OpenCode no DevContainer (Nível 2)

**Por que**

- Garante que `npm`, Node, paths e scripts são os do ambiente real do projeto.

**Passos**

1. No DevContainer: instalar `opencode`.
2. Configurar provider Ollama:
   - copiar template `tools/opencode/opencode.ollama.devcontainer.example.jsonc` para
     `~/.config/opencode/opencode.jsonc`
3. Rodar `opencode` na raiz e testar modelos.

**Aceite**

- `opencode --version` funciona no DevContainer.
- OpenCode consegue listar modelos via Ollama (`/ollama-check` ou `/v1/models`).

### 1.3 Persistência de configuração do OpenCode

**Problema**

- Rebuild do DevContainer pode apagar `~/.config/opencode`.

**Opções**

- A) “Source of truth no repo”: manter templates e copiar quando necessário (simples).
- B) Montar volume para `~/.config/opencode` no `.devcontainer/devcontainer.json` (melhor).

**Aceite**

- Após rebuild, config do OpenCode não se perde (pela opção escolhida).

---

## Fase 2 — Contrato único do Dev Toolchain (1–3 dias)

### 2.1 Padronizar comandos “verdadeiros” (scripts)

**Meta** Todo assistente deve poder executar as mesmas rotinas sem inventar comandos.

**Ações**

- Confirmar um conjunto mínimo de comandos:
  - `npm run validate:all`
  - `npm test`
  - `npm run check:chrome`
  - `npm run analyze:graph`
- Se houver gaps, criar scripts pequenos em `scripts/` e expor via `package.json`.

**Aceite**

- Uma lista curta e estável de comandos (rodando no DevContainer).

### 2.2 Integrar VSCode Tasks ↔ OpenCode Commands ↔ Scripts

**Meta** O mesmo “botão” exista em:

- VSCode tasks,
- OpenCode `/commands`,
- e CLI (`npm run ...`).

**Ações**

- Mapear os comandos existentes em `.opencode/commands/*`.
- Garantir que as tasks do VSCode chamem os mesmos scripts (não duplicar lógica).

**Aceite**

- Executar validação e checks tanto pelo VSCode quanto pelo OpenCode produz o mesmo resultado.

### 2.3 Política de uso de assistentes (papéis)

**Meta** Reduzir conflitos e duplicidade:

- Copilot: autocompletar/refactors localizados.
- OpenCode: tarefas orientadas a comandos (lint/test/triage).
- Codex CLI: mudanças multi-arquivo + execução/validação automatizada.
- Claude (cloud): arquitetura/revisão/ideação, respeitando governança.

**Aceite**

- Uma seção “como usamos assistentes” no guia interno (pode ficar em `tools/opencode/README.md`).

---

## Fase 3 — Interop via MCP (2–6 dias, opcional mas altamente recomendado)

### 3.1 MVP de MCP server do projeto

**Por que**

- MCP vira a “cola” para qualquer assistente: ferramentas seguras, auditáveis, sem prompt frágil.

**Ferramentas MCP sugeridas (mínimo)**

- `health.chrome_proxy()`
- `queue.status()`
- `queue.add(task)`
- `logs.tail(service)`
- `config.get(key)` / `config.validate()`
- `analysis.graph_stats()`

**Aceite**

- OpenCode consegue chamar as tools via config `mcp`.
- Logs e status ficam consistentes e rastreáveis.

### 3.2 Permissões e guardrails no MCP

**Meta** Nenhuma tool deve:

- exfiltrar segredos,
- escrever em código sem gate,
- rodar comandos destrutivos sem permissão explícita.

**Aceite**

- Política de permissões no MCP + logs de auditoria.

---

## Fase 4 — Runtime `LLMService` (3–8 dias)

### 4.1 Criar a interface única (porta de entrada)

**Meta** Um módulo do runtime ser “a única forma” de chamar LLM por API.

**Conteúdo**

- `generateText`
- `interpret`
- `judgeJson`
- `classify`
- `repair` (opcional no MVP)

**Aceite**

- Testes unitários com provider mock.
- Timeouts e retries padronizados.

### 4.2 Providers (plugins)

**MVP**

- `ollama` (OpenAI-compatible)
- `anthropic` (Claude)

**Aceite**

- Chamadas funcionam com o mesmo contrato `LLMRequest`.
- Erros são normalizados (`ProviderError`) e observáveis.

### 4.3 Router e política (dataClass + allowCloud)

**Meta** Escolher provider/model dinamicamente com base em:

- `purpose`
- `dataClass`
- `allowCloud`
- saúde do provider (circuit breaker)

**Aceite**

- Uma matriz simples implementada e testada (L0/L1/L2).

---

## Fase 5 — Pipeline dinâmico completo (4–12 dias)

Base: `DOCUMENTAÇÃO/ESPECIFICACAO_PIPELINE_LLM.md`

### 5.1 Interpretação local (Ollama) com schema

**Meta** Transformar texto bruto do UI driver em `InterpretedResponse` com `confidence`.

**Aceite**

- Para um conjunto de respostas reais, retorna JSON válido consistentemente.

### 5.2 Validação determinística (hard/soft fails)

**Meta** Separar o que é “quebra imediata” do que é “qualidade”.

**Aceite**

- Hard fail sempre impede `ACCEPT`.
- Soft fail reduz score e pode levar a `MANUAL_REVIEW`.

### 5.3 Judges (local + global opcional) e arbitragem

**Meta** Local sempre participa; global entra por política quando necessário.

**Aceite**

- A decisão final (`ACCEPT/RETRY/MANUAL_REVIEW`) é explicável por `ValidationReport`.

### 5.4 Repair prompt e loop controlado (se ativar `repair`)

**Meta** “Local critica; global corrige”.

**Aceite**

- Limite de tentativas (ex.: 1–2) para evitar loops infinitos.
- A taxa de `ACCEPT` melhora sem aumentar stalls.

---

## Fase 6 — Aprendizado (6–15 dias)

### 6.1 Registrar artefatos governados por execução

**Meta** Salvar evidências e resultados sem vazar L2.

**Aceite**

- Cada `traceId` tem:
  - métricas/tempos
  - `ValidationReport`
  - previews/ hashes conforme política

### 6.2 Síntese local-first (“lições”)

**Meta** Transformar telemetria em melhoria:

- padrões de falha por domínio,
- novas heurísticas/invariantes,
- backlog de issues.

**Aceite**

- Relatório periódico (ex.: semanal) gerado automaticamente.

---

## Fase 7 — Auto-programação assistida (avançado, 10–30 dias)

### 7.1 PR assistido (processo seguro)

**Meta** O sistema propõe mudanças como PRs pequenos, com validação automática.

**Passos**

- detectar problema recorrente,
- gerar plano e patch,
- rodar validações,
- abrir PR rascunho,
- exigir revisão humana e gates.

**Aceite**

- 1 exemplo real (correção de flake/selector) entregue via PR com testes passando.

### 7.2 Gradualismo e flags

**Meta** Evitar “grande mudança” sem rollback.

**Aceite**

- Features novas ativadas por config/flag e com rollback rápido.

---

## Dependências e riscos comuns (e como mitigar)

- **Rede host↔container**: resolver cedo com `/ollama-check`.
- **Firewall do Windows**: liberar `11434` e confirmar bind `0.0.0.0`.
- **Persistência de config**: definir volume ou “source of truth”.
- **Governança**: não deixar assistentes cloud verem L2.
- **Loops de reparo**: sempre limitar tentativas e ter fallback para manual review.

---

## Saída recomendada (o que vocês terão ao final)

- Um ambiente onde OpenCode roda no DevContainer e usa Ollama no host.
- Um “kit” de comandos e tools (MCP opcional) que funciona igual para OpenCode/Codex/VSCode.
- Um runtime com LLMService e pipeline dinâmico:
  - global gera, local interpreta/valida, e o sistema decide com arbitragem explicável.
- Uma trilha segura para aprendizado e, no limite, auto-programação via PR assistido.
