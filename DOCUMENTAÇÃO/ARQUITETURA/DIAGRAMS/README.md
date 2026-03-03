# DIAGRAMS

**Propósito**: concentrar as fontes editáveis dos diagramas da arquitetura oficial.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## O que esta pasta contém

- arquivos-fonte Mermaid e artefatos textuais usados para representar a arquitetura;
- diagramas em nível de raiz e em subpastas temáticas;
- material que alimenta ou complementa [ARCHITECTURE_DIAGRAMS.md](../ARCHITECTURE_DIAGRAMS.md).

## O que não deve ficar aqui

- explicações textuais longas de arquitetura;
- documentos de decisão;
- relatórios ou análises históricas;
- imagens geradas sem valor como fonte de manutenção.

## Entradas principais

- [diagrama.mmd](./diagrama.mmd)
- [diagrams/architecture.mmd](./diagrams/architecture.mmd)
- [diagrams/boot_sequence.mmd](./diagrams/boot_sequence.mmd)
- [diagrams/dataflow.mmd](./diagrams/dataflow.mmd)
- [diagrams/chrome-proxy-architecture.txt](./diagrams/chrome-proxy-architecture.txt)

## Subárvores locais

- [diagrams/README.md](./diagrams/README.md): fontes temáticas agrupadas por fluxo e recorte.

## Regras de manutenção

- A fonte visual deve permanecer coerente com
  [ARCHITECTURE_DIAGRAMS.md](../ARCHITECTURE_DIAGRAMS.md).
- Se a topologia oficial mudar, atualize primeiro a fonte e depois o documento renderizado.
- Arquivos desta pasta são fonte de manutenção, não substituem a explicação textual do hub de
  arquitetura.

## Links relacionados

- Hub de arquitetura: [../README.md](../README.md)
- Diagramas renderizados e comentados: [../ARCHITECTURE_DIAGRAMS.md](../ARCHITECTURE_DIAGRAMS.md)
