# src/server/supervisor

**Propósito**: Supervisor de processos do servidor — reconciliação de estado e remediação automática
de falhas.  
**Status**: Canônico.  
**Público**: Mantenedores de confiabilidade operacional (SRE).  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `reconcilier.js`: reconcilia o estado desejado com o estado real do sistema.
- `remediation.js`: aplica ações corretivas automaticamente quando detecta desvios.

## O que não deve ficar aqui

- Watchdogs de agente → `src/agent/attempt_watchdog.js`, `src/agent/heartbeat_watchdog.js`
- Circuit breaker de infra → `src/infra/browser_pool/circuit_breaker.js`

## Entradas principais

| Arquivo          | Descrição                                        |
| ---------------- | ------------------------------------------------ |
| `reconcilier.js` | Reconcilia estado desejado vs estado real        |
| `remediation.js` | Aplica correções automáticas a desvios de estado |

## Regras de manutenção

- Ações de remediação devem ser idempotentes.
- Emita eventos NERV para cada ação de remediação tomada.

## Links relacionados

- Módulo pai: `src/server/`
- Watchdogs: `src/agent/`
