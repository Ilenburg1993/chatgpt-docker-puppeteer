**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da subtrilha `src/server/middleware/`.  
**Quando consultar**: ao alterar autenticação, autorização, IDs de requisição, schema guards,
bloqueios em modo delegated ou tratamento global de erro da API.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# SERVER MIDDLEWARE

**Propósito**: documentar `src/server/middleware/` como a malha de guardrails da borda HTTP.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, segurança, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/server/middleware/` protege a superfície HTTP antes que controllers e serviços de domínio
executem regras de negócio. Essa trilha:

- cria rastreabilidade por requisição;
- autentica e autoriza o caller;
- bloqueia mutações quando o modo de operação não permite;
- valida contratos de entrada;
- padroniza falhas e respostas de erro.

Ela é a fronteira de higiene e segurança do servidor.

## Componentes principais

### `request_id.js`

É o ponto de correlação de requisições.

Responsabilidades:

- ler `x-request-id` quando já vier do cliente ou de um proxy;
- validar que o id recebido é um UUID aceitável;
- gerar um novo UUID quando o valor de entrada for ausente ou inválido;
- injetar `req.id`;
- devolver o mesmo valor no header de resposta.

Esse middleware é a base de correlação entre logs, auditoria e resposta HTTP.

### `auth.js`

É a camada de autenticação JWT.

Responsabilidades observáveis:

- validar o bearer token;
- usar o secret centralizado de JWT;
- rejeitar tokens revogados via token blocklist;
- enriquecer `req.user` com identidade, role, roles e permissões;
- oferecer também uma variante opcional que não bloqueia rotas públicas.

É a borda que conecta credenciais HTTP à política interna de RBAC.

### `authorize.js`

É a camada de autorização por permissão.

Responsabilidades:

- exigir que `req.user` já exista;
- consultar `hasPermission()` em `src/server/domain/rbac_policy`;
- rejeitar com `403` quando o caller não tiver a permissão exigida.

### `deny_if_delegated.js`

É um guard de modo operacional.

Responsabilidades:

- inspecionar `authority` em `app.locals` ou em ambiente;
- bloquear operações mutantes quando o servidor está em modo `delegated`;
- preservar o contrato de que certos deployments são observacionais e não soberanos.

### `schema_guard.js`

É o guard de contrato de payload.

Responsabilidades:

- rejeitar payload vazio;
- executar `safeParse` do schema Zod;
- transformar a árvore de erros em uma lista simples e auditável;
- registrar `SCHEMA_VIOLATION` em auditoria;
- substituir `req.body` por `result.data`, já saneado e coerido.

Esse é o principal guard semântico da borda HTTP.

### `error_handler.js`

É o fallback de erro da API.

Responsabilidades:

- transformar 404 em erro padronizado por `notFound`;
- decidir status code final;
- correlacionar a falha com `request_id`;
- registrar log técnico e auditoria para erros críticos;
- ocultar detalhes sensíveis em produção;
- devolver uma resposta uniforme ao cliente.

## Fluxos principais

### Fluxo de entrada autenticada

1. `request_id.js` injeta o identificador de correlação.
2. `auth.js` valida o token e monta `req.user`.
3. `authorize.js` verifica a permissão exigida.
4. `schema_guard.js` valida e saneia o payload.
5. O controller recebe uma requisição já autenticada, autorizada e normalizada.

### Fluxo de bloqueio em modo delegated

1. Uma rota mutante entra no servidor.
2. `deny_if_delegated.js` lê o modo operacional.
3. Se o modo for `delegated`, a mutação é rejeitada.
4. A resposta é devolvida com `403` e `request_id`.

### Fluxo de falha

1. Um middleware ou controller lança erro.
2. `error_handler.js` captura a exceção.
3. O status é normalizado.
4. O erro é logado e, se crítico, auditado.
5. O cliente recebe uma resposta consistente.

## Relação com outros subsistemas

### Server Middleware x Server Domain

- middleware protege a borda;
- `server/domain` aplica regra de negócio após a fronteira já saneada.

### Server Middleware x Infra DB

- autenticação e autorização consultam repositórios como RBAC e token blocklist;
- isso torna a trilha dependente do SSOT para política efetiva de acesso.

### Server Middleware x Dashboard UI / Clientes externos

- qualquer mudança aqui altera diretamente o contrato percebido por UI, scripts e clientes API.

## Restrições e guardrails

- `request_id` deve continuar presente em respostas e logs.
- O guard de schema deve permanecer fail-fast e auditável.
- O modo `delegated` não pode perder seu bloqueio de mutação.
- A autenticação opcional não deve virar bypass para rotas que exigem proteção.
- O handler global de erro não deve vazar stack em produção.

## Sinais de atenção

- respostas sem `x-request-id`;
- rejeições 401/403 inesperadas após mudança em auth;
- payloads chegando crus aos controllers;
- violações de schema sem auditoria;
- mutações indevidas passando em modo `delegated`.

## Referências no código

- `src/server/middleware/request_id.js`
- `src/server/middleware/auth.js`
- `src/server/middleware/authorize.js`
- `src/server/middleware/deny_if_delegated.js`
- `src/server/middleware/schema_guard.js`
- `src/server/middleware/error_handler.js`
