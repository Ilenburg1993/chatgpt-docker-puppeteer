# src/shared

**Propósito**: Módulos compartilhados entre domínios — utilitários, IPC, telemetria e componentes
reutilizáveis de browser e NERV.  
**Status**: Canônico de apoio.  
**Público**: Todos os módulos do runtime que precisam de utilitários transversais.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Utilitários de biomecânica de browser (`biomechanics/`) — ver README próprio.
- Utilitários gerais (`utils/`).
- IPC compartilhado: envelopes, schemas e constantes (`ipc/`).
- Telemetria compartilhada (`telemetry/`).
- Componentes NERV compartilhados (`nerv/`) — ver README próprio.
- Estabilizador de página (`page_stability/`) — ver README próprio.
- Analisador SADI (`sadi/`) — ver README próprio.
- Health check de inferência (`health-check.js`).
- Cliente do inference gateway (`inference-gateway-client.js`).
- Utilitários de contexto de execução (`execution_context_filler.js`).

## O que não deve ficar aqui

- Lógica de domínio de missões → `src/missions/`
- Lógica de negócio → `src/logic/`
- Constantes centrais → `src/core/constants/`

## Entradas principais

| Arquivo/Pasta                 | Descrição                                          |
| ----------------------------- | -------------------------------------------------- |
| `utils/`                      | Utilitários gerais de execução                     |
| `ipc/`                        | Envelopes, schemas e constantes IPC compartilhados |
| `telemetry/`                  | Telemetria compartilhada entre módulos             |
| `biomechanics/`               | Simulação de comportamento humano no browser       |
| `nerv/`                       | Componentes NERV compartilhados                    |
| `page_stability/`             | Estabilizador de página de browser                 |
| `sadi/`                       | Analisador SADI                                    |
| `health-check.js`             | Health check do inference gateway                  |
| `inference-gateway-client.js` | Cliente para o gateway de inferência               |

## Regras de manutenção

- Apenas adicione aqui o que for genuinamente transversal a múltiplos domínios.
- Evite criar dependências circulares; `shared/` não deve importar de domínios específicos.

## Links relacionados

- Constantes: `src/core/constants/`
- IPC infra: `src/infra/ipc/`
- Tipos: `src/types/shared/`
