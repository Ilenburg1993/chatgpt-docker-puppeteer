# tests/integration/server

**Propósito**: Testes de integração do servidor web — dashboard realtime, socket, autenticação e TLS.  
**Status**: Canônico.  
**Público**: Desenvolvedores do módulo `src/server/`.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Testes de contratos do dashboard em tempo real via Socket.io.
- Validação de autenticação, CORS e reconexão de socket.
- Testes de fluxo de comandos de controle e sincronização de tarefas.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `test_dashboard_realtime_contract.spec.js` | Contrato de eventos realtime do dashboard |
| `test_server_engine_tls.spec.js` | Configuração TLS do servidor |
| `test_socket_split_handshake.spec.js` | Handshake do socket splitado |
| `test_socket_split_reconnect.spec.js` | Reconexão de socket |
| `test_wave16r_dashboard_socket_auth_required.spec.js` | Auth obrigatória no socket |
| `test_wave18_dashboard_realtime_control_command_status.spec.js` | Status de comandos de controle |

## Regras de manutenção

- Usar portas efêmeras (0) para evitar conflitos em CI.
- Encerrar servidor e sockets ao final de cada teste.

## Links relacionados

- Testes de integração: `tests/integration/README.md`
- Testes unitários de server: `tests/unit/server/`
