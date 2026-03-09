# Pending Tasks — Modo Arquiteto

> **Para agentes de IA lendo este arquivo:**
>
> Este arquivo é o backlog do **Modo Arquiteto**. Leia sempre junto com
> `.github/hooks/state/session-briefing.md` (gerado pelo hook sessionStart).
>
> **Protocolo de início de sessão** (obrigatório):
> 1. Ler `session-briefing.md`
> 2. Ler este arquivo (`pending-tasks.md`) na íntegra
> 3. Checar `turn_count` em `session-context.json`
> 4. Invocar `vscode_askQuestions` com Template E (Session Kickoff) — ver AGENTS.md
>
> **Ao concluir qualquer tarefa:**
> ```bash
> bash .github/hooks/scripts/complete-task.sh "<padrão único do título>"
> ```
> Depois, invocar `vscode_askQuestions` com Template A (Next Step).
>
> **Para registrar um finding durante análise:**
> ```bash
> bash .github/hooks/scripts/save-finding.sh "<módulo>" "<severity>" "<type>" "<descrição>"
> ```
>
> **Para criar novas tarefas autonomamente:**
> ```bash
> bash .github/hooks/scripts/add-task.sh "<alta|media|backlog>" "<Título>" "<Descrição>"
> ```
>
> **Quality gates ao final de cada conjunto de mudanças:**
> ```bash
> npm run lint && npm run typecheck:node && npm run test:unit
> ```
>
> **Filosofia**: você é um arquiteto autônomo com plenos poderes para propor e executar
> upgrades. Quando encontrar um bug, crie a tarefa. Quando ver uma oportunidade de melhoria,
> proponha via `vscode_askQuestions`. Nunca espere permissão para criar novas tarefas —
> a permissão está aqui: **crie, proponha e execute.**

---

## Alta Prioridade

> Tarefas críticas com maior impacto imediato no projeto.

### Tipagem Full-Strict Roadmap

- [ ] **Fase A — Corrigir TS8032/TS8024 (JSDoc estrutural, sem flags)**: executar `npm run typecheck:node 2>&1 | grep "TS8032"`, corrigir os ~177 casos adicionando `@param {object} params` antes dos sub-params; corrigir os ~37 casos TS8024 reordenando @param. Gate: `typecheck:node | grep -c "TS8032"` → 0. <!-- refs: DOCUMENTAÇÃO/TIPAGEM E JSDOC/ROADMAP.md -->

- [ ] **Fase A — Lane `src.logic` (2 erros)**: rodar `npm run typecheck:strict 2>&1 | grep "src/logic"`, aplicar fixes de tipagem. É a lane mais simples — começo ideal para aquecimento.

- [ ] **Fase A — Lane `scripts.analysis` (181 erros)**: focar nos arquivos mais simples primeiro (`analyze-code-graph.mjs`, `scan_literals.mjs`). Usar `@ts-nocheck` apenas em arquivos de manipulação AST pura onde os tipos são impossíveis de inferir.

- [ ] **Fase A — Lane `src.inference_gateway` (191 erros)**: fixar TS2339 (shape dos payloads) adicionando typedefs para os objetos de configuração do gateway.

- [ ] **Fase A — Lane `src.dashboard-ui` (285 erros)**: usar skill `vue-tsc-dashboard` — componentes Vue têm padrões específicos. Rodar `npm run typecheck:browser` como referência.

- [ ] **Fase A — Lane `tests.manual` (300 erros)**: os testes manuais aceitam `@ts-nocheck` pragmático se necessário — focar nos arquivos de helper que são compartilhados.

- [ ] **Fase A — Lane `src.audit_agent` (358 erros)**: corrigir shapes dos payloads de auditoria e resultados de inferência.

### Quality e Robustez

- [ ] **Cobertura de testes**: executar `npm run test:unit`, identificar arquivos com <50% de branches cobertos via coverage, adicionar testes unitários. Priorizar `src/kernel/`, `src/driver/`, `src/infra/`.

- [ ] **Auditoria de bugs conhecidos**: ler `DOCUMENTAÇÃO/AUDITORIAS/` e `DOCUMENTAÇÃO/BUGS/` (se existir), selecionar bugs de severidade alta ainda abertos, investigar e corrigir.

- [ ] **Documentação de READMEs**: executar skill `readme-standardization`, criar/completar READMEs nos módulos `src/nerv/`, `src/kernel/`, `src/driver/`, `src/infra/`, `src/server/` que estejam faltando.

---

## Média Prioridade

> Melhorias significativas mas não urgentes.

### Tipagem Full-Strict — Fase B

- [ ] **Lane `src.shared` (746 erros)**: typedefs para enums NERV e payloads de eventos. Consultar `src/shared/nerv/constants.js` como referência dos enums já criados.
- [ ] **Lane `src.orchestrator` (773 erros)**: shapes dos objetos de estratégia (SINGLE_SHOT, ITERATIVE, MULTI_STEP).
- [ ] **Lane `src.integration` (924 erros)**: fixar tipos dos adaptadores de integração externa.
- [ ] **Lane `scripts.audit` (928 erros)**: `@ts-nocheck` em scripts de análise AST; fixes reais nos scripts de auditoria de código.
- [ ] **Lane `scripts.root` (935 erros)**: classificar por arquivo, aplicar fixes ou `@ts-nocheck` pragmático.
- [ ] **Lane `tools.workspace` (1.013 erros)**: ferramentas de workspace com typing mais relaxado.
- [ ] **Lane `src.core` (1.053 erros)**: crítico — `src/core/` define contratos centrais. Focar nos arquivos de config e schema.
- [ ] **Lane `src.agent` (1.190 erros)**: workers internos — fixar tipos dos payloads de fila e controle.

### Arquitetura e Extensibilidade

- [ ] **Diagramas Mermaid**: criar `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE_DIAGRAMS.md` com diagramas C4 dos fluxos principais (boot sequence, task execution, NERV event flow).
- [ ] **Coverage target 80%**: identificar branches não cobertos em `src/kernel/execution_engine/` e adicionar unit tests.
- [ ] **Plugin system**: implementar lifecycle hooks em `src/driver/factory.js` permitindo extensão de novos targets sem modificar core.

---

## Fase C — Longo Prazo

> Lanes complexas do Full-Strict Roadmap. Cada uma requer sessão dedicada.

- [ ] **Lane `tests.legacy` (1.403 erros)**: `tests/legacy/` — aceita `@ts-nocheck` file-level pragmático.
- [ ] **Lane `src.kernel` (0 erros — verde)**: ✅ concluído — manter contra regressões com `npm run typecheck:strict`.
- [ ] **Lane `src.driver` (1.558 erros)**: o driver é crítico (browser automation). Fixar shapes de Page, ElementHandle, etc. via `@types/puppeteer` ou typedefs internos.
- [ ] **Lane `src.infra` (2.232 erros)**: a maior lane. Dividir por sub-módulo: `browser_pool/`, `queue/`, `storage/`, `locks/`. Sessões separadas por sub-módulo.

---

## Backlog Livre

> Itens de melhoria contínua — explore e escolha o que fizer mais sentido.

- [ ] **Exploração de bugs**: rodar `npm run audit:quick`, ler o relatório gerado, investigar os top-3 bugs encontrados.
- [ ] **Performance**: usar skill `performance-audit` — rodar `hyperfine` em operações críticas do kernel loop, identificar gargalos.
- [ ] **Segurança**: usar skill `security-checklist` — revisar headers HTTP do servidor, validação de inputs via Zod, exposição de endpoints.
- [ ] **JSDoc coverage**: rodar `npm run jsdoc:coverage`, identificar funções públicas sem documentação em `src/core/` e `src/kernel/`.
- [ ] **Dependências circulares**: rodar `npm run analyze:circular`, eliminar os ciclos encontrados se houver.
- [ ] **Env governance**: usar skill `env-governance` — auditar variáveis de ambiente, garantir que `.env.example` está completo e documentado.

---

## LLM-Gerado

> Tarefas criadas autonomamente pelo agente durante sessões de trabalho.
> Adicionadas via `bash .github/hooks/scripts/add-task.sh`.
> Cada tarefa inclui a anotação `<!-- auto:YYYYMMDD -->` indicando quando foi gerada.

<!-- Tarefas geradas autonomamente serão inseridas aqui automaticamente -->

---

<!-- HISTÓRICO DE SESSÕES -->
<!-- As notas abaixo são adicionadas automaticamente pelo hook session-end ao encerrar cada sessão -->
