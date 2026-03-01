# Plano de READMEs Padronizados

**Propósito**: orientar a criação futura de `README.md` em cada pasta da documentação e, quando fizer sentido, em outras áreas estruturais do repositório.  
**Status documental**: Canônico.  
**Público**: engenharia, governança documental e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Objetivo

Criar `README.md` padronizados por diretório, de forma progressiva e sustentável, para que cada
pasta relevante tenha:

- contexto local;
- escopo claro;
- links de entrada;
- regras básicas de manutenção;
- menor ambiguidade para humanos e LLMs.

## Princípio de execução

Não fazer isso em uma passada única e cega.

Faremos em ondas, priorizando diretórios ativos e de alto valor de navegação, depois subpastas
vivas, e só então subpastas históricas.

## Onda 1: categorias canônicas ativas

Prioridade:

- `DOCUMENTAÇÃO/GUIAS`
- `DOCUMENTAÇÃO/OPERACOES`
- `DOCUMENTAÇÃO/PLANOS`
- `DOCUMENTAÇÃO/REFERENCIA`
- `DOCUMENTAÇÃO/RELATORIOS`
- `DOCUMENTAÇÃO/DECISOES`
- `DOCUMENTAÇÃO/ARQUITETURA/DIAGRAMS`
- `DOCUMENTAÇÃO/ARQUITETURA/TECHNICAL`

Meta:

- cada pasta deve ganhar um `README.md` que funcione como índice local real.

Status:

- concluída nesta rodada.

## Onda 2: subpastas vivas especializadas

Prioridade:

- `DOCUMENTAÇÃO/REFERENCIA/INTEGRACOES`
- `DOCUMENTAÇÃO/RELATORIOS/RESUMOS_TECNICOS`
- `DOCUMENTAÇÃO/AUDITORIAS/BUGS/rodadas`
- subpastas técnicas estáveis que já tenham volume suficiente

Meta:

- contextualizar subárvores densas sem duplicar o hub principal.

Status:

- concluída nesta rodada para o primeiro lote prioritário.

## Onda 3: subpastas históricas

Prioridade:

- subpastas de `DOCUMENTAÇÃO/ARQUIVO_MORTO`

Meta:

- `README`s mínimos e objetivos, deixando explícito que o conteúdo é histórico e não canônico.

Status:

- concluída nesta rodada.

## Template recomendado para diretórios ativos

1. Título
2. Propósito
3. Status documental
4. Público
5. O que esta pasta contém
6. O que não deve ficar aqui
7. Entradas principais
8. Regras de manutenção
9. Links relacionados

## Template recomendado para diretórios históricos

1. Título
2. Natureza histórica
3. O que há aqui
4. O que não é canônico
5. Relação com a documentação viva

## Regras de qualidade

- O `README` deve ser curto o suficiente para navegação e claro o suficiente para decisão.
- Não duplicar um documento canônico inteiro dentro do `README`.
- O `README` deve apontar para documentos principais, não reescrevê-los.
- Se a pasta for puramente operacional ou histórica, isso deve estar explícito.

## Dependências para a próxima fase

- Usar a skill `readme-standardization` para criar os `README`s com formato consistente.
- Revisar, junto com cada `README`, se existem arquivos que ainda estão na pasta errada.
- Atualizar os hubs superiores quando uma nova subárvore passar a ter índice local.

## Estado atual do rollout

- Onda 1: concluída.
- Onda 2: concluída para o lote prioritário.
- Onda 3: concluída.
- Cobertura estrutural: toda a árvore `DOCUMENTAÇÃO/` agora possui `README.md`.

## Próximo foco recomendado

Com a cobertura estrutural concluída, a próxima fase deixa de ser “criar READMEs” e passa a ser:

- revisar profundidade e precisão dos `README`s recém-criados;
- elevar categorias densas ao mesmo padrão editorial;
- consolidar conteúdo canônico e podar duplicatas/obsolescência.

## Referências relacionadas

- Status geral da documentação: [../RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md](../RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md)
- Hub principal: [../README.md](../README.md)
