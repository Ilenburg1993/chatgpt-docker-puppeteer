# src/server/middleware

**Propósito**: Middlewares Express do servidor — autenticação, autorização RBAC, validação de
schema, tratamento de erros e request ID.  
**Status**: Canônico.  
**Público**: Mantenedores da API e da segurança do servidor.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `auth.js`: middleware de autenticação JWT.
- `authorize.js`: middleware de autorização baseada em papéis (RBAC).
- `deny_if_delegated.js`: bloqueia ações delegadas não autorizadas.
- `error_handler.js`: handler centralizado de erros Express.
- `request_id.js`: geração e propagação de request ID.
- `schema_guard.js`: validação de schema de entrada com Zod.

## O que não deve ficar aqui

- Lógica de domínio → `src/server/domain/`
- Políticas RBAC → `src/server/domain/rbac_policy.js`

## Entradas principais

| Arquivo            | Descrição                                  |
| ------------------ | ------------------------------------------ |
| `auth.js`          | Autenticação JWT                           |
| `authorize.js`     | Autorização RBAC por rota                  |
| `schema_guard.js`  | Validação de schema de entrada (Zod)       |
| `error_handler.js` | Handler centralizado de erros              |
| `request_id.js`    | Geração de request ID único por requisição |

## Regras de manutenção

- `schema_guard.js` deve ser aplicado em todas as rotas que recebem body.
- `error_handler.js` deve ser o último middleware registrado no Express.

## Links relacionados

- Módulo pai: `src/server/`
- JWT: `src/core/jwt_config.js`
- RBAC: `src/server/domain/rbac_policy.js`
