# TECHNICAL

**Propósito**: concentrar notas técnicas de trabalho, materiais de migração e análises ainda não
promovidas ao baseline canônico da arquitetura.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## O que esta pasta contém

- notas técnicas de apoio;
- análises intermediárias ainda úteis;
- materiais de migração e ondas de mudança;
- documentação estrutural que ainda não foi promovida para os documentos canônicos principais.

## O que não deve ficar aqui

- baseline oficial da arquitetura;
- documentação histórica já superseded;
- relatórios gerais sem foco técnico local;
- rascunhos voláteis sem utilidade recorrente.

## Entradas principais

- [ONDA2_NERV_MIGRATION.md](./ONDA2_NERV_MIGRATION.md)
- [NERV/ANALISE_NERV_ENVELOPE.md](./NERV/ANALISE_NERV_ENVELOPE.md)

## Subárvores locais

- [NERV/README.md](./NERV/README.md): análises técnicas intermediárias específicas do barramento.

## Regras de manutenção

- Se o conteúdo virar parte estável da arquitetura oficial, ele deve ser promovido para a raiz de
  `ARQUITETURA/` ou para `SUBSISTEMAS/`.
- Se o material perder valor e virar apenas histórico, o destino correto passa a ser
  `ARQUIVO_MORTO/`.
- Esta pasta é de apoio técnico, não de baseline estrutural.

## Links relacionados

- Hub de arquitetura: [../README.md](../README.md)
- Arquitetura oficial: [../ARCHITECTURE.md](../ARCHITECTURE.md)
- Histórico arquivado:
  [../../ARQUIVO_MORTO/ARQUITETURA_HISTORICA/README.md](../../ARQUIVO_MORTO/ARQUITETURA_HISTORICA/README.md)
