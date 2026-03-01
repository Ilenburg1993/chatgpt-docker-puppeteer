# Plano de Consolidação das Categorias Vivas

**Propósito**: organizar a próxima fase de limpeza semântica em `GUIAS/`, `REFERENCIA/` e
`OPERACOES/`, com foco em consolidar baselines, mover relatórios para a categoria correta e reduzir
ambiguidade documental.  
**Status documental**: Canônico.  
**Público**: engenharia, governança documental, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Contexto

Após a conclusão da cobertura estrutural de `README.md` em toda a árvore `DOCUMENTAÇÃO/`, o gap
principal deixou de ser navegação e passou a ser qualidade e classificação de conteúdo.

A auditoria que fundamenta este plano é:

- [../RELATORIOS/AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md](../RELATORIOS/AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md)

## Objetivo

Chegar a um estado em que:

- cada categoria viva tenha um baseline claro;
- documentos concorrentes deixem de disputar o mesmo papel;
- relatórios e análises concluídas saiam da navegação principal;
- o conteúdo remanescente siga o mesmo padrão editorial adotado na arquitetura.

## Escopo

Dentro do escopo:

- `DOCUMENTAÇÃO/GUIAS/`
- `DOCUMENTAÇÃO/REFERENCIA/`
- `DOCUMENTAÇÃO/OPERACOES/`
- `DOCUMENTAÇÃO/RELATORIOS/` como destino de material reclassificado
- `DOCUMENTAÇÃO/ARQUIVO_MORTO/` como destino final de histórico residual

Fora do escopo:

- novas reorganizações amplas de `ARQUITETURA/`
- refatoração de código
- criação do lote inicial de ADRs em `DECISOES/`
- reorganização adicional de `tests/`

## Frentes de trabalho

### 1. Consolidação de baseline

Status desta frente:

- etapa inicial já aplicada nesta rodada;
- os três documentos legados permanecem apenas como wrappers de compatibilidade.

Escopo executado:

- fundir `GUIAS/TESTING.md` em `GUIAS/TESTES.md`;
- fundir `REFERENCIA/API.md` em `REFERENCIA/API_REFERENCE.md`;
- fundir `REFERENCIA/CONFIG_FILES.md` em `REFERENCIA/CONFIGURATION.md`.

Resultado esperado:

- um único documento baseline por tema principal;
- redução explícita de duplicidade dentro das categorias vivas.

### 2. Reclassificação de relatórios

Status desta frente:

- aplicada nesta rodada para os relatórios identificados na auditoria;
- os caminhos antigos permanecem como wrappers curtos de compatibilidade;
- o destino canônico passa a ser `RELATORIOS/RECLASSIFICADOS/`.

Mover de `REFERENCIA/` para `RELATORIOS/`:

- `ALIAS_ANALYSIS_REPORT.md`
- `ALIAS_VALIDATION_REPORT.md`

Mover de `OPERACOES/` para `RELATORIOS/`:

- `CHROME_PROXY_CONSOLIDATION_DONE.md`
- `CHROME_PROXY_V2_IMPLEMENTATION.md`
- `DEVCONTAINER_DOCKERFILE_ANALYSIS_V5.md`
- `DEVCONTAINER_REBUILD_ANALYSIS.md`
- `PM2_FILES_CHANGED.md`
- `PM2_IMPLEMENTATION_SUMMARY.md`
- `VITE_DEVCONTAINER_COMPLETE.md`
- `DASHBOARD_CROSS_BROWSER_COMPATIBILITY.md`

Resultado esperado:

- `OPERACOES/` volta a priorizar runbooks vivos;
- `REFERENCIA/` volta a priorizar contratos e consulta estável;
- `RELATORIOS/` absorve o que já tem natureza analítica ou de implementação concluída.

### 3. Reescrita dos documentos vivos mais frágeis

Status desta frente:

- já iniciada;
- `OPERACOES/NETWORKING.md`, `OPERACOES/SECURITY.md` e `OPERACOES/LAUNCHER.md` foram reescritos
  com base no código atual;
- o lote principal de `GUIAS/` já foi reescrito com checagem contra `package.json`, `Makefile`,
  scripts de health/env e rotas reais do backend;
- o lote principal de `OPERACOES/` especializado também já foi reescrito com checagem contra
  `ecosystem.config.cjs`, `vite.config.js`, `devcontainer.json` e scripts reais;
- `GUIAS/CONTRIBUTING.md` também já foi reescrito com base nos templates e scripts reais;
- `OPERACOES/DEVCONTAINER.md` e `OPERACOES/PM2_QUICK_REFERENCE.md` também já foram reescritos com
  exposição explícita dos drifts remanescentes;
- os drifts principais do `Makefile` e dos scripts PM2 também já foram corrigidos;
- o próximo lote prioritário fica concentrado na link hygiene global e, depois, na revisão dos
  helpers legados restantes.

Prioridade alta já executada:

- `GUIAS/QUICK_START.md`
- `GUIAS/DEVELOPMENT.md`
- `GUIAS/TROUBLESHOOTING.md`
- `GUIAS/FAQ.md`
- `GUIAS/MONITORING_GUIDE.md`

Próximo lote prioritário:

- passada global de link hygiene em `DOCUMENTAÇÃO/`
- revisão/correção dos drifts operacionais documentados

Resultado esperado:

- mesmos padrões editoriais da arquitetura;
- links consistentes;
- linguagem em pt-BR;
- conteúdo alinhado à árvore real e ao runtime atual.

### 4. Revisão fina de guias especializados

Revisar posicionamento e cabeçalho de:

- `DEBUG_BROWSER_WINDOWS.md`
- `DEBUG_NODE_INSPECTOR.md`
- `FIX_WINDOWS_ACCESS.md`
- `WSL_INTEGRATION_GUIDE.md`
- `INTEGRACAO_OLLAMA_OPENCODE.md`
- `CHROME_PROXY_SETUP.md`
- `CHROME_PROXY_INTEGRATION_GUIDE.md`
- `DASHBOARD_PORT_FORWARDING.md`

Resultado esperado:

- permanecem como especializados, sem competir com baseline;
- passam a apontar claramente para os documentos principais da categoria.

## Ordem recomendada

1. Reescrever os documentos vivos prioritários.
2. Ajustar hubs e `README.md` das categorias.
3. Fazer uma passada de link hygiene final.

## Critérios de aceitação

- `GUIAS/`, `REFERENCIA/` e `OPERACOES/` deixam de ter pares óbvios de documento concorrente.
- Os relatórios listados acima deixam de ocupar navegação primária em categorias vivas.
- `RELATORIOS/README.md` passa a listar explicitamente o material reclassificado.
- Os documentos reescritos adotam o cabeçalho padrão:
  - propósito
  - status documental
  - público
  - última atualização
- As categorias vivas passam a usar linguagem e links coerentes com `DOCUMENTAÇÃO/README.md`.

## Riscos e guardrails

- Não apagar documento só por parecer redundante; consolidar primeiro, arquivar depois.
- Se houver dúvida entre `RELATORIOS/` e `ARQUIVO_MORTO/`, mover primeiro para `RELATORIOS/`.
- Não misturar esta fase com refatoração estrutural adicional da árvore.
- Manter os nomes dos arquivos estáveis enquanto o conteúdo estiver sendo consolidado, para reduzir
  churn de links.

## Referências relacionadas

- Auditoria-base: [../RELATORIOS/AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md](../RELATORIOS/AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md)
- Status geral: [../RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md](../RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md)
- Hub principal: [../README.md](../README.md)
