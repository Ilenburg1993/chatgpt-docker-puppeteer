# Auditoria Qualitativa das Categorias Vivas

**Propósito**: avaliar a qualidade, a maturidade e a classificação correta do conteúdo em `GUIAS/`,
`REFERENCIA/` e `OPERACOES/`, registrando o que deve ser mantido, reescrito, consolidado, movido ou
arquivado na próxima fase.  
**Status documental**: Canônico.  
**Público**: engenharia, governança documental, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Escopo

Esta auditoria cobre apenas as três categorias vivas mais relevantes fora de `ARQUITETURA/`:

- `DOCUMENTAÇÃO/GUIAS/`
- `DOCUMENTAÇÃO/REFERENCIA/`
- `DOCUMENTAÇÃO/OPERACOES/`

O objetivo não é executar a movimentação nesta etapa, e sim registrar uma base objetiva para a
consolidação seguinte.

## Resumo executivo

A estrutura dessas três categorias já está navegável e possui `README.md`, mas a qualidade do
conteúdo ainda é desigual. O problema dominante deixou de ser estrutural e passou a ser semântico:

- há documentos canônicos que continuam úteis, mas ainda estão em estilo antigo e precisam de
  rewrite editorial;
- há documentos sobrepostos que competem entre si como se fossem baseline;
- há relatórios de implementação e análises pontuais ainda alojados em categorias vivas;
- há poucos casos de material mal posicionado que deveria migrar para `RELATORIOS/` ou
  `ARQUIVO_MORTO/`.

Leitura correta:

- `GUIAS/` precisa principalmente de consolidação editorial e redução de duplicidade;
- `REFERENCIA/` precisa de consolidação de baseline e reclassificação de relatórios;
- `OPERACOES/` precisa de poda temática mais forte, porque mistura operação viva com relatórios de
  implementação já encerrada.

## Critérios usados

- **Manter canônico**: ainda funciona como referência viva da categoria.
- **Reescrever**: o tema continua válido, mas o documento está desatualizado, excessivamente legado
  ou fora do padrão editorial atual.
- **Consolidar**: o conteúdo concorre com outro documento da mesma categoria e deve ser fundido.
- **Mover para `RELATORIOS/`**: registra resultado, implementação, validação ou análise concluída.
- **Mover para `ARQUIVO_MORTO/`**: histórico útil, mas não deve competir com a navegação viva.

## Achados por categoria

### 1. GUIAS

#### Situação geral

`GUIAS/` contém material importante e ainda útil, mas com forte mistura de estilos:

- parte da pasta já segue a nova governança por categoria;
- vários documentos ainda usam formato legado com emojis, metadata inline e tom de manual fechado;
- há sobreposição clara entre guias canônicos novos e versões antigas do mesmo assunto.

#### Manter como baseline, mas reescrever

- `QUICK_START.md`
- `DEVELOPMENT.md`
- `TROUBLESHOOTING.md`
- `FAQ.md`
- `MONITORING_GUIDE.md`
- `CONTRIBUTING.md`

Motivo:

- os temas continuam centrais para onboarding e uso diário;
- o conteúdo ainda é útil, mas o padrão editorial está heterogêneo;
- alguns pressupostos técnicos já mudaram desde janeiro de 2026 e precisam de alinhamento com a
  arquitetura atual e com a taxonomia nova.

#### Manter como guias especializados

- `DEBUG_BROWSER_WINDOWS.md`
- `DEBUG_NODE_INSPECTOR.md`
- `FIX_WINDOWS_ACCESS.md`
- `WSL_INTEGRATION_GUIDE.md`
- `INTEGRACAO_OLLAMA_OPENCODE.md`

Motivo:

- são guias situacionais, mas ainda fazem sentido como material de suporte;
- não devem competir com `QUICK_START` nem com `DEVELOPMENT`;
- precisam apenas de posicionamento claro como documentação especializada, não como baseline geral.

#### Consolidar ou descontinuar

- `TESTING.md` sobrepõe diretamente `TESTES.md`.

Estado após consolidação inicial:

- `TESTES.md` permanece como guia canônico em pt-BR para a estrutura atual de `tests/`;
- `TESTING.md` foi rebaixado para um wrapper curto de compatibilidade;
- qualquer aprofundamento futuro deve convergir para `TESTES.md`, não para o wrapper.

#### Diagnóstico de maturidade

`GUIAS/` está funcional, mas ainda em transição. O maior problema aqui não é categoria errada; é
conteúdo vivo em formato antigo.

Estado após a rodada mais recente:

- `QUICK_START.md`, `DEVELOPMENT.md`, `TROUBLESHOOTING.md`, `FAQ.md` e `MONITORING_GUIDE.md` já
  foram reescritos em padrão canônico, com checagem contra os contratos reais do repositório;
- `CONTRIBUTING.md` também já foi reescrito com base nos templates e comandos reais;
- a próxima lacuna em `GUIAS/` passa a ser a revisão dos guias especializados restantes.

### 2. REFERENCIA

#### Situação geral

`REFERENCIA/` já concentra material técnico útil, mas a categoria ainda mistura baseline de contrato
com relatórios e checklists de implementação.

Os dois pares de maior sobreposição são:

- `API_REFERENCE.md` x `API.md`
- `CONFIGURATION.md` x `CONFIG_FILES.md`

#### Baseline que deve prevalecer

- `API_REFERENCE.md`
- `CONFIGURATION.md`
- `ENV_VARIABLES_GUIDE.md`
- `MODULE_ALIASES.md`
- `SCRIPTS.md`
- `GLOSSARY.md`
- `HEALTH_ENDPOINT.md`
- `DRIVER_EXAMPLES.md`
- `INTEGRACOES/RAG_MCP_LSP_PLAYBOOK_PTBR.md`

Motivo:

- esses documentos ainda funcionam como referência recorrente;
- têm papel de contrato, consulta estável ou exemplos de uso repetível.

#### Sobreposição que exige consolidação

- `API.md` é uma versão mais curta e simplificada do tema já coberto por `API_REFERENCE.md`.
- `CONFIG_FILES.md` é uma versão mais antiga e mais estreita do tema já coberto por
  `CONFIGURATION.md`.

Estado após consolidação inicial:

- manter `API_REFERENCE.md` como baseline canônico;
- `API.md` foi rebaixado para um wrapper curto de compatibilidade;
- manter `CONFIGURATION.md` como baseline canônico;
- `CONFIG_FILES.md` foi rebaixado para um wrapper curto de compatibilidade;
- qualquer aprofundamento futuro deve convergir para `API_REFERENCE.md` e `CONFIGURATION.md`.

#### Material mal posicionado

- `ALIAS_ANALYSIS_REPORT.md`
- `ALIAS_VALIDATION_REPORT.md`

Motivo:

- ambos têm natureza de relatório de análise/validação concluída;
- hoje servem melhor como registro histórico e não como referência baseline de contrato.

Destino recomendado:

- mover para `RELATORIOS/`, preferencialmente em um agrupamento de análises de qualidade;
- se perderem valor recorrente após consolidação, mover depois para `ARQUIVO_MORTO/`.

#### Checklists que ainda são aceitáveis como referência, mas exigem revisão de papel

- `NERV_INTEGRATION_CHECKLIST.md`
- `REBUILD_READY_CHECKLIST.md`
- `STRICT_MIGRATION_CHECKLIST.md`
- `ESLINT_GUIDE.md`

Leitura:

- podem permanecer em `REFERENCIA/` se forem usados como padrão técnico recorrente;
- se virarem trilha de execução ativa, devem migrar para `PLANOS/`;
- se virarem apenas registro de uma fase já concluída, devem migrar para `RELATORIOS/`.

#### Diagnóstico de maturidade

`REFERENCIA/` já está perto de um baseline estável, mas ainda tem competição entre documentos e
contaminação por material analítico.

### 3. OPERACOES

#### Situação geral

`OPERACOES/` é a categoria com maior mistura entre documentação operacional viva e relatórios de
implementação já encerrada.

Há material claramente útil para operar o sistema, mas também há muitos arquivos que descrevem o que
foi implementado, o que mudou, ou o resultado de uma análise pontual.

#### Manter como baseline operacional

- `DEPLOYMENT.md`
- `DEVCONTAINER.md`
- `LAUNCHER.md`
- `NETWORKING.md`
- `PM2_QUICK_REFERENCE.md`
- `SECURITY.md`
- `CHROME_PROXY_SETUP.md`
- `CHROME_PROXY_INTEGRATION_GUIDE.md`
- `DASHBOARD_PORT_FORWARDING.md`

Motivo:

- continuam orientando execução, setup, acesso, runtime, rede ou operação recorrente;
- pertencem naturalmente à categoria de operação viva.

#### Reescrever com prioridade alta

- `NETWORKING.md`
- `SECURITY.md`
- `LAUNCHER.md`

Motivo:

- `NETWORKING.md` apresenta sinais claros de edição quebrada e referência relativa incorreta;
- `SECURITY.md` está em estilo antigo e contém política genérica demais para o estado atual do
  projeto;
- `LAUNCHER.md` continua útil, mas está com formato antigo e precisa ser alinhado ao padrão
  editorial e à arquitetura atual.

Estado após a rodada mais recente:

- `NETWORKING.md`, `SECURITY.md` e `LAUNCHER.md` já foram reescritos com base no código atual;
- `CHROME_PROXY_SETUP.md`, `CHROME_PROXY_INTEGRATION_GUIDE.md` e `DASHBOARD_PORT_FORWARDING.md`
  também já foram reescritos com base em `ecosystem.config.cjs`, `vite.config.js`,
  `devcontainer.json` e scripts operacionais reais;
- `DEVCONTAINER.md` e `PM2_QUICK_REFERENCE.md` também já foram reescritos;
- a próxima lacuna em `OPERACOES/` passa a ser menos documental e mais de alinhamento entre código,
  Makefile e scripts auxiliares que ainda mantêm drift.

#### Material que deveria sair da navegação viva

- `CHROME_PROXY_CONSOLIDATION_DONE.md`
- `CHROME_PROXY_V2_IMPLEMENTATION.md`
- `DEVCONTAINER_DOCKERFILE_ANALYSIS_V5.md`
- `DEVCONTAINER_REBUILD_ANALYSIS.md`
- `PM2_FILES_CHANGED.md`
- `PM2_IMPLEMENTATION_SUMMARY.md`
- `VITE_DEVCONTAINER_COMPLETE.md`
- `DASHBOARD_CROSS_BROWSER_COMPATIBILITY.md`

Motivo:

- são sumários de implementação, análises de estado, listas de mudança ou validações concluídas;
- não funcionam como baseline de operação contínua;
- ocupam espaço de navegação em uma pasta que deveria privilegiar runbooks vivos.

Destino recomendado:

- mover primeiro para `RELATORIOS/` se ainda forem consultados como evidência de implementação;
- se forem apenas histórico residual, mover para `ARQUIVO_MORTO/`.

#### Diagnóstico de maturidade

`OPERACOES/` é a categoria com maior necessidade de consolidação temática. Hoje ela está funcional,
mas poluída.

## Matriz consolidada de recomendação

### Manter e reescrever

- `GUIAS/QUICK_START.md`
- `GUIAS/DEVELOPMENT.md`
- `GUIAS/TROUBLESHOOTING.md`
- `GUIAS/FAQ.md`
- `GUIAS/MONITORING_GUIDE.md`
- `GUIAS/CONTRIBUTING.md`
- `OPERACOES/NETWORKING.md`
- `OPERACOES/SECURITY.md`
- `OPERACOES/LAUNCHER.md`

### Manter como especializados

- `GUIAS/DEBUG_BROWSER_WINDOWS.md`
- `GUIAS/DEBUG_NODE_INSPECTOR.md`
- `GUIAS/FIX_WINDOWS_ACCESS.md`
- `GUIAS/WSL_INTEGRATION_GUIDE.md`
- `GUIAS/INTEGRACAO_OLLAMA_OPENCODE.md`

### Consolidação inicial já aplicada

- `GUIAS/TESTING.md` -> rebaixado para wrapper de compatibilidade; baseline em `GUIAS/TESTES.md`
- `REFERENCIA/API.md` -> rebaixado para wrapper de compatibilidade; baseline em
  `REFERENCIA/API_REFERENCE.md`
- `REFERENCIA/CONFIG_FILES.md` -> rebaixado para wrapper de compatibilidade; baseline em
  `REFERENCIA/CONFIGURATION.md`

### Reclassificar para `RELATORIOS/`

- `REFERENCIA/ALIAS_ANALYSIS_REPORT.md`
- `REFERENCIA/ALIAS_VALIDATION_REPORT.md`
- `OPERACOES/CHROME_PROXY_CONSOLIDATION_DONE.md`
- `OPERACOES/CHROME_PROXY_V2_IMPLEMENTATION.md`
- `OPERACOES/DEVCONTAINER_DOCKERFILE_ANALYSIS_V5.md`
- `OPERACOES/DEVCONTAINER_REBUILD_ANALYSIS.md`
- `OPERACOES/PM2_FILES_CHANGED.md`
- `OPERACOES/PM2_IMPLEMENTATION_SUMMARY.md`
- `OPERACOES/VITE_DEVCONTAINER_COMPLETE.md`
- `OPERACOES/DASHBOARD_CROSS_BROWSER_COMPATIBILITY.md`

Estado:

- esta reclassificação já foi aplicada;
- o destino canônico passou a ser `RELATORIOS/RECLASSIFICADOS/`;
- os caminhos antigos foram preservados como wrappers curtos de compatibilidade.

## Ordem recomendada de execução

### Fase 1: consolidar baseline (já iniciada)

- `TESTING.md`, `API.md` e `CONFIG_FILES.md` já foram rebaixados para compatibilidade;
- os próximos rewrites de baseline continuam sendo `GUIAS/QUICK_START.md`, `GUIAS/DEVELOPMENT.md`,
  `GUIAS/TROUBLESHOOTING.md`, `GUIAS/FAQ.md` e `GUIAS/MONITORING_GUIDE.md`.

### Fase 2: limpar categoria errada

- os dois relatórios de aliases de `REFERENCIA/` já foram reclassificados;
- os relatórios de implementação de `OPERACOES/` já foram reclassificados;
- a revisão futura passa a ser decidir se parte desse material deve seguir depois para
  `ARQUIVO_MORTO/`.

### Fase 3: normalizar operação viva

- reescrever `NETWORKING.md`;
- reescrever `SECURITY.md`;
- alinhar `LAUNCHER.md`, `CHROME_PROXY_SETUP.md` e `CHROME_PROXY_INTEGRATION_GUIDE.md` ao padrão
  editorial atual;
- revisar se `DASHBOARD_PORT_FORWARDING.md` deve permanecer em `OPERACOES/` ou virar apêndice de
  `DEVCONTAINER.md`.

## Riscos se a consolidação não for feita

- categorias vivas continuarão exibindo múltiplos “baselines” concorrentes;
- `RELATORIOS/` permanecerá subutilizada como destino natural de implementação concluída;
- a navegação parecerá organizada, mas com semântica ainda ambígua;
- agentes de IA e mantenedores humanos continuarão escolhendo documentos errados como fonte da
  verdade.

## Referências relacionadas

- Hub principal: [../README.md](../README.md)
- Status geral: [./STATUS_GERAL_DOCUMENTACAO.md](./STATUS_GERAL_DOCUMENTACAO.md)
- Plano de `README`s:
  [../PLANOS/PLANO_READMES_PADRONIZADOS.md](../PLANOS/PLANO_READMES_PADRONIZADOS.md)
