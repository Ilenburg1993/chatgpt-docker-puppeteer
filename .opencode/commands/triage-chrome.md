---
description: Diagnosticar problemas de conexão Chrome/Proxy (9224/9225)
---

Diagnostique problemas comuns de conexão com o Chrome (proxy no container e Chrome no host):

Contexto do projeto:

- DevContainer conecta no proxy `localhost:9224`
- Proxy encaminha para `host.docker.internal:9225` (Chrome no host)

Rode os checks e explique o que encontrou:

!`npm run check:chrome` !`node scripts/healthcheck.js`

Se falhar, proponha passos de correção (Windows/WSL/DevContainer) sem quebrar a regra
**connect-only**.
