# src/nerv

**Propósito**: Barramento de eventos central (NERV) — conecta todos os módulos do sistema via
eventos desacoplados, com suporte a transporte híbrido, correlação e telemetria.  
**Status**: Canônico.  
**Público**: Todos os módulos do runtime; é a espinha dorsal do sistema.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Factory e composição do barramento (`nerv.js`, `core.js`).
- Discovery de eventos (`discovery.js`).
- Adaptadores de transporte (`adapters/`).
- Buffers e filas de eventos (`buffers/`).
- Correlação e rastreamento de eventos (`correlation/`).
- Emissão de eventos (`emission/`).
- Verificação de saúde do barramento (`health/`).
- Recepção e subscrição de eventos (`reception/`).
- Telemetria IPC e métricas (`telemetry/`).
- Transporte: conexão, framing, reconexão e transporte híbrido (`transport/`).

## O que não deve ficar aqui

- Lógica de domínio de qualquer módulo
- Persistência de dados → `src/infra/`
- Bridges específicas de módulos → `src/driver/nerv_adapter/`, `src/server/nerv_adapter/`,
  `src/kernel/nerv_bridge/`

## Entradas principais

| Arquivo/Pasta  | Descrição                                  |
| -------------- | ------------------------------------------ |
| `nerv.js`      | Factory principal do barramento NERV       |
| `core.js`      | Núcleo de composição do NERV               |
| `emission/`    | Publicação de eventos (emit, ack, command) |
| `reception/`   | Subscrição e recepção de eventos           |
| `transport/`   | Transporte híbrido com reconexão           |
| `buffers/`     | Buffers, backpressure e filas              |
| `correlation/` | Correlação e rastreamento de eventos       |
| `telemetry/`   | Métricas IPC do barramento                 |
| `health/`      | Saúde do barramento                        |

## Regras de manutenção

- Não adicione lógica de domínio aqui; o NERV é apenas transporte e roteamento.
- Todo evento deve ter um nome semântico (ex.: `task:started`, `driver:error`).
- Use correlação via `correlation/` para rastrear fluxos multi-evento.

## Links relacionados

- Bridges: `src/driver/nerv_adapter/`, `src/server/nerv_adapter/`, `src/kernel/nerv_bridge/`
- Compartilhado NERV: `src/shared/nerv/`
- Tipos: `src/types/nerv/`
