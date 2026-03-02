# src/driver/guards

**Propósito**: Guards de prontidão do driver — verificam se o browser e o alvo estão prontos para interação.  
**Status**: Canônico.  
**Público**: Mantenedores do pipeline de execução de driver.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `DriverReadinessGuard.js`: verifica pré-condições de prontidão do driver antes da execução.

## O que não deve ficar aqui

- Validadores de pré-condições de negócio → `src/core/validators/`
- Monitoramento de saúde do pool → `src/infra/browser_pool/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `DriverReadinessGuard.js` | Verifica se o driver está pronto para executar ações |

## Regras de manutenção

- Guards devem lançar exceções tipadas ao falhar, não retornar booleanos silenciosos.

## Links relacionados

- Módulo pai: `src/driver/`
- Pool de browsers: `src/infra/browser_pool/`
