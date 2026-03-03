# tmp/

**Propósito**: Arquivos temporários gerados durante testes e operações do sistema — bancos de dados de teste, artefatos de test runners e outros dados efêmeros.  
**Status**: Artefato de runtime.  
**Público**: Sistema de testes (uso interno automático).  
**Última atualização**: 2 de março de 2026.

## ⚠️ Não comitar o conteúdo desta pasta

Os arquivos aqui são temporários e **não devem ser commitados**. Estão incluídos no `.gitignore`.

## O que esta pasta contém

| Pasta | Descrição |
|---|---|
| `test-artifacts/` | Artefatos gerados durante a execução dos testes |
| `test-dbs/` | Bancos de dados SQLite temporários usados em testes |

## Regras de manutenção

- Limpos automaticamente a cada execução do test runner
- Use `npm run clean` para limpeza manual

## Links relacionados

- Testes: [`tests/`](../tests/)
- Test tmp: [`tests/tmp/`](../tests/tmp/)
