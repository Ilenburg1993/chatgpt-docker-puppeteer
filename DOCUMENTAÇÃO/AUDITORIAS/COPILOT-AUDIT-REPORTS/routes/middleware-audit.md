# middleware.js — Auditoria

**Módulo**: `src/copilot/routes/`  
**Arquivo**: `middleware.js`  
**LOC**: 30 | **Score**: 9.0/10

## Responsabilidade

`withErrorHandler(prefix, req, res, fn)` — wrapper que captura erros de handlers assíncronos e
retorna 500 padronizado com log. Usado por todos os outros routers via `.bind(null, 'prefixo')`.

## Achados

### C14-MW01 — P5

**`e.message` exposto diretamente na resposta HTTP**

Mensagens de exceção internas (ex: stack traces parciais, nomes de variáveis, paths internos) são
enviadas ao cliente via `res.status(500).json({ ok: false, error: e.message })`. Para API interna
isso é aceitável, mas em exposição pública seria information leakage.

## Destaques Positivos

- Guard `if (!res.headersSent)` correto — evita `Cannot set headers after they are sent`
- Padrão `.bind(null, 'prefix')` elegante para especialização sem overhead

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
