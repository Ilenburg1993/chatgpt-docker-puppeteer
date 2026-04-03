# url-validator.js — Auditoria

**Módulo**: `src/copilot/lib/` **Arquivo**: `url-validator.js` **LOC**: 88 | **Score**: 8.5/10

## Responsabilidade

Validador anti-SSRF. `validateUrl(url: URL)` e `validateUrlString(urlStr)`. Bloqueia: `file:`,
`ftp:`, `data:`, `javascript:`, IPs privados (10.x, 172.16-31.x, 192.168.x, 169.254.x, 127.x.x.x,
0.0.0.0, localhost, ::1, fd::/8, metadata.google.internal).

## ACHADO C13-01 — P4

**DNS rebinding não prevenido**

A validação resolve hostname **na hora da URL parse**, antes do DNS. Um hostname malicioso pode
resolver para um IP público durante a validação e, na hora da requisição HTTP, rebinder para um IP
privado, bypassando a validação.

Mitigação completa exigiria revalidação pós-DNS (caro para implementar) ou allowlist de domínios
confiáveis em vez de blocklist. Documentar a limitação é o mínimo necessário.

## ACHADO C13-V02 — P5

**`fe80` IPv6 link-local captura apenas prefixo exato**

```js
/^\[?::1\]?$|^fe80$/i; // Só pega 'fe80', não 'fe80::1' ou 'fe80::/10'
```

En prática risco baixo (link-local raramente roteável de SSRF externo), mas a regex é imprecisa
quanto à intenção.

## Destaques Positivos

- `PRIVATE_HOST_RE` cobre IPv4 privado completo (inclusive 169.254.x link-local, 0.0.0.0 e
  metadata.google.internal)
- Numeric IPv4 check (blocklist de `10.`, `172.16-31.`, `192.168.`, `127.`, `169.254.`) via regex
  separado da host check — coverage em dois estágios
- Retorno `{ safe: boolean, reason?: string, parsed?: URL }` limpo para callers

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._

---

## Status de Correção (2026-04-03)

### [FIXED] SEC-LIB-001 (P2) — IPv6 privado/ULA/link-local/IPv4-mapped agora bloqueados

Adicionados ao validateUrl():

- fe80:: (link-local fe80::/10)
- fc00::/8 (ULA fc prefix)
- ::ffff:10.x, ::ffff:172.16-31.x, ::ffff:192.168.x, ::ffff:127.x (IPv4-mapped private) Os padrões
  fd00::/8 e ::1 já existiam; agora completo.

**Pontuação atualizada: 9.5/10**

---

## Status de Correção (2026-04-03)

### [FIXED] SEC-LIB-001 (P2) — IPv6 privado/ULA/link-local/IPv4-mapped agora bloqueados

Adicionados ao validateUrl():

- fe80:: (link-local fe80::/10)
- fc00::/8 (ULA fc prefix)
- ::ffff:10.x, ::ffff:172.16-31.x, ::ffff:192.168.x, ::ffff:127.x (IPv4-mapped private) Os padrões
  fd00::/8 e ::1 já existiam; agora completo.

**Pontuação atualizada: 9.5/10**
