# src/dashboard-ui/dist/assets/

**Propósito**: Assets compilados e otimizados do dashboard frontend — JavaScript bundles, CSS e outros recursos gerados pelo Vite durante o build de produção.  
**Status**: Artefato de runtime (build).  
**Público**: Servidor Express (uso interno). Desenvolvedores que inspecionam o bundle.  
**Última atualização**: 2 de março de 2026.

## ⚠️ Não comitar o conteúdo desta pasta

Os arquivos aqui são gerados pelo build e **não devem ser commitados**.

## O que esta pasta contém

Arquivos JavaScript e CSS com hash de conteúdo no nome (cache-busting), em versões raw, Brotli (`.br`) e Gzip (`.gz`).

## Links relacionados

- Pasta pai: [`dist/`](../README.md)
- Build: `npm run build` em `src/dashboard-ui/`
