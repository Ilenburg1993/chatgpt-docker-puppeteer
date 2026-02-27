# Plano Mestre de Skills de Auditoria 🧩

Este documento descreve o design abrangente do conjunto de _skills de auditoria_ para o projeto
**chatgpt-docker-puppeteer**. A intenção é munir qualquer LLM (Copilot, Claude, ChatGPT, etc.) ou
colaborador humano com protocolos operacionais padronizados que cubram a variedade de cenários de
análise técnica do código, infraestrutura e processos.

## Avaliação do sistema de auditoria atual

Antes de construir novas skills, é essencial entender o mecanismo de auditoria já existente
(`scripts/audit/runner.mjs` e seus módulos associados). O auditor é um CLI extensível que:

- Suporta três _profiles_ (`quick`, `deep`, `nightly`) e um foco seletivo (`bug-first` ou `all`).
- Coleta achados através de coletores modulares por domínio (arquitetura, performance, qualidade,
  runtime, estático, testes). Cada coletor exporta uma função assíncrona que retorna `findings`,
  `errors`, `warnings` e pode usar utilitários como `madge` e contadores de imports.
- Possui _contracts_ de auditoria (JSON) que definem regras de qualidade/compliance; o runner avalia
  esses contratos e gera métricas de cobertura.
- Integra um motor de triagem baseado em LLM (`triage_llm.mjs`) que sintetiza e propõe patches ou
  prioridades a partir dos achados.
- Gera relatórios em múltiplos formatos: JSON (`publishJson`), Markdown mestre
  (`publishMasterMarkdown`), snapshots históricos e relatórios de cobertura de contratos.
- Loga eventos estruturados (`AUDIT_EVENT_TYPES`) e mantém estado de execução com fases, ETA,
  progress tracker e um sistema de retenção para runs antigos.
- Exibe resultados em console com `printProgress`/`printFinalReport` e publica artefatos em
  `artifacts/audit`.
- Configurações via CLI permitem controlar refresh de contexto, triagem, propostas de patch,
  qualidade (jsdoc/prettier), níveis de imposição, etc.

Coletores exemplificam tipos de análises automatizáveis: o `architecture` conta imports e detecta
acoplamento e dependências circulares; o `performance` mede ciclos e possíveis leaks; o `quality`
verifica JSDoc e Prettier. Há também um `test` collector que olha cobertura e warnings.

**Pontos fortes**:

- Cobertura ampla e configurável de domínios técnicos.
- Integração LLM já embutida para triagem automática e sugestão de patches.
- Produção de artefatos versionados (snapshots) que facilitam auditorias históricas.
- Alta parametrização permite invocar apenas partes necessárias.

**Limitações**:

- A CLI é poderosa, mas requer memorização dos parâmetros; não há abstração por caso de uso (skills)
  – é justamente o que vamos construir.
- Executa análise ampla; os _skills_ poderão invocar o runner com flags de filtro para adaptá-lo a
  domínios específicos.
- A leitura LLM dos achados concentra‑se na triagem; os skills complementarão com leitura de código
  selecionado pelo usuário.

### Integração com as skills

#### Inventário de skills já presentes

Antes de escrever novos SKILL.md, é útil reconhecer os recursos que já existem sob `.codex/skills`.
No momento há:

- `rag-mcp-lsp-ops` – workflow operacional para manter RAG, MCP e LSP em condições saudáveis. Serve
  como skill de suporte à execução e diagnóstico, e encaixa-se como um subconjunto de `ops-audit` /
  `audit-runbook-observability`.
- `lsp-ops` – abstração para invocar as ferramentas `lsp_*` (definição, referências etc.). Será
  amplamente usada pelos skills de qualquer domínio que precisem navegar no código.
- `typing-node24-esm-tsserver` – orientada para migração de tipagem, tipicamente acionada durante
  `upgrade-proposal` ou `architecture-audit`.
- `audit-system-analysis-planning` – descreve internamente o próprio sistema de auditoria; atua como
  um “meta‑skill” para revisão e roadmap, complementando o domínio `ops-audit` e
  `architecture-audit` no contexto da plataforma de auditoria.
- `audit-runbook-observability` – operacionalização diária do pipeline; fornece os comandos de
  preflight e leitura de artefatos que serão referenciados nos checklists de _todos_ os skills que
  disparam o runner.
- Outros skills de auditoria específicos (`audit-proposal-deep-triage`,
  `audit-codex-analise-arquitetura`, `audit-contracts-v3-ops`, `audit-agent-background-llm-ops`,
  `audit-runbook-observability`) mais especializados, que mapeiam para partes do plano ou podem ser
  tratados como exemplos avançados.

#### Como esses skills se encaixam no plano mestre

- Os novos skills que definiremos (bug-fix-audit, security-audit etc.) **não substituem** os
  existentes; ao contrário, eles se apoiam neles. Por exemplo, o checklist de `bug-fix-audit` pode
  começar com os passos do `audit-runbook-observability` e depois adicionar fases de triagem
  específicas.
- `rag-mcp-lsp-ops` permanece uma skill de utilidade transversal: qualquer skill que precise de
  contexto em tempo real deverá incluí-lo como prerequisito. Podemos até listar explicitamente nas
  instruções de cada novo skill: "Execute `rag-mcp-lsp-ops` antes de iniciar".
- `lsp-ops` será invocado durante as etapas de leitura LLM: a LLM pode ser instruída a utilizar as
  ferramentas `lsp_*` para obter definições e referências enquanto realiza a análise cognitiva.
- Os skills focados em auditoria do próprio sistema (`audit-system-analysis-planning` e
  `audit-runbook-observability`) atuam como componentes do domínio `ops-audit` e
  `architecture-audit`, e também representam modelos de como redigir um SKILL.md completo.

Compreender o inventário atual permite que o desenvolvimento das novas skills seja incremental:
podemos criar `npm run audit:bugfix` como wrapper que chama `node scripts/audit/runner …` seguido
dos prompts LLM, ou mesmo gerar templates baseados nos SKILL.md já existentes.

---

Cada skill aproveitará o audit runner como motor de coleta quando apropriado:

- `bug-fix-audit` → executar runner
  `--profile quick --focus bug-first --contracts-domains=runtime,static` para pegar evidências;
  depois usar leitura cognitiva sobre os arquivos mencionados.
- `architecture-audit` → chamar runner com `--contracts-domains=architecture` e talvez
  `--profile deep` para análise intensa. As descobertas de `architecture-collector` fornecerão
  entradas para a etapa de leitura LLM (por exemplo, examinar manualmente módulos com >20 imports).
- O script também é útil para `security-audit` (`--profile deep --contracts-domains=security` se
  existir) e `performance-audit` (executar coletores específicos).

Além disso, as skills podem estender ou substituir os coletores: por exemplo, um skill de
`dashboard-audit` poderia reutilizar `collectPerformanceFindings` e depois adicionar checagens
específicas de N+1 queries.

Os prompts LLM dos skills podem até consumir diretamente os `findings` emitidos pelo runner como
contexto adicional (via `triageFindings`).

Em resumo, o audit system existente fornece uma **infraestrutura de coleta e triagem** sólida que as
skills irão orquestrar e suplementar com leitura manual e protocolos específicos. Ele será
referenciado frequentemente na documentação de cada skill e exposto como um atalho de comando básico
(`npm run audit:...`) para os usuários finais.

---

## (continua o restante do plano...)

## 1. Objetivos gerais

1. **Cobertura total de domínios** – desde correção pontual de bugs até upgrades de larga escala. O
   conjunto de skills deve servir tanto para emergências (hotfix) quanto para revisões de
   arquitetura programadas.
2. **Protocolos replicáveis** – cada skill definirá passos claros, ferramentas e critérios de
   conclusão, incluindo a geração automática de README/documentação pela LLM quando não houver
   material existente. O mesmo fluxo será executado de forma idêntica por qualquer operador ou
   modelo.
3. **Fusão de automação + leitura LLM** – não confiar apenas em scanners; incluir sempre uma etapa
   de inspeção cognitiva direcionada pelo modelo. A leitura LLM não é opcional, é requisito em cada
   skill.
4. **Interoperabilidade** – skills podem se encadear ou trocar artefatos via MCP tools; por exemplo,
   um `bug-fix-audit` mal sucedido pode disparar automaticamente um `architecture-audit`. Haverá
   exemplos de chaining e uma pequena biblioteca de helpers para executar outro skill via
   linha de comando ou `tool: run`.
5. **Facilidade de uso** – qualquer colaborador deve poder executar um skill com poucas linhas de
   comando ou um briefing de texto. Os templates devem ser reutilizáveis e haver comandos de atalho
   (`npm run audit:bugfix` etc.).
6. **Feedback e evolução contínua** – incorporar um passo de retroalimentação onde o auditor
   registra bugs encontrados laterais e atualiza o skill (ex: dizer “adicionar validação X”). Essa
   feedback será usada para ajustar prompts e checklists. Será mantido um tracker (planilha
   JSON ou Google Sheet) onde cada usuário pode anotar sugestões de melhoria e problemas com
   prompts; a cada ciclo de 3–6 meses os prompts serão revisados.

---

## 2. Domínios propostos (skills iniciais)

| Skill                | Propósito principal                                                           | Exemplo de gatilho                           |
| -------------------- | ----------------------------------------------------------------------------- | -------------------------------------------- |
| `bug-fix-audit`      | Triagem + replicação + patch rápido de defeitos operacionais                  | Issue de erro no log                         |
| `architecture-audit` | Revisão de acoplamento, dependências, complexidade e padrões arquiteturais    | Refatoração planejada / perda de performance |
| `security-audit`     | Busca por segredos, injeções, vulnerabilidades de dependências, permissões    | Relatório de pen-test / CVE crítico          |
| `performance-audit`  | Investigação de leaks, hotspots CPU/memória, gargalos                         | Disparada por profiling ou reclamação lenta  |
| `ops-audit`          | Verificação de PM2/Docker/DevContainer, disponibilidade de serviços e RAG/MCP | Degradação do dashboard ou MCP indisponível  |
| `upgrade-proposal`   | Planejar migrações de dependências, Node/TS/infra, roadmap técnico            | Novo LTS lançado / auditoria de versão       |

Cada domínio terá sub‑checklists específicos; por exemplo, `security-audit` sempre executará
`npm audit` e `grep -R "process.env"`, enquanto `ops-audit` inclui validação de
`docker-compose.yml`, checagem de portas abertas e exercício de failover.

Outros skills que podem ser adicionados no futuro:

- `dashboard-audit` para revisar consumo de memória/CPU na UI e queries N+1.
- `rag-health-audit` para investigar problemas de indexação e disponibilidade de Ollama.
- `docs-audit` para garantir que o conteúdo em DOCUMENTAÇÃO/ esteja sincronizado com o código.

#### Comandos sugeridos
Cada domínio receberá um alias npm; a própria tabela acima poderá ser acompanhada por uma
lista de comandos de exemplo (`npm run audit:bugfix`, `npm run audit:archive`, etc.). Os
scripts estão gerados automaticamente pelo `make-skill.js` e podem ser personalizados pelo
usuário no `package.json`.

#### Escalonamento entre skills
Os skills podem encadear-se. Por exemplo, um `bug-fix-audit` que detectar uma dependência
muito acoplada pode invocar `npm run audit:architecture -- --focus <arquivo>` ou usar a
ferramenta MCP `tool: run` para disparar o `architecture-audit` em background. Esse
padrão de chaining será descrito em cada SKILL.md pertinente.

A tabela acima será mantida como referência rápida; os arquivos `SKILL.md` para cada domínio
incluirão descrições expandidas e templates de comando.

_Observação_: a lista é expansível; skills adicionais (por ex. `dashboard-audit`,
`rag-health-audit`) podem ser incorporados conforme surgem novos problemas.

---

## 3. Estrutura comum de cada skill

Cada skill virá com um esqueleto Jekyll‑like, facilitando geração automática e testes:

> **Nota:** dentro de cada skill os passos serão agrupados em três grandes fases que formam o fluxo
> de trabalho padrão:
>
> 1. **Identificação** — descobrir bugs, gaps e incompletudes (coletar, observar, ler).
> 2. **Proposta** — priorizar e gerar correções, melhorias ou upgrades.
> 3. **Aplicação** — implementar as propostas, validar com testes e registrar resultados.
>
> Esta triagem deve ficar explícita no checklist do template, garantindo que a LLM e os operadores
> sigam o mesmo ciclo.

```markdown
# nome-do-skill

## Descrição

texto explicando propósito e contexto de uso.

## Pré-requisitos

- serviço X em execução
- variáveis Y definidas

## Checklist passo a passo

1. item automatizado
2. leitura LLM ...

## Ferramentas

- `mcp tool-a`
- `npm run diagnose`

## Protocolo LLM

<prompt_template>

## Categorias de bugs/incompletudes

<lista adaptada do domínio>

## Done criteria

...

## Fallbacks

...
```

A documentação e testes estarão alinhados a este template; um gerador de skills
(`scripts/audit/make-skill.js`) poderá criar a estrutura inicial. O script é simples:
`node scripts/audit/make-skill.js <nome> [--npm-alias]` e já adiciona um atalho em
`package.json` (`npm run audit:<nome>`), facilitando a criação de aliases como
`npm run audit:bugfix` ou `npm run audit:security`. Há testes unitários do gerador em
`tests/unit/audit_skills/make-skill.spec.js` que garantem que o boilerplate seja produzido
corretamente.

Além disso, os checklists devem indicar quanto tempo estimado cada fase leva e quais artefatos
salvar (logs, capturas MCP, relatórios LLM).

---

1. **Descrição e contexto** – quando e por quê usar.
2. **Pré‑requisitos** – serviços/variáveis que devem estar online.
3. **Checklist passo a passo**:
   - Ações automatizadas (scripts, MCP tools, comandos shell).
   - Ações de leitura manual/LLM (descritas abaixo).
   - Consolidação de resultados e priorização de ações.
   - **Categorias de bugs/incompletudes a investigar** – cada skill deve listar os tipos mais
     prováveis de problema que o auditor humano/LLM deve procurar (ver seção específica a seguir).
4. **Ferramentas principais** – lista de ferramentas MCP (`rag_search`, `lsp_*`, `audit_*`) e
   utilitários shell de referência.
5. **Protocolo LLM** – prompts padrão para guiar a leitura/inspeção, com sugestões de
   direcionamento.
6. **Done‑criteria** – evidências que habilitam fechamento (patch aplicado, relatório escrito,
   upgrade planejado, etc.).
7. **Fallbacks/escalonamento** – quando abrir issue, envolver equipe ou pivotar para outro skill.

Exemplo genérico de checklist (omitindo detalhes específicos de cada domínio):

```text
[ ] executar `npm run diagnose` e salvar saída
[ ] capturar logs relevantes (últimos 24h)
[ ] rodar `rag_search` com termo relacionado ao problema
[ ] executar `lsp_diagnostics` nos arquivos afetados
[ ] **leitura LLM:** enviar trechos críticos (de 1–3 funções) com este prompt base:
    "Leia este código e liste quaisquer comportamentos estranhos, caminhos de erro não
    tratados, validações ausentes ou violações de convenção. Sugira mudanças."
[ ] compilar achados automáticos + LLM num relatório README (parágrafo por item); se não
    houver README pré‑existente para o módulo/fluxo, peça à LLM que **gere um novo** explicando
    objetivo, uso e contexto.
[ ] se aplicável, gerar patch e testar localmente
[ ] documentar no issue com link para o relatório e patch
```

### Bugs e incompletudes que exigem leitura cognitiva

Embora scanners e linters encontrem muitos erros sintáticos e estilos, a **maior parte das falhas
reais está escondida em padrões de lógica e omissões contextuais**. As auditorias devem procurar
explicitamente estas categorias:

- **Controle de fluxo mal manejado**: paths condicionais não cobertos, uso incorreto de `async` /
  `await`, loops infinitos, promessas não esperadas.
- **Validação insuficiente**: dados do usuário aceitos sem sanitização, valores `null`/`undefined`
  não acessados, suposições sobre conexões de rede ou recursos externos.
- **Gestão de recursos**: falta de `finally`/`cleanup`, event listeners não removidos, arquivos
  abertos sem fechamento, timeouts ignorados.
- **Robustez operacional**: tratamento fraco de erros de IO, retries ausentes, mensagens de log
  incompreensíveis.
- **Configurações hard‑coded e magic numbers**: valores embutidos que não são extraíveis via
  `config.json`, URLs fixas, portos, credenciais.
- **Incompletudes de API**: funções declaradas mas não chamadas, parâmetros documentados mas nunca
  utilizados, exportações sem uso em qualquer lugar do workspace.
- **Código ausente ou parcialmente implementado**: trechos que aparentam iniciar uma tarefa (como
  `// TODO implement retry` ou `if (false) {}`), mas nunca completam; funções que descrevem
  funcionar de determinada forma nos comentários mas retornam `undefined` ou apenas lançam erro;
  stubs deixados durante o desenvolvimento que quebram fluxos porque nunca foram preenchidos. Este
  tipo de bug aparece quando o sistema deveria "fazer X" mas simplesmente não há código para X.
- **Casos não tratados / entradas não previstas**: rotas que não verificam determinados headers,
  parse de JSON sem try/catch, switch/case sem default, arrays que assumem comprimento fixo, etc. O
  auditor deve imaginar quais cenários de entrada podem ser esquecidos.
- **Dependências perigosas**: uso de APIs obsoletas, módulos npm com history de vulnerabilidades,
  versões mescladas de TS/JS causando incompatibilidade.
- **Inconsistências entre comentários e código**: comentários desatualizados, TODO/FIXME não
  resolvidos, comportamentos descritos errôneos.

Cada skill deve instruir a LLM a mirar nestas áreas quando fizer a leitura de código; por exemplo,
`bug-fix-audit` poderia adicionar "Verifique se há validação de dados em todas as rotas que
processam `req.body`".

---


### Biblioteca de prompts

Para reduzir duplicação e permitir ajustes centralizados, todos os prompts usados pelos
skills serão definidos numa biblioteca compartilhada. Um módulo `scripts/audit/prompts.js`
exportará prompts nomeados como `readCodePrompt`, `triagePrompt`, `generateReadmePrompt`,
etc., que podem ser importados ou simplesmente referenciados nos SKILL.md. Assim, cada
skill apenas cita "use o `readCodePrompt`" em vez de reescrever o texto.

## 4. Protocolo de leitura LLM detalhado

> **Nota adicional:** dada a escassez de READMEs no repositório, cada inspeção deve terminar com a
> LLM gerando ou enriquecendo um README/summary para o arquivo ou sub‑sistema analisado. Isso cria
> documentação útil para auditorias futuras e serve como artefato de propósito.

1. **Seleção de código** – basear‑se em resultados automáticos (erro, grep, símbolos LSP) ou em
   hipóteses da auditoria.
2. **Formatar snippet** – incluir localizador `// file: path/to/file.js` e não mais que 200 linhas.
3. **Prompt de análise** (padrão):

   > ```text
   > Você é um auditor de código. Antes de mais nada, identifique a **intenção / finalidade** do
   > código apresentado – o que ele deveria fazer no fluxo maior da aplicação. Em seguida,
   > responda:
   > 2. Existe validação de entrada suficiente? Onde poderiam ocorrer `undefined`/`null`?
   > 3. Há loops ou recursões que podem gerar bloqueio ou uso excessivo de CPU?
   > 4. Comente se há padrões conhecidos de bugs (variáveis globais, callback omisso,
   >    sincronização incorreta, etc.).
   > 5. Sugira pequenas melhorias ou riscos potenciais.
   > ```

4. **Registro das observações** – as respostas do modelo devem ser incorporadas literal ou
   sumarizadas no relatório do skill.
5. **Iteração** – se a primeira rodada não cobre o suficiente, peça “Olhe especificamente para a
   manipulação de eventos assíncronos nestas funções.”

Este protocolo garante que a leitura não seja vaga ou genérica; força o modelo a aplicar pensamento
crítico.

---

## 5. Integração com MCP tools e testes

- Cada skill será acompanhado por um conjunto de comandos/narrativas YAML que podem ser executadas
  via `mcp:run` ou copiar/colar no chat de uma LLM usando o agente.
- Ferramentas LLM internas (como `tool: rag_search`, `tool: lsp_definition`) podem ser referenciadas
  diretamente no texto das instruções para automatizar parte da coleta.
- Criar testes unitários para as células de protocolo: verificar que checklists existem e que
  prompts são gerados corretamente; simular fluxo de auditoria em `tests/unit/audit_skills/*`.
- Adicionar um conjunto de **smoke tests** que chamam cada skill em um repositório de fixtures
  vazio, garantindo que eles retornem sucesso e/ou criem o template esperado.

---

## 6. Exemplo de skill pronto (esboço inicial)

> O arquivo final de cada skill conterá seções como as descritas acima. Aqui está um esboço de
> `bug-fix-audit`:
>
> ```markdown
> # bug-fix-audit
>
> ...
>
> ## Checklist
>
> 1. Verificar logs (`logs/*`).
> 2. Reproduzir localmente usando `npm run dev` e seguir passos descritos no report.
> 3. Consultar MCP:`rag_search` por strings de erro.
> 4. Usar LSP para abrir símbolos envolvidos.
> 5. Leitura LLM: ... ...
> ```

Não redigimos detalhes ainda; isto é apenas um modelo referencial.

---

## 7. Medidas de sucesso e manutenção

- Adoção: percentagem de auditorias passadas que seguiram pelo menos um skill.
- Cobertura: número de incidentes / upgrades registrados que caíram sob um skill vs. fora.
- Qualidade dos relatórios LLM: feedback humano se as observações foram úteis.
- Atualizar skills a cada 3–6 meses com casos novos ou ferramentas emergentes.

---

### 8. Próximos passos

1. Revisar este plano com a equipe e ajustar domínios/prompts.
2. Começar a escrever os primeiros `SKILL.md` com base nos templates.
3. Janeiro-backfill histórico: aplicar um skill a auditorias anteriores para validar o protocolo e
   refinar prompts.
4. Estabelecer roadmaps de execução detalhados com checklists (abaixo).

---

## Roadmap de implementação e fases

Para orientar o trabalho a partir deste ponto, adicionei abaixo um **checklist mestre** que serve de
guia prático: cada passo corresponde a tarefas que serão repetidas em todos os domains e skills.

1. Preparar ambiente de auditoria
   - Confirmar PM2/MCP/RAG/LSP via `audit-runbook-observability`.
   - Atualizar dependências (`npm install` etc.).
   - Garantir accesso às ferramentas MCP (`tools/call`).

2. Identificação (fase 1)
   - Escolher domínio/skill (bug, security, arch, perf, ops, upgrade).
   - Executar audit runner com flags apropriadas para coletar findings.
   - Rodar `rag_search` e `lsp_diagnostics` conforme necessidade.
   - Conduzir leitura LLM nos arquivos/trechos apontados.
   - Registrar todas as descobertas num artefato de auditoria preliminar.

3. Proposta (fase 2)
   - Priorizar problemas usando triagem LLM (`triageFindings`).
   - Gerar sugestões de patch automatizadas ou manuais.
   - Planejar upgrades maiores (Node/TS/infra) se identificados.
   - Documentar as propostas em issues/relatórios e obter aprovação.

4. Aplicação (fase 3)
   - Criar branches e aplicar correções.
   - Executar testes e reexecutar audit runner para verificar resolução.
   - Atualizar snapshots e tracker (`DOCUMENTAÇÃO/BUGS/rodadas`).
   - Fechar issues e comunicar mudanças à equipe.

5. Revisão contínua
   - Coletar feedback do operador/LLM e ajustar prompts/checklists.
   - Agendar auditoria periódica (quick/nightly) para monitoramento.
   - Adicionar novos domínio/skills conforme surgem casos especiais.

({Additional notes}-{os})

O trabalho geral a partir deste ponto pode ser dividido em **três grandes etapas** que serão
repetidas dentro de cada skill e também na própria evolução do sistema de auditoria:

1. **Identificação** – descobrir e catalogar bugs, gaps e incompletudes:
   - Executar ferramentas automáticas (`npm run audit:quick`, `rag_search`, `lsp_diagnostics`).
   - Reunir logs, relatórios e findings do audit runner.
   - Conduzir leitura LLM com prompts específicos para inspeção cognitiva.
   - Registrar todas as descobertas num documento de auditoria preliminar.

2. **Proposta** – formular correções, melhorias e upgrades:
   - Priorizar as descobertas por severidade/impacto usando o motor de triagem LLM.
   - Gerar propostas de patch via `triageFindings`, `patch_suggester` ou manualmente.
   - Identificar dependências de upgrade (Node, TS, libs) e planejar roadmap.
   - Documentar as propostas no repositório (issue, relatório, snapshot).

3. **Aplicação** – implementar e validar as propostas:
   - Criar branches/commits com os patches recomendados.
   - Executar testes unitários e de integração; rodar novamente o audit runner.
   - Validar que as correções eliminaram os achados originais e não introduziram novos.
   - Atualizar o histórico na pasta `DOCUMENTAÇÃO/BUGS/rodadas` e fechar issues.

Cada skill seguirá este fluxo, adaptando o checklist para seu domínio específico. O roadmap acima
também orienta as atividades de manutenção contínua do sistema de auditoria: novas coletores,
ajustes de contrato, melhorias de prompts, etc.

---

_Arquivo gerado automaticamente pelo assistente Copilot em 27 fev 2026._
