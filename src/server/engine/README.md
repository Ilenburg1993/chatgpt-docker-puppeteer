# src/server/engine

**Propósito**: Componentes core do servidor Express + Socket.io — app, lifecycle e configuração do
socket.  
**Status**: Canônico.  
**Público**: Mantenedores do servidor.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `app.js`: configuração e criação da aplicação Express.
- `server.js`: criação e inicialização do servidor HTTP.
- `socket.js`: configuração do Socket.io no servidor.
- `lifecycle.js`: gerenciamento do ciclo de vida do servidor (start, stop, graceful shutdown).

## O que não deve ficar aqui

- Rotas e controllers → `src/server/api/`
- Middlewares → `src/server/middleware/`
- Funcionalidades realtime → `src/server/realtime/`

## Entradas principais

| Arquivo        | Descrição                              |
| -------------- | -------------------------------------- |
| `app.js`       | Configuração da aplicação Express      |
| `server.js`    | Inicialização do servidor HTTP         |
| `socket.js`    | Configuração do Socket.io              |
| `lifecycle.js` | Ciclo de vida do servidor (start/stop) |

## Regras de manutenção

- Graceful shutdown deve aguardar conexões em andamento antes de encerrar.

## Links relacionados

- Módulo pai: `src/server/`
- Bootstrap: `src/server/main.js`
