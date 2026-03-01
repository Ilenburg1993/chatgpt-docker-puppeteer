# Segurança Operacional do Runtime

**Propósito**: documentar os controles de segurança observáveis no servidor HTTP e no dashboard, com
base no código atual.  
**Status documental**: Canônico.  
**Público**: engenharia, operação, revisão de segurança e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Escopo

Este documento descreve o que o runtime **efetivamente faz hoje**, principalmente em:

- [app.js](/workspaces/chatgpt-docker-puppeteer/src/server/engine/app.js)
- [auth.js](/workspaces/chatgpt-docker-puppeteer/src/server/middleware/auth.js)
- [main.js](/workspaces/chatgpt-docker-puppeteer/src/server/main.js)

Ele não substitui uma política organizacional de disclosure externa. O foco aqui é o comportamento
real do servidor.

## Controles de segurança ativos

### 1. Headers HTTP e hardening base

O servidor aplica `helmet` por padrão em
[app.js](/workspaces/chatgpt-docker-puppeteer/src/server/engine/app.js).

Controles observados:

- `Content-Security-Policy` explícita;
- `frameguard` com `deny`;
- `referrerPolicy` com `strict-origin-when-cross-origin`;
- `HSTS` quando `NODE_ENV=production` ou `FORCE_HTTPS=true`.

Observação importante:

- a CSP atual permite `'unsafe-inline'` para scripts e estilos por compatibilidade com dashboard e
  build frontend;
- isso é um compromisso operacional, não o estado mais restritivo possível.

### 2. Trust proxy

O app define política explícita de proxy:

- produção: `trust proxy = 1`
- não produção: `trust proxy = loopback`

Isso evita assumir qualquer proxy upstream como confiável por padrão fora de produção.

### 3. CORS controlado por configuração

O CORS é configurado dinamicamente em
[app.js](/workspaces/chatgpt-docker-puppeteer/src/server/engine/app.js).

Origens aceitas observadas:

- `http://localhost:3008`
- `http://127.0.0.1:3008`
- `DASHBOARD_ORIGIN` quando definido
- entradas adicionais vindas de `CONFIG.ALLOWED_ORIGINS`

Headers permitidos:

- `Content-Type`
- `Authorization`
- `X-Request-ID`

### 4. Rate limiting

O servidor aplica `express-rate-limit` como `apiLimiter`.

Defaults observados:

- produção: `100` req/min por IP, salvo override em `RATE_LIMIT_MAX`
- não produção: `2000` req/min por IP, salvo override em `RATE_LIMIT_MAX_DEV`

O objetivo atual é:

- manter proteção ligada em desenvolvimento;
- ser mais permissivo sem desabilitar o controle.

### 5. Parsing defensivo de requests

O app rejeita requests mutantes com content type inadequado:

- para métodos não `GET`, se o `content-type` não incluir `application/json`, retorna `415`.

Além disso:

- `express.json({ limit: '10mb', strict: true })`
- `express.urlencoded({ extended: false, limit: '1mb' })`

### 6. Request traceability

O runtime injeta:

- `request_id` via middleware dedicado;
- `X-Response-Time` em cada resposta.

Isso melhora auditoria e troubleshooting sem depender só de logs PM2.

## Autenticação do dashboard

### Contrato de boot

Em [main.js](/workspaces/chatgpt-docker-puppeteer/src/server/main.js), o bootstrap valida a
configuração do dashboard antes de aceitar o runtime.

Regras observadas:

- `DASHBOARD_AUTH_REQUIRED` defaulta para `true`;
- `DASHBOARD_SOCKET_AUTH_REQUIRED` defaulta para `true`;
- se auth HTTP estiver habilitada:
  - `DASHBOARD_AUTH_USERNAME` é obrigatório;
  - `DASHBOARD_AUTH_PASSWORD` deve ter ao menos `12` caracteres;
- o bootstrap também exige um JWT secret válido via `getJwtSecret()`.

Leitura prática:

- o estado seguro padrão é com autenticação ligada;
- a documentação antiga que tratava auth como opcional por padrão está incorreta.

### Middleware de autenticação

O middleware canônico é
[auth.js](/workspaces/chatgpt-docker-puppeteer/src/server/middleware/auth.js).

Comportamento observado:

- exige header `Authorization: Bearer <token>`;
- verifica JWT com secret centralizado;
- recusa tokens revogados;
- adiciona `req.user` com papel, roles e permissões;
- retorna `401` para token ausente, inválido ou expirado.

### Autorização

Além de autenticação:

- há middleware de role e permissões;
- várias rotas de dashboard/control usam autenticação obrigatória;
- o runtime também aplica bloqueios extras quando o server está em modo `delegated`.

## Socket.IO e autenticação de tempo real

O plano de tempo real em
[socket.js](/workspaces/chatgpt-docker-puppeteer/src/server/engine/socket.js) também trata
autorização.

Sinais observados:

- `authRequired` configurável;
- handshake com token;
- falha explícita de autorização;
- transição para estado autorizado antes de liberar eventos.

Logo, o dashboard não depende apenas da proteção HTTP tradicional.

## HTTPS

O engine em
[server.js](/workspaces/chatgpt-docker-puppeteer/src/server/engine/server.js) suporta HTTPS.

Comportamento observado:

- HTTPS é forçado em produção;
- em desenvolvimento, `FORCE_HTTPS=true` também pode forçar TLS;
- se certificados exigidos faltarem em produção, o servidor falha;
- em desenvolvimento, sem certificados válidos, o runtime pode seguir em HTTP.

## O que não deve ser afirmado sem revisão

As seguintes afirmações antigas não devem mais aparecer como baseline sem validação:

- existência de um e-mail oficial `security@project.com` como canal confirmado do projeto;
- políticas formais de SLA/CVE não implementadas no código ou em processo operacional real;
- rotação obrigatória automatizada via scripts em `analysis/rotation-scripts/` como contrato atual.

Esses pontos podem existir como proposta ou histórico, mas não foram validados como contrato
operacional ativo nesta revisão.

## Riscos e divergências conhecidas

### 1. Scripts legados não são sinônimo de política

Há scripts e docs históricos com recomendações antigas de rotação, health e bootstrap.

Eles não devem ser usados como prova de política vigente sem confrontar:

- `src/server/engine/app.js`
- `src/server/main.js`
- `src/server/middleware/auth.js`

### 2. Helper scripts ainda podem divergir

Alguns helpers operacionais antigos ainda carregam defaults desalinhados do runtime atual.

A documentação canônica deve privilegiar o comportamento observado no código do servidor.

## Checklist operacional mínimo

- Definir `DASHBOARD_AUTH_USERNAME`.
- Definir `DASHBOARD_AUTH_PASSWORD` com pelo menos 12 caracteres.
- Garantir JWT secret válido.
- Revisar `ALLOWED_ORIGINS` e `DASHBOARD_ORIGIN` antes de expor o dashboard.
- Em produção, garantir certificados válidos se HTTPS estiver ativo.

## Regras de manutenção

- Não documentar política de disclosure externa que não esteja efetivamente institucionalizada.
- Não afirmar que auth é opcional por padrão; hoje o default observado é protegido.
- Sempre validar claims de segurança contra `app.js`, `auth.js` e `server/main.js`.
- Scripts históricos de rotação ou hardening devem ser tratados como apoio, não como baseline.

## Links relacionados

- Dependências e supply chain: [DEPENDENCY_AUTOMATION.md](./DEPENDENCY_AUTOMATION.md)
- Networking: [NETWORKING.md](./NETWORKING.md)
- Deploy: [DEPLOYMENT.md](./DEPLOYMENT.md)
- DevContainer: [DEVCONTAINER.md](./DEVCONTAINER.md)
- Referência de API: [../REFERENCIA/API_REFERENCE.md](../REFERENCIA/API_REFERENCE.md)
