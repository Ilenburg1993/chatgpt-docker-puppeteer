# server/

**Camada**: L6 — borda HTTP/Socket.IO local do Copilot.

O servidor é a fronteira de rede do runtime: ele monta Express, middleware, routers, Socket.IO e
estado runtime-local de streams/rate-limit. Ele não deve virar owner de domínio do agent, SDK,
presentation ou terminal.

## Como ler este diretório

1. Comece por `index.js`, owner do HTTP server e do Socket.IO server.
2. Use `module-map.js` para o inventário executável da raiz.
3. Leia `app.js` para app/middleware base e `router.js` para composição de routers.
4. Desça por subdiretório: `routes/`, `middleware/`, `runtime-state/` e `socket/`.
5. Trate `routes/presentation-route.js` como adapter canônico de handlers de `presentation/`.

## Mapa atual de papéis

| Papel           | Arquivos/diretórios            |
| --------------- | ------------------------------ |
| `entrypoint`    | `index.js`, `module-map.js`    |
| `app-factory`   | `app.js`                       |
| `router`        | `router.js`, `routes/`         |
| `middleware`    | `middleware/`                  |
| `runtime-state` | `runtime-state/`               |
| `socket`        | `socket/`                      |
| `route-adapter` | `routes/presentation-route.js` |

## Regra para novos arquivos

Todo novo arquivo funcional na raiz de `server/` precisa aparecer em `module-map.js`. Na dúvida,
prefira subpastas semânticas: routers em `routes/`, estado de borda em `runtime-state/`, middleware
em `middleware/`, Socket.IO em `socket/` e adapters canônicos de rota em `routes/`.
