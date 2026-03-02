# src/infra/browser_pool

**Propósito**: Gerenciamento do pool de instâncias Chrome — monitoramento de saúde, circuit breaker e validação de páginas.  
**Status**: Canônico.  
**Público**: Mantenedores da infraestrutura de browser e do driver.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `pool_manager.js`: gerenciamento do pool de instâncias Chrome.
- `PageLifecycleMonitor.js`: monitoramento do ciclo de vida de páginas.
- `PageValidator.js`: validação de disponibilidade e saúde de páginas.
- `PeriodicHealthMonitor.js`: verificações periódicas de saúde do pool.
- `circuit_breaker.js`: circuit breaker para proteção contra falhas em cascata.
- `puppeteer_guard.js`: proteção de operações Puppeteer contra erros de protocolo.

## O que não deve ficar aqui

- Automação de browser (cliques, digitação) → `src/driver/`
- Proxy de Chrome → `src/infra/proxy/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `pool_manager.js` | Gerencia o pool de instâncias Chrome disponíveis |
| `circuit_breaker.js` | Protege contra falhas em cascata no pool |
| `PageLifecycleMonitor.js` | Monitora o ciclo de vida de páginas abertas |
| `PageValidator.js` | Valida saúde e disponibilidade de páginas |
| `PeriodicHealthMonitor.js` | Realiza verificações periódicas de saúde |
| `puppeteer_guard.js` | Proteção de operações Puppeteer |

## Regras de manutenção

- Circuit breaker deve ser configurável via `config.json`.
- Eventos de saúde do pool devem ser emitidos via NERV.

## Links relacionados

- Módulo pai: `src/infra/`
- Driver: `src/driver/`
