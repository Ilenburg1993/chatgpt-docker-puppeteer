# tools/outputs

**Propósito**: Saídas geradas por ferramentas de análise do projeto — estrutura de arquivos e
mapeamentos.  
**Status**: Canônico de apoio.  
**Público**: Desenvolvedores consultando snapshots de estrutura do projeto.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Arquivos gerados automaticamente por ferramentas de análise — não editar manualmente.

## Entradas principais

| Arquivo                 | Descrição                                      |
| ----------------------- | ---------------------------------------------- |
| `estrutura_projeto.txt` | Snapshot da estrutura de diretórios do projeto |

## Regras de manutenção

- Não commitar arquivos gerados que mudam a cada execução — apenas snapshots estáveis.
- Regenerar via `tools/mapeador_projeto.py`.

## Links relacionados

- Ferramentas pai: `tools/README.md`
