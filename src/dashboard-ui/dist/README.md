# src/dashboard-ui/public/

**Propósito**: Arquivos estáticos públicos do dashboard frontend — servidos diretamente pelo Vite sem processamento, copiados para `dist/` durante o build.  
**Status**: Canônico de apoio.  
**Público**: Desenvolvedores que trabalham no frontend do dashboard.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

| Arquivo | Descrição |
|---|---|
| `vite.svg` | Ícone padrão do Vite (substituir pelo ícone do projeto) |

## O que não deve ficar aqui

- Arquivos que precisam de processamento (CSS, JS que importam módulos) — ficam em `src/`
- Artefatos de build (ficam em `dist/`)

## Links relacionados

- Dashboard UI: [`src/dashboard-ui/`](../)
- Build output: [`src/dashboard-ui/dist/`](../dist/)
