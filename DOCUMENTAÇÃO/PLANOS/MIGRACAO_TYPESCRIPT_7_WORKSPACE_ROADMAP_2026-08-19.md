# Migração TypeScript 7 do workspace — diagnóstico, estado-alvo e roadmap

> **Status:** implementação e validação concluídas em 20 de agosto de 2026; falta apenas a
> verificação pós-rebuild descrita em J.11
>
> **Início desta onda:** 19 de agosto de 2026
>
> **Escopo:** workspace inteiro, com prioridade para `src/copilot`, scripts e testes
>
> **Idioma de trabalho e documentação:** português-BR
>
> **Regra de evidência:** nenhum item pode ser marcado como concluído sem gate focal ou final
> reproduzível.

## 1. Objetivo

Consolidar o TypeScript 7.x+ como compilador e serviço de linguagem canônicos do workspace,
eliminando todos os diagnósticos de tipagem, falhas de testes, erros de lint e dependências
circulares do madge. A correção deve ser estrutural: contratos completos, narrowing real, test
doubles fiéis e limites arquiteturais explícitos. Não são aceitos tipos vagos, casts que apenas
silenciem o compilador, supressões ou exclusões artificiais de cobertura.

A compatibilidade com TypeScript anterior deve ser mínima, localizada e justificada pelo
`typescript-eslint`. O DevContainer, VS Code, scripts npm, CI e documentação devem refletir a mesma
arquitetura. O rebuild do container só será solicitado depois que todos os gates finais estiverem
verdes e a imagem nova for a única verificação pendente.

## 2. Restrições operacionais

- Preservar integralmente o worktree de continuação: **732 arquivos rastreados alterados** e **28
  arquivos não rastreados** no baseline desta onda.
- Não reverter, sobrescrever ou reformatar em massa trabalho anterior sem prova de necessidade.
- Usar validadores raramente e de modo focal: arquivo ou cluster durante implementação; lane no
  fechamento de subfase; aggregates apenas em marcos e no fechamento final.
- Manter caches fora da árvore versionada, preferencialmente em `/home/node/.cache`.
- Não usar `@ts-ignore`, `@ts-nocheck` ou `@ts-expect-error` em código ativo.
- Não usar `any`, `Object`, `Function`, mocks parciais ou coerções duplas como substitutos de
  contrato. Fronteiras realmente dinâmicas usam `unknown` e narrowing local.
- Toda correção de bug descoberta pela tipagem deve receber teste focal correspondente.

## 3. Baseline reproduzido em 19 de agosto de 2026

Esta seção preserva o estado histórico que orientou a migração. O estado final reproduzido está
registrado na seção 8 e prevalece para operação corrente.

### 3.1 Toolchain

| Componente                | Estado observado                                                                            | Avaliação                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Node.js                   | `v24.15.0`                                                                                  | alinhado ao runtime do projeto                                                     |
| npm                       | `12.0.2`                                                                                    | alinhado ao `packageManager`                                                       |
| compilador local canônico | `@typescript/native` → `tsc 7.0.2`                                                          | correto                                                                            |
| compatibilidade local     | `typescript` → `@typescript/typescript6 6.0.2`, que instala TS `6.0.3` em `@typescript/old` | deve ficar restrita ao ESLint                                                      |
| `tsserver` global atual   | TypeScript `6.0.3` em `/usr/local/share/npm-global`                                         | stale; depende do rebuild para desaparecer                                         |
| ESLint                    | `10.8.1` + `typescript-eslint 8.67.0`                                                       | funcional, mas com project service quebrado em 53 arquivos                         |
| Vitest                    | `4.1.11`                                                                                    | cache configurado; execução ampla ainda cara                                       |
| madge                     | `8.0.0`                                                                                     | depende internamente de TS 5.9.3; aceitável como detalhe encapsulado da ferramenta |

### 3.2 Cobertura e rigidez TS7

- `check:ts7-strict-coverage`: **2.840/2.840** arquivos JS/TS nativos cobertos por **45 projetos**.
- **43 SFCs Vue** inventariados separadamente para `vue-tsc`.
- `check:base-strict`: **27 opções canônicas** confirmadas.
- `src/copilot`: **0 diagnósticos TS7**.
- Solução TS7 completa: **2.705 diagnósticos em 281 arquivos**, distribuídos por 25 projetos
  vermelhos e 20 verdes.
- Pico da solução completa: aproximadamente **4,27 GiB RSS** em 32,68 s. O aggregate não deve ser
  usado no ciclo interno de correção.

### 3.3 Projetos TS7 vermelhos

| Prioridade | Projeto                                                                                                | Diagnósticos | Arquivos |
| ---------: | ------------------------------------------------------------------------------------------------------ | -----------: | -------: |
|          1 | `scripts.model-gateway`                                                                                |        1.003 |       25 |
|          2 | `workspace-root`                                                                                       |          847 |       69 |
|          3 | `tests.legacy`                                                                                         |          286 |       16 |
|          4 | `tests.unit`                                                                                           |          274 |      142 |
|          5 | `tests.regression`                                                                                     |           87 |       31 |
|          6 | `configs`                                                                                              |           42 |       25 |
|          7 | `src.root`                                                                                             |           41 |       24 |
|          8 | `tests.integration`                                                                                    |           40 |       25 |
|          9 | `src.server`                                                                                           |           27 |       13 |
|         10 | `scripts.root`                                                                                         |           13 |        9 |
|         11 | `src.driver`                                                                                           |           10 |        8 |
|         12 | `scripts.analysis`                                                                                     |            9 |        4 |
|         13 | `src.core`                                                                                             |            5 |        4 |
|         14 | `scripts.build`                                                                                        |            3 |        2 |
|         15 | `src.dashboard-ui`                                                                                     |            3 |        3 |
|         16 | `src.infra`                                                                                            |            3 |        2 |
|         17 | `src.shared`                                                                                           |            3 |        2 |
|         18 | `tests.fixtures`                                                                                       |            2 |        1 |
|      19–25 | `scripts.ci`, `scripts.env`, `scripts.health`, `scripts.ops`, `src.kernel`, `src.nerv`, `tests.manual` |       1 cada |   1 cada |

Projetos TS7 verdes no baseline: `public`, `agents`, `tools.workspace`, `src.agent`,
`src.audit_agent`, `src.copilot`, `src.copilot.sdk`, `src.inference_gateway`, `src.integration`,
`src.logic`, `src.missions`, `src.orchestrator`, `src.types`, `src.validation`, `scripts.audit`,
`scripts.legacy`, `scripts.setup`, `tests.e2e`, `tests.helpers` e `tests.mocks`.

### 3.4 Distribuição dos diagnósticos TS7

| Código    | Quantidade | Causa dominante                         |
| --------- | ---------: | --------------------------------------- |
| `TS2339`  |        616 | contratos de objetos incompletos        |
| `TS7006`  |        537 | callbacks/parâmetros sem tipo           |
| `TS6133`  |        377 | imports, variáveis ou parâmetros mortos |
| `TS2322`  |        294 | atribuições incompatíveis               |
| `TS2345`  |        223 | argumentos incompatíveis                |
| `TS7031`  |        171 | destructuring sem contrato              |
| `TS18046` |        125 | fronteira `unknown` sem narrowing       |
| `TS7005`  |         66 | variáveis sem tipo inferível            |
| `TS7053`  |         51 | indexação sem chave tipada              |
| `TS2532`  |         46 | valor possivelmente `undefined`         |
| `TS2571`  |         41 | objeto `unknown` usado diretamente      |

Epicentros globais:

- `scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`: **693**.
- `src/server/domain/control_command_service.js`: **120**.
- `src/server/api/controllers/tasks.js`: **106**.
- `src/server/api/controllers/missions.js`: **86**.
- `scripts/model-gateway/commands/model-gateway-auto-scenarios.mjs`: **68**.
- `scripts/model-gateway/commands/model-gateway-runtime-selector.mjs`: **64**.
- `src/server/api/controllers/dashboard_audit.js`: **63**.

### 3.5 Compatibilidade TS6 e aggregates

| Gate                          | Estado                           |
| ----------------------------- | -------------------------------- |
| lane `tests.unit` sob TS7     | 274 diagnósticos / 142 arquivos  |
| mesma lane via script TS6     | 342 diagnósticos / 166 arquivos  |
| `tsconfig.tests.json` via TS6 | 723 diagnósticos / 217 arquivos  |
| `tsconfig.tools.json` via TS6 | 1.030 diagnósticos / 45 arquivos |
| `tsconfig.declarations.json`  | 0 diagnósticos                   |

A diferença entre TS7 e TS6 é um contrato de compatibilidade real, não motivo para promover TS6 a
compilador principal. O encerramento exige zero em ambos onde a compatibilidade for mantida.

### 3.6 Gates auxiliares

- Supressões: **15 `@ts-expect-error`** em cinco arquivos de testes; o gate atual exige zero.
- Contrato tsserver: schema, daemon e skill possuem as mesmas dez operações, mas a auditoria falha
  porque trata `node_modules/typescript/lib/typescript.d.ts` (compatibilidade TS6) como fonte
  semântica do TS7.
- Lint: **67 erros**, dos quais **53** são falhas do `projectService` em arquivos que os tsconfigs
  realmente incluem e **14** são findings de regras. O run custou 165,22 s e 3,85 GiB RSS.
- Madge: **84 ciclos**. O ciclo 1–83 pertence ao mesmo componente fortemente conectado MCP
  (`control-plane` → maintenance/smoke → Cloudflare → registry → tools barrel); o ciclo 84 é isolado
  em terminal/dialog/transcript.
- ENV: 37 variáveis referenciadas; todas cobertas pelos templates ou allowlist de runtime.
- Projeções de extensões VS Code: sincronizadas, com o cliente oficial TS7
  `TypeScriptTeam.native-preview` e `js/ts.experimental.useTsgo=true`.
- Teste runtime amplo de Copilot: interrompido após 177 s, ao confirmar seleção monolítica de 630
  arquivos; a nova regra operacional exige testes focais durante as correções.

## 4. Bugs, gaps e riscos confirmados

### P0 — bloqueadores de veracidade dos gates

- [x] `typecheck:strict:all` executa a solução completa, inclusive `workspace-root`, `src.copilot` e
      `scripts.model-gateway`, nos 45 projetos.
- [x] Todos os scripts `typecheck:*` passam pelo runner canônico TS7; não há lane chamada TS7
      executando TS6 ocultamente.
- [x] O audit de contrato usa a autoridade semântica TS7 e confirma as mesmas dez operações no
      schema, daemon e skill.
- [x] O lint type-aware cobre a superfície pretendida sem os 53 erros de `projectService`.
- [ ] O `tsserver` global TS6 da imagem antiga só pode ter sua remoção comprovada após o rebuild;
      Dockerfile, DevContainer e CI já não o instalam.

### P1 — dívida estrutural e bugs prováveis

- [x] `model-gateway-terminal-llm-b-live-test.mjs` foi tipado por contratos/DTOs reais e teve
      parsing de CLI extraído; o cluster caiu de 693 diagnósticos para zero.
- [x] Controllers e serviços de servidor receberam shapes explícitos e narrowing, incluindo
      `control_command_service`, tasks, missions e dashboard audit.
- [x] `test_loop_manager.spec.js` usa `DialogTurnSemanticResult` real.
- [x] As 15 supressões foram removidas; testes negativos atravessam fronteiras runtime explícitas
      com `Reflect.apply`. O gate confirma zero diretivas em 2.891 arquivos ativos.
- [x] Dependências internas deixaram de atravessar o barrel `mcp/tools/index.js`; contratos,
      control-plane, runners e tools foram separados.
- [x] O ciclo terminal/dialog foi rompido com direção de dependência unidirecional e barrel de IO
      explícito.

### P2 — performance e governança

- [x] O lint usa cache persistente em `/home/node/.cache/eslint` e heap explicitamente limitado; o
      ciclo focal não recria o aggregate.
- [x] O runner misto divide Node/Vitest/Copilot em shards determinísticos, limita workers e agrega
      relatórios compactos, preservando `NODE_COMPILE_CACHE` e cache do Vitest.
- [x] Documentação, matriz de contratos, automações e configuração do editor descrevem TS7 como
      autoridade e 45 projetos estritos.
- [x] A referência `.github/skills/reactive-bug-audit/references/reproduction-playbook.md` existe e
      documenta reprodução determinística, isolamento e regressão.

## 5. Estado-alvo

1. `tsc 7.x+` local é a autoridade de todos os projetos nativos do workspace.
2. Todos os 45 projetos da solução são executados por um aggregate canônico e ficam em zero.
3. A compatibilidade TS6 fica encapsulada no processo do `typescript-eslint`, sem `tsserver` global,
   scripts de produto ou daemon semântico paralelo.
4. O editor usa apenas o LSP nativo oficial do TS7; fallback clássico não é estado normal.
5. Testes, tools, declarations, Vue, supressões, lint e madge ficam em zero.
6. Gates usam cache persistente, escopo focal no ciclo interno e aggregates determinísticos em CI.
7. Contratos públicos são precisos; `unknown` é estreitado; test doubles satisfazem apenas ports
   reais e completos.
8. Dockerfile, DevContainer, VS Code, CI, package scripts e documentação descrevem a mesma
   toolchain.

## 6. Roadmap por faixas, fases e subfases

### Faixa A — Congelamento do baseline e gates verazes

- [x] **A.1** Ler objetivo e handoff anterior.
- [x] **A.2** Inventariar worktree sem reverter mudanças.
- [x] **A.3** Medir TS7 completo e por projeto.
- [x] **A.4** Medir TS6 aggregates, declarations, lint, madge, supressões, ENV e VS Code.
- [x] **A.5** Criar este roadmap canônico.
- [x] **A.6** Corrigir o aggregate `typecheck:strict:all` para cobrir os 45 projetos sem duplicar
      semântica nem esconder o compilador efetivo.
- [x] **A.7** Criar comando focal de diagnósticos por projeto/arquivo com cache e resumo por código.

### Faixa B — Prioridade `src/copilot` e lane unitária

- [x] **B.1** Preservar `src/copilot` em zero TS7.
- [x] **B.2** Corrigir `test_loop_manager.spec.js` com `DialogTurnSemanticResult` real.
- [x] **B.3** Eliminar clusters de 6–4 diagnósticos por causa compartilhada.
- [x] **B.4** Eliminar clusters de 3–2 diagnósticos por contrato compartilhado.
- [x] **B.5** Eliminar arquivos unitários com um diagnóstico.
- [x] **B.6** Remover as 15 supressões com fixtures estruturais e narrowing de fronteira.
- [x] **B.7** Fechar a lane unitária em zero sob TS7; TS6 ficou restrito ao processo do ESLint.
- [x] **B.8** Rodar testes runtime somente dos clusters alterados; full Copilot apenas no marco.

### Faixa C — Scripts Model Gateway e workspace root

- [x] **C.1** Decompor parsing/ports do live-test e aplicar DTOs internos coesos.
- [x] **C.2** Zerar `scripts.model-gateway` do maior cluster para os menores.
- [x] **C.3** Zerar scripts raiz e configs por contrato reutilizável.
- [x] **C.4** Zerar `workspace-root`, removendo scripts mortos/duplicados quando comprovado.
- [x] **C.5** Fechar `tsconfig.tools.json` sob TS7; TS6 não é mais compilador de tools.

### Faixa D — Servidor e demais fontes de produção

- [x] **D.1** Tipar ports, DTOs e envelopes do `control_command_service`.
- [x] **D.2** Tipar controllers por schemas/runtime contracts compartilhados.
- [x] **D.3** Zerar `src.server` e `src.root`.
- [x] **D.4** Fechar lanes residuais: driver, core, infra, shared, kernel, nerv e dashboard.
- [x] **D.5** Revalidar todas as lanes de produção previamente verdes.

### Faixa E — Testes e aggregates

- [x] **E.1** Zerar `tests.integration`.
- [x] **E.2** Zerar `tests.regression`.
- [x] **E.3** Zerar `tests.legacy` com contratos explícitos, sem relaxamento por ser legado.
- [x] **E.4** Zerar fixtures e testes manuais residuais.
- [x] **E.5** Zerar `tsconfig.tests.json` sob TS7; TS6 não é mais compilador de testes.
- [x] **E.6** Manter declarations e Vue verdes.
- [x] **E.7** Executar testes runtime focais por cluster e corrigir toda falha.
- [x] **E.8** Executar a suíte unitária completa somente ao fechar a faixa.

### Faixa F — ESLint rigoroso e performante

- [x] **F.1** Corrigir a causa dos 53 arquivos rejeitados pelo `projectService`.
- [x] **F.2** Eliminar os 14 findings reais de lint.
- [x] **F.3** Revisar regras hoje desligadas por ruído e habilitar apenas as que sejam verazes no
      modelo JS-first consolidado.
- [x] **F.4** Isolar TS6 dentro do ESLint e documentar por que o TS7 nativo ainda não fornece a API
      requerida pelo parser.
- [x] **F.5** Reduzir residência/tempo com projetos por zona, cache de conteúdo e execução
      changed-files no ciclo interno, mantendo full lint em CI.
- [x] **F.6** Fechar lint completo em zero.

### Faixa G — Eliminação das circularidades

- [x] **G.1** Gerar grafo/SCC do componente MCP e identificar arestas de retorno, não apenas os 83
      caminhos enumerados.
- [x] **G.2** Separar contracts/factories puras de startup e runtime orchestration.
- [x] **G.3** Remover dependências internas do barrel `mcp/tools/index.js`.
- [x] **G.4** Inverter registry/smoke/Cloudflare por ports ou injeção de dependência.
- [x] **G.5** Romper o ciclo terminal/dialog/transcript por um contrato de projeção unidirecional.
- [x] **G.6** Zerar `npm run analyze:deps` e manter um gate de regressão com cache de resolução
      quando suportado.

### Faixa H — Consolidação TS7/LSP/DevContainer

- [x] **H.1** Decidir e implementar o destino do daemon local TS6: migração para o LSP nativo TS7 ou
      remoção da superfície redundante.
- [x] **H.2** Corrigir o audit de contrato para a autoridade semântica efetiva, sem chamar TS6 de
      TS7.
- [x] **H.3** Garantir que a imagem instale apenas o compilador/LSP TS7 global necessário.
- [x] **H.4** Manter TS6 somente como dependência local encapsulada do ESLint.
- [x] **H.5** Remover configurações, extensões e diagnósticos de LSPs não utilizados.
- [x] **H.6** Validar Dockerfile, JSONC do DevContainer, projeções VS Code e workflows.
- [x] **H.7** Atualizar canon, matriz de contratos, índice de automação e docs de tipagem no mesmo
      change set.

### Faixa I — Performance dos validadores e testes

- [x] **I.1** Padronizar `tsBuildInfoFile` por projeto fora do repo e evitar aggregates no loop
      interno.
- [x] **I.2** Adicionar um orquestrador incremental que rode somente projetos impactados e preserve
      um aggregate integral verificável.
- [x] **I.3** Corrigir o custo do lint type-aware sem remover regras semânticas de alto valor.
- [x] **I.4** Dividir testes Copilot em shards determinísticos, preservar compile/transform cache e
      agregar relatórios sem perder falhas.
- [x] **I.5** Comparar runs equivalentes antes/depois e registrar tempo/RSS.

### Faixa J — Fechamento e rebuild

- [x] **J.1** TS7: 45/45 projetos, 2.848/2.848 arquivos nativos, zero diagnósticos.
- [x] **J.2** TS6 localizado no ESLint; tests/tools usam TS7 e estão verdes.
- [x] **J.3** Declarations, Vue, supressões e contrato LSP verdes.
- [x] **J.4** Testes unitários, integração e regressão verdes.
- [x] **J.5** Lint e formatação verdes.
- [x] **J.6** Madge com zero circularidades.
- [x] **J.7** DevContainer/Dockerfile/workflows/docs verdes.
- [x] **J.8** Revisar diff final e confirmar que nenhum tipo falso ou exclusão artificial entrou.
- [ ] **J.9** Organizar os commits, publicar e comprovar `HEAD == origin/main` com worktree limpo.
- [ ] **J.10** Somente então instruir o usuário a fazer rebuild do container.
- [ ] **J.11** Após rebuild, comprovar `node`, `npm`, `tsc`, LSP/extensão e ausência de `tsserver`
      global stale.

## 7. Protocolo de validação focal

Durante a implementação:

1. filtrar diagnósticos existentes do arquivo/cluster sem rerodar aggregate;
2. aplicar a correção estrutural;
3. executar `tsc -p <projeto>` apenas ao fechar o cluster;
4. executar testes runtime explicitamente relacionados;
5. executar a lane inteira ao fechar a subfase;
6. executar aggregates somente nas transições de faixa e no fechamento final.

O roadmap deve ser atualizado com contagens e evidências a cada fechamento de faixa. Se uma medição
contradizer este baseline, prevalece o estado reproduzido mais recente e a divergência deve ser
registrada, não escondida.

## 8. Fechamento reproduzido em 20 de agosto de 2026

### 8.1 TypeScript e cobertura

| Gate                                | Resultado final                                                       |
| ----------------------------------- | --------------------------------------------------------------------- |
| `npm run -s tsc7 -- --version`      | `Version 7.0.2`                                                       |
| `npm run check:base-strict`         | 27 opções estritas canônicas verificadas                              |
| `npm run check:ts7-strict-coverage` | 2.848/2.848 JS/TS nativos, 45 projetos; 43 SFCs inventariados à parte |
| `npm run typecheck:strict:all`      | zero diagnósticos nos 45 projetos                                     |
| `npm run typecheck:repo`            | node, tools, browser, tests, Vue e isolated declarations verdes       |
| `npm run typecheck:declarations`    | verde                                                                 |
| `npm run typecheck:dashboard`       | verde; cache em `/home/node/.cache/typescript`                        |
| `npm run check:ts-expect-error`     | zero diretivas em 2.891 arquivos ativos                               |

O baseline de 2.705 diagnósticos foi reduzido a zero sem exclusão artificial de arquivos. Os oito
arquivos nativos adicionais em relação ao inventário inicial são contratos, runners e helpers
criados durante a correção; todos entraram na cobertura estrita.

### 8.2 Toolchain, editor e LSP

- `@typescript/native` 7.0.2 é a autoridade de todos os scripts npm e da CI por meio de
  `scripts/ci/run-typescript-7.mjs`.
- TS6 permanece somente no alias local `@typescript/typescript6`, importado pelo adaptador
  `scripts/analysis/typescript-compat.mjs` para o `typescript-eslint`.
- O daemon local foi migrado para o protocolo LSP do TS7, mas `LSP_ENABLED=false` e
  `LSP_MUTATIONS_ENABLED=false` são defaults no DevContainer, PM2, diagnóstico e runtime.
- `npm run analyze:tsserver-contract` confirmou as dez operações em schema, daemon e skill.
- `npm run lsp:health` retornou `enabled=false` e `status=disabled-by-policy` sem rede.
- `npm run vscode:sync:check` confirmou projeções sincronizadas. As extensões ausentes/indesejadas
  no runtime atual são resíduo esperado da imagem antiga e serão reconciliadas pelo rebuild.

### 8.3 Qualidade, arquitetura e performance

| Gate                           | Resultado final                                                        |
| ------------------------------ | ---------------------------------------------------------------------- |
| `npm run lint:quiet`           | zero erros; cache aquecido: 43,63 s e 528.480 KiB RSS máximo           |
| `npm run analyze:deps`         | 1.715 arquivos processados, zero circularidades                        |
| `npm run validate`             | configuração válida; aviso não bloqueante de `profile/` criado no boot |
| Prettier focal de documentação | verde                                                                  |

Comparação do lint equivalente: 165,22 s e aproximadamente 3,85 GiB RSS no baseline contra 43,63 s e
aproximadamente 516 MiB RSS no fechamento aquecido. O runner de testes passou a usar descoberta
única, shards determinísticos, limites de workers, relatório compacto e caches de
compilação/transform fora da árvore versionada.

### 8.4 Testes

`npm test` terminou com código zero e executou, em sequência, unitários, integração e regressão:

- unitários gerais: shards de 155, 420 e 184 testes, mais 74 testes Vitest, todos aprovados;
- unitários Copilot: 7.065 aprovados e 28 pendentes condicionais, zero falhas;
- integração: 147 aprovados/6 skips no Node, 4 aprovados/3 skips no Vitest e 12 aprovados/5
  pendentes no Copilot;
- regressão: 95 aprovados no Node, 7 aprovados/4 skips no Vitest e 31 aprovados no Copilot.

Após o gate integral, as cinco specs de validação negativa convertidas para fronteira runtime
passaram 158/158. As duas suítes de integração movidas para diretórios temporários passaram 24/24 e
deixaram os fixtures versionados intactos.

### 8.5 Bugs e gaps corrigidos durante o fechamento

- Schema V5 agora fornece `workflow step config` vazio por default quando ausente.
- Fallback de permission handler em lifecycle usa nível WARN e mensagem operacional correta.
- Regressão da UI foi alinhada ao fluxo vNext por stores e confirmação em duas etapas.
- CORS HTTP/socket compartilha `CONFIG.ALLOWED_ORIGINS` com contrato tipado explícito.
- Teste real de SIGTERM/SIGINT só anuncia prontidão após registrar handlers e limpa o timeout; sua
  duração focal caiu de aproximadamente 20,7 s para 1,3 s.
- Testes de missões não removem mais diretórios/fixtures versionados.
- O cache `tsconfig.tsbuildinfo` do Vue não é mais criado dentro do workspace.
- O playbook ausente da skill `reactive-bug-audit` foi criado e indexado.

### 8.6 Auditoria estrutural final antes da publicação

- O diff final contém zero adições de `/** @type {any} */`; as 81 ocorrências identificadas na
  revisão foram substituídas por contratos de domínio, narrowing de `unknown`, validação de rows
  SQLite ou invocação reflexiva explícita em fixtures deliberadamente parciais.
- Uma segunda varredura, cobrindo qualquer adição lexical de `any`, eliminou também assinaturas
  permissivas em PTY, IPC, SQLite, tools e testes. Restaram somente texto descritivo e o `z.any()`
  intencional do schema público de plano de patch.
- `git diff --check` está limpo e `check-ts-suppressions` permanece em zero diretivas.
- Após essa revisão, `typecheck:repo`, `typecheck:strict:all`, declarations, lint completo,
  cobertura estrita e madge foram reproduzidos com código zero.
- Conforme a orientação de fechamento, a suíte integral não foi repetida: o recorte diretamente
  afetado passou 216/216 testes Node e 54/54 testes Vitest. A suíte integral registrada em 8.4
  continua sendo o marco anterior do mesmo worktree.
- A última redução de tipos permissivos foi revalidada isoladamente com 8/8 testes Node (Audit
  Agent + daemon LSP) e 7/7 testes Vitest (terminal MCP + contrato de dependências), além dos
  recortes já verdes de 50/50 na fronteira MCP e 6/6 no controle de terminal.

## 9. Única pendência externa: rebuild

O código, a configuração, os testes e a documentação estão fechados. J.11 permanece aberto porque
somente a imagem reconstruída pode comprovar a remoção física do `tsserver` global stale e a
reconciliação das extensões instaladas. Depois do rebuild, executar:

```bash
node --version
npm --version
npm run -s tsc7 -- --version
npm run vscode:check:runtime
npm run lsp:health
command -v tsserver && tsserver --version || true
```
