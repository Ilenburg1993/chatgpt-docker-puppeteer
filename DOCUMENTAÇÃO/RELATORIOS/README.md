# RELATORIOS

**Propósito**: concentrar relatórios, sumários, análises, consolidações e registros de implementação
com valor de consulta contínua.  
**Status documental**: Canônico.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## O que esta pasta contém

- relatórios de implementação e validação;
- análises técnicas e consolidações;
- sumários executivos e diagnósticos;
- registros transversais de status e evolução;
- material analítico ainda útil, mesmo quando não é o documento de operação principal.

## Regra de leitura

- muitos arquivos aqui são análises `point-in-time`;
- comandos, caminhos e exemplos antigos devem ser validados contra `GUIAS/`, `OPERACOES/`,
  `REFERENCIA/` e `ARQUITETURA/` antes de execução;
- quando houver conflito entre um relatório e um documento canônico vivo, o documento canônico vivo
  prevalece.

## O que não deve ficar aqui

- planos que ainda guiam execução futura;
- arquitetura oficial baseline;
- guias de uso diário;
- histórico morto sem valor de consulta recorrente.

## Entradas principais

- [STATUS_GERAL_DOCUMENTACAO.md](./STATUS_GERAL_DOCUMENTACAO.md)
- [AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md](./AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md)
- [RECLASSIFICADOS/README.md](./RECLASSIFICADOS/README.md)
- [FINAL_CONSOLIDATED_REPORT.md](./FINAL_CONSOLIDATED_REPORT.md)
- [SUMMARY.md](./SUMMARY.md)
- [RELATORIO_CONSOLIDACAO_2026.md](./RELATORIO_CONSOLIDACAO_2026.md)
- [SYSTEM_ANALYSIS_COMPLETE.md](./SYSTEM_ANALYSIS_COMPLETE.md)

## Famílias de relatório nesta pasta

- Consolidação e status:
  - [STATUS_GERAL_DOCUMENTACAO.md](./STATUS_GERAL_DOCUMENTACAO.md)
  - [AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md](./AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md)
  - [RECLASSIFICADOS/README.md](./RECLASSIFICADOS/README.md)
  - [FINAL_CONSOLIDATED_REPORT.md](./FINAL_CONSOLIDATED_REPORT.md)
  - [SUMMARY.md](./SUMMARY.md)
  - [EXECUTIVE_SUMMARY_MIGRACAO.md](./EXECUTIVE_SUMMARY_MIGRACAO.md)
- Bugs e correções:
  - [BUG_FIXES_FINAL_REPORT.md](./BUG_FIXES_FINAL_REPORT.md)
  - [BUG_FIXES_SUMMARY.md](./BUG_FIXES_SUMMARY.md)
  - [BOOT_FIXES_IMPLEMENTED.md](./BOOT_FIXES_IMPLEMENTED.md)
  - [BOOT_FIXES_SUMMARY.md](./BOOT_FIXES_SUMMARY.md)
- Análises técnicas:
  - [ANALISE_TECNICA.md](./ANALISE_TECNICA.md)
  - [GAP_ANALYSIS.md](./GAP_ANALYSIS.md)
  - [INTEGRATION_GAP_ANALYSIS.md](./INTEGRATION_GAP_ANALYSIS.md)
  - [DEPENDENCIES_ANALYSIS.md](./DEPENDENCIES_ANALYSIS.md)
  - [DEPENDENCY_UPGRADE_RISK_ANALYSIS.md](./DEPENDENCY_UPGRADE_RISK_ANALYSIS.md)

## Subárvores locais

- [RESUMOS_TECNICOS/README.md](./RESUMOS_TECNICOS/README.md): agregados técnicos canônicos e
  material legado consolidado por subpastas.
- [RECLASSIFICADOS/README.md](./RECLASSIFICADOS/README.md): relatórios removidos de categorias vivas
  para reduzir ambiguidade sem perder rastreabilidade.

## Regras de manutenção

- Se o documento descreve “o que foi feito”, “o que foi observado”, “qual foi o resultado” ou “qual
  é o estado consolidado”, ele tende a pertencer aqui.
- Se o documento ainda estiver guiando trabalho futuro, ele deve ir para `PLANOS/`.
- Se o documento deixou de ter valor de consulta contínua e ficou apenas histórico, ele deve migrar
  para `ARQUIVO_MORTO/`.

## Links relacionados

- Hub principal: [../README.md](../README.md)
- Planos: [../PLANOS/README.md](../PLANOS/README.md)
- Resumos técnicos: [./RESUMOS_TECNICOS/README.md](./RESUMOS_TECNICOS/README.md)
