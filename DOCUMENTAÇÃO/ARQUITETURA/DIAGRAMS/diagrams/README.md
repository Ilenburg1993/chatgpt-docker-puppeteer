# diagrams

**Propósito**: concentrar as fontes temáticas de diagramas auxiliares da arquitetura.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## O que esta pasta contém

- fontes Mermaid e artefatos textuais por fluxo ou recorte específico;
- diagramas de arquitetura de alto nível;
- diagramas de boot, fluxo de dados e conectividade especializada.

## O que não deve ficar aqui

- baseline textual da arquitetura;
- documentação histórica;
- imagens derivadas sem valor como fonte de manutenção.

## Entradas principais

- [architecture.mmd](./architecture.mmd)
- [boot_sequence.mmd](./boot_sequence.mmd)
- [dataflow.mmd](./dataflow.mmd)
- [chrome-proxy-architecture.txt](./chrome-proxy-architecture.txt)

## Regras de manutenção

- Estes arquivos são subfontes do catálogo em [../README.md](../README.md).
- Se um diagrama desta pasta virar a visualização principal de um subsistema, o hub de arquitetura
  deve apontar explicitamente para ele.
- Mantenha nomes coerentes com os documentos que os consomem.

## Links relacionados

- Índice de diagramas: [../README.md](../README.md)
- Documento visual principal: [../../ARCHITECTURE_DIAGRAMS.md](../../ARCHITECTURE_DIAGRAMS.md)
