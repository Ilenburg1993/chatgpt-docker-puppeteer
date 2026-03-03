# src/dashboard-ui/src/composables

**Propósito**: Composables Vue com Composition API — lógica reutilizável de autenticação, realtime,
socket, auditoria e preferências de UI.  
**Status**: Canônico.  
**Público**: Desenvolvedores frontend.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `useAuth.js`: gerenciamento de autenticação e sessão do usuário.
- `useRealtime.js`: conexão e dados em tempo real via Socket.io.
- `useSocket.js`: gerenciamento da conexão Socket.io.
- `useSsotRealtime.js`: feed de eventos SSOT em tempo real.
- `useAudit.js`: dados e operações de auditoria.
- `useNotifications.js`: sistema de notificações toast.
- `useUiPreferences.js`: preferências de interface do usuário.

## O que não deve ficar aqui

- Estado global persistente → `src/dashboard-ui/src/stores/`
- Utilitários HTTP → `src/dashboard-ui/src/lib/http.js`

## Entradas principais

| Arquivo               | Descrição                         |
| --------------------- | --------------------------------- |
| `useAuth.js`          | Autenticação e sessão             |
| `useRealtime.js`      | Dados em tempo real via Socket.io |
| `useSocket.js`        | Conexão Socket.io                 |
| `useSsotRealtime.js`  | Feed de eventos SSOT              |
| `useNotifications.js` | Notificações toast                |

## Regras de manutenção

- Composables devem retornar refs e funções; não devem ter side effects no import.
- Use `onUnmounted` para limpar subscriptions e listeners.

## Links relacionados

- Módulo pai: `src/dashboard-ui/src/`
- Stores: `src/dashboard-ui/src/stores/`
