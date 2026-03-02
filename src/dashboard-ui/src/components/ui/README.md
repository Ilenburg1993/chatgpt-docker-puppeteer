# src/dashboard-ui/src/components/ui

**Propósito**: Componentes de UI genéricos e reutilizáveis — primitivos do design system do dashboard.  
**Status**: Canônico.  
**Público**: Desenvolvedores frontend.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `Button.vue`: componente de botão com variantes.
- `Card.vue`: componente de card/painel.
- `Badge.vue`: badge de status e labels.
- `Input.vue`: campo de entrada de texto.
- `Modal.vue`: componente de modal reutilizável.
- `NotificationContainer.vue`: container de notificações toast.

## O que não deve ficar aqui

- Componentes de domínio específico → subpastas de `components/`
- Estilos globais → `src/dashboard-ui/src/assets/styles/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `Button.vue` | Componente de botão |
| `Card.vue` | Componente de card/painel |
| `Modal.vue` | Modal reutilizável |
| `Badge.vue` | Badge de status |
| `NotificationContainer.vue` | Container de notificações toast |

## Regras de manutenção

- Componentes UI devem ser genéricos e sem dependência de domínio.
- Use props e slots para customização; evite hardcodes de conteúdo.

## Links relacionados

- Módulo pai: `src/dashboard-ui/src/components/`
