# src/dashboard-ui/dist/

**Propósito**: Build de produção do dashboard frontend — gerado pelo Vite a partir do código-fonte em `src/dashboard-ui/src/`. Servido como conteúdo estático pelo servidor Express.  
**Status**: Artefato de runtime (build).  
**Público**: Servidor Express (uso interno). Desenvolvedores que fazem deploy do dashboard.  
**Última atualização**: 2 de março de 2026.

## ⚠️ Não comitar o conteúdo desta pasta

Os arquivos aqui são gerados automaticamente pelo build e **não devem ser commitados**. Estão incluídos no `.gitignore`.

## O que esta pasta contém

- `index.html` — Entry point do SPA (com variantes comprimidas `.br`, `.gz`)
- `assets/` — JavaScript, CSS e outros assets compilados e otimizados
- `vite.svg` — Ícone do Vite

## Regras de manutenção

- Regenerar com `npm run build` dentro de `src/dashboard-ui/`
- Os arquivos `.br` e `.gz` são versões pré-comprimidas para serving otimizado

## Links relacionados

- Código-fonte: [`src/dashboard-ui/src/`](../src/)
- Assets compilados: [`src/dashboard-ui/dist/assets/`](./assets/README.md)
- Servidor: [`src/server/`](../../server/)
