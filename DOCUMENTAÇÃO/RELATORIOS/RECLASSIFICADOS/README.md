# Reclassificados

**Propósito**: concentrar relatórios e análises que foram removidos de categorias vivas como
`REFERENCIA/` e `OPERACOES/`, mas que ainda possuem valor de consulta recorrente.  
**Status documental**: Canônico.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## O que há aqui

- relatórios de implementação concluída;
- análises e validações técnicas que não devem competir com o baseline vivo;
- material reclassificado para reduzir ambiguidade nas categorias canônicas.

## Origem do material

- relatórios de aliases antes alojados em `REFERENCIA/`;
- relatórios de implementação e análise antes alojados em `OPERACOES/`.

## Regras de manutenção

- Se o documento registrar “o que foi implementado”, “o que mudou” ou “o que foi validado”, ele
  tende a caber aqui.
- Se o material perder valor recorrente e virar apenas histórico residual, ele deve migrar depois
  para `ARQUIVO_MORTO/`.
- Os caminhos antigos podem permanecer como wrappers curtos de compatibilidade, mas a cópia canônica
  passa a ser a desta pasta.
- Como regra, trate estes arquivos como registro analítico: valide qualquer instrução operacional no
  baseline canônico antes de reutilizá-la.

## Entradas principais

- [ALIAS_ANALYSIS_REPORT.md](./ALIAS_ANALYSIS_REPORT.md)
- [ALIAS_VALIDATION_REPORT.md](./ALIAS_VALIDATION_REPORT.md)
- [CHROME_PROXY_CONSOLIDATION_DONE.md](./CHROME_PROXY_CONSOLIDATION_DONE.md)
- [CHROME_PROXY_V2_IMPLEMENTATION.md](./CHROME_PROXY_V2_IMPLEMENTATION.md)
- [DEVCONTAINER_DOCKERFILE_ANALYSIS_V5.md](./DEVCONTAINER_DOCKERFILE_ANALYSIS_V5.md)
- [DEVCONTAINER_REBUILD_ANALYSIS.md](./DEVCONTAINER_REBUILD_ANALYSIS.md)
- [PM2_FILES_CHANGED.md](./PM2_FILES_CHANGED.md)
- [PM2_IMPLEMENTATION_SUMMARY.md](./PM2_IMPLEMENTATION_SUMMARY.md)
- [VITE_DEVCONTAINER_COMPLETE.md](./VITE_DEVCONTAINER_COMPLETE.md)
- [DASHBOARD_CROSS_BROWSER_COMPATIBILITY.md](./DASHBOARD_CROSS_BROWSER_COMPATIBILITY.md)

## Links relacionados

- Relatórios: [../README.md](../README.md)
- Hub principal: [../../README.md](../../README.md)
