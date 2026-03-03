# src/dashboard-ui/src/assets/styles

**Propósito**: Folhas de estilo globais do dashboard — dark theme e configuração Tailwind CSS.  
**Status**: Canônico.  
**Público**: Desenvolvedores frontend.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `dark-theme.css`: variáveis e estilos do tema escuro do dashboard.
- `tailwind.css`: configuração e customizações do Tailwind CSS.

## O que não deve ficar aqui

- Estilos escopados de componentes → `<style scoped>` nos arquivos `.vue`

## Entradas principais

| Arquivo          | Descrição                        |
| ---------------- | -------------------------------- |
| `dark-theme.css` | Tema escuro do dashboard         |
| `tailwind.css`   | Configuração Tailwind CSS global |

## Regras de manutenção

- Variáveis de tema devem ser definidas via CSS custom properties em `dark-theme.css`.

## Links relacionados

- Módulo pai: `src/dashboard-ui/src/assets/`
