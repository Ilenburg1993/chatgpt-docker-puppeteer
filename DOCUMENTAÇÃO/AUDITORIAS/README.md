# AUDITORIAS

**Propósito**: concentrar auditorias formais, trilhas de bug audit, matrizes de correção e material de rastreabilidade viva do projeto.  
**Status documental**: Canônico.  
**Público**: engenharia, auditoria, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## O que esta pasta contém

- auditorias formais e relatórios de correção;
- trilhas canônicas de bug audit;
- material de validação e rastreabilidade;
- artefatos úteis para acompanhar risco, regressão e evolução de correções.

## Regra de leitura

- auditorias registram o estado observado no momento em que foram produzidas;
- nomes de arquivos, comandos e gaps descritos podem refletir um baseline anterior;
- antes de agir sobre uma recomendação, valide o contrato atual em `GUIAS/`, `OPERACOES/`,
  `REFERENCIA/` e `ARQUITETURA/`.

## O que não deve ficar aqui

- planos ativos de execução futura;
- arquitetura oficial baseline;
- histórico morto sem valor de rastreabilidade viva;
- documentação genérica de operação diária.

## Entradas principais

- [BUGS/](./BUGS/)
- [BUGS/BUG_AUDIT_MASTER.md](./BUGS/BUG_AUDIT_MASTER.md)
- [BUGS/CODEX_AUDIT_TRACKER.md](./BUGS/CODEX_AUDIT_TRACKER.md)

## Subárvores locais

- [BUGS/](./BUGS/): trilha principal de auditoria e acompanhamento de bugs.
- [BUGS/rodadas/README.md](./BUGS/rodadas/README.md): reservado para rodadas específicas e
  snapshots quando necessário.

## Regras de manutenção

- Se o material registra bug audit, rastreabilidade de correção ou evidência de validação, ele tende
  a pertencer aqui.
- Se o conteúdo ainda for proposta ou plano, o local correto tende a ser `PLANOS/`.
- Se a auditoria perdeu valor operacional e virou apenas histórico, o destino correto tende a ser
  `ARQUIVO_MORTO/`.

## Links relacionados

- Hub principal: [../README.md](../README.md)
- Relatórios: [../RELATORIOS/README.md](../RELATORIOS/README.md)
- Arquivo histórico: [../ARQUIVO_MORTO/README.md](../ARQUIVO_MORTO/README.md)
