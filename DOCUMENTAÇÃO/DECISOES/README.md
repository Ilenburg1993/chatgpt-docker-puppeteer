# DECISOES

**Propósito**: servir como espaço canônico para ADRs e registros explícitos de decisões estruturais do projeto.  
**Status documental**: Canônico.  
**Público**: engenharia, manutenção, governança técnica e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## O que esta pasta contém

No momento, esta pasta está reservada para:

- ADRs formais;
- decisões estruturais de arquitetura;
- decisões transversais de governança técnica;
- registros curtos de “decidimos X, por Y, com as seguintes consequências”.

## Estado atual

Esta pasta ainda está vazia de conteúdo final e representa um gap de governança já identificado.

Isso significa:

- a categoria existe e é canônica;
- o formato está definido em intenção;
- a população inicial de ADRs ainda precisa ser feita.

## O que não deve ficar aqui

- planos de execução futura;
- relatórios de implementação;
- análise histórica extensa sem decisão explícita;
- documentação de arquitetura baseline inteira.

## Uso recomendado

Quando uma decisão deixa de ser apenas uma conversa ou uma implementação implícita, ela deve ganhar
um registro aqui.

O registro ideal deve responder:

1. Qual decisão foi tomada.
2. Qual contexto exigiu a decisão.
3. Quais alternativas foram consideradas.
4. Quais são as consequências técnicas.

## Regras de manutenção

- `DECISOES/` não deve virar pasta de rascunhos longos.
- Cada decisão deve ser curta, explícita e orientada a consequência.
- Se uma proposta ainda não foi decidida, o lugar primário continua sendo `PLANOS/`.
- Se a decisão for apenas histórica e já superseded, ela pode ir para `ARQUIVO_MORTO/`.

## Links relacionados

- Hub principal: [../README.md](../README.md)
- Arquitetura oficial: [../ARQUITETURA/README.md](../ARQUITETURA/README.md)
- Planos ativos: [../PLANOS/README.md](../PLANOS/README.md)
