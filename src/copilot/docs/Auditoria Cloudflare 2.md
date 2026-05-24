# Roadmap Cloudflare 2 para MCP/API de baixa cardinalidade e conexões longas

**Data:** 2026-05-24
**Escopo:** `mcp.aurelin.org` como camada Cloudflare/Tunnel para MCP Server externo usado por ChatGPT.com e automações controladas.
**Fora de escopo:** arquitetura interna do `src/copilot` como runtime local/GitHub Copilot SDK do workspace, exceto quando ele aparece como origem HTTP local do túnel.
**Princípio central:** configurar Cloudflare como borda de API privada/semiprivada, não como CDN/website público tradicional.

---

## Índice

1. [Resumo executivo](#1-resumo-executivo)
2. [Separação conceitual: runtime local vs ponte Cloudflare/MCP](#2-separação-conceitual-runtime-local-vs-ponte-cloudflaremcp)
3. [Por que configuração de website é perigosa para MCP](#3-por-que-configuração-de-website-é-perigosa-para-mcp)
4. [Modelo correto: API de baixa cardinalidade e conexões longas](#4-modelo-correto-api-de-baixa-cardinalidade-e-conexões-longas)
5. [Fontes oficiais Cloudflare usadas](#5-fontes-oficiais-cloudflare-usadas)
6. [Arquitetura-alvo para `mcp.aurelin.org`](#6-arquitetura-alvo-para-mcpaurelinorg)
7. [Matriz de rotas e políticas recomendadas](#7-matriz-de-rotas-e-políticas-recomendadas)
8. [O que significa “conexão ilimitada” neste caso](#8-o-que-significa-conexão-ilimitada-neste-caso)
9. [DNS e proxy status](#9-dns-e-proxy-status)
10. [Cloudflare Tunnel e parâmetros de origem](#10-cloudflare-tunnel-e-parâmetros-de-origem)
11. [Cache Rules: bypass cirúrgico, não Development Mode](#11-cache-rules-bypass-cirúrgico-não-development-mode)
12. [WAF Custom Rules: evitar desafios interativos em `/mcp`](#12-waf-custom-rules-evitar-desafios-interativos-em-mcp)
13. [Rate Limiting: fusível antiabuso, não limite de uso legítimo](#13-rate-limiting-fusível-antiabuso-não-limite-de-uso-legítimo)
14. [Access, Service Tokens e mTLS](#14-access-service-tokens-e-mtls)
15. [API Shield / JWT Validation](#15-api-shield--jwt-validation)
16. [SSL/TLS: edge HTTPS vs origem local do Tunnel](#16-ssltls-edge-https-vs-origem-local-do-tunnel)
17. [Transform Rules e cabeçalhos sensíveis](#17-transform-rules-e-cabeçalhos-sensíveis)
18. [Observabilidade: Security Events, Ray ID e métricas do `cloudflared`](#18-observabilidade-security-events-ray-id-e-métricas-do-cloudflared)
19. [Como checar tudo via API](#19-como-checar-tudo-via-api)
20. [Como alterar tudo via API com segurança](#20-como-alterar-tudo-via-api-com-segurança)
21. [SDK Node oficial da Cloudflare](#21-sdk-node-oficial-da-cloudflare)
22. [Inventário desired-vs-actual](#22-inventário-desired-vs-actual)
23. [Roadmap por fases](#23-roadmap-por-fases)
24. [Checklist operacional](#24-checklist-operacional)
25. [Snippets `curl`](#25-snippets-curl)
26. [Snippets Node/TypeScript](#26-snippets-nodetypescript)
27. [Expressões Cloudflare recomendadas](#27-expressões-cloudflare-recomendadas)
28. [Riscos e decisões pendentes](#28-riscos-e-decisões-pendentes)
29. [Conclusão](#29-conclusão)

---

## 1. Resumo executivo

`mcp.aurelin.org` não deve ser tratado como um site público tradicional. Ele é uma ponte de API/MCP para poucos clientes esperados, com tráfego autenticado, endpoints OAuth, JSON-RPC/Streamable HTTP e conexões que podem durar mais que requisições web comuns.

Em um website comum, Cloudflare é frequentemente usada para:

- cache de assets;
- otimização HTML/CSS/JS;
- desafios bot/humano;
- proteção volumétrica para milhares de origens anônimas;
- regras genéricas para navegação web.

No nosso caso, isso pode ser contraproducente. O objetivo deve ser:

- **não cachear** fluxos MCP/OAuth;
- **não desafiar interativamente** o cliente ChatGPT.com;
- **não impor rate limit baixo** a clientes autenticados;
- **proteger fortemente tráfego anônimo, inválido ou administrativo**;
- **preservar streaming, chunking, headers OAuth e reconexão**;
- **observar antes de endurecer**.

A tese operacional é: **limites devem ser orientados por identidade, não por volume bruto**. Para cliente autenticado e esperado, Cloudflare deve impor o mínimo necessário. Para tráfego anônimo/inválido, Cloudflare deve ser dura.

---

## 2. Separação conceitual: runtime local vs ponte Cloudflare/MCP

Há duas esferas distintas:

### 2.1 Runtime local / `src/copilot`

É o sistema local do workspace, ligado ao fluxo interno de desenvolvimento, automação, SDK, validações, ferramentas e runtime. Ele pode expor uma origem local HTTP, como:

```txt
http://127.0.0.1:3333
```

Essa origem é apenas o servidor local que `cloudflared` acessa.

### 2.2 Cloudflare + MCP Server externo

É a camada que transforma a origem local em um endpoint público controlado:

```txt
https://mcp.aurelin.org/mcp
```

Ela envolve:

- DNS/proxy da Cloudflare;
- Cloudflare Tunnel;
- ingress/public hostname;
- WAF/Rulesets;
- Cache Rules;
- Rate Limiting;
- SSL/TLS edge;
- Access/API Shield, quando aplicável;
- logs, Security Events e métricas.

### 2.3 Por que essa separação importa

Um problema de `cloudflared` alcançando `localhost`/`::1` não é um bug do runtime local em si. É problema de **configuração de origem do túnel**. Um problema de WAF challenge ou cache também não é problema do SDK local. São camadas diferentes que devem ser auditadas separadamente.

---

## 3. Por que configuração de website é perigosa para MCP

Muitas opções do painel Cloudflare partem do pressuposto de que o tráfego é de browser humano acessando site:

- HTML navegável;
- assets estáticos;
- cookies de browser;
- desafios JavaScript;
- tolerância a redirects visuais;
- cache de GET;
- interações curtas.

MCP/OAuth/JSON-RPC tem outras propriedades:

- cliente máquina-a-máquina;
- requisições POST com JSON;
- endpoints de discovery em `/.well-known/*`;
- headers `Authorization` e `WWW-Authenticate` relevantes;
- fluxo OAuth sensível;
- streaming/long polling/SSE ou Streamable HTTP;
- reconexão e replay;
- payloads de ferramenta que podem ser grandes;
- poucos clientes legítimos.

Consequências práticas:

| Feature típica de website   | Risco para MCP                                   |
| --------------------------- | ------------------------------------------------ |
| Cache Everything            | Cache indevido de discovery, OAuth ou JSON-RPC   |
| Bot Fight Mode agressivo    | Cliente ChatGPT pode ser tratado como bot        |
| JS/Managed Challenge        | Cliente máquina não resolve desafio interativo   |
| Access interativo em `/mcp` | ChatGPT não terá sessão/cookie Access            |
| mTLS obrigatório em `/mcp`  | ChatGPT não apresenta certificado cliente nosso  |
| Minify/Rocket Loader        | Irrelevante ou arriscado se aplicado globalmente |
| Page Rules antigas globais  | Pode sobrescrever headers/redirects/caching      |
| Rate limit baixo por IP     | Pode matar sessão legítima/retry/reconnect       |

---

## 4. Modelo correto: API de baixa cardinalidade e conexões longas

O modelo correto para `mcp.aurelin.org` é:

```txt
API privada/semiprivada
+ baixa cardinalidade de clientes legítimos
+ alto privilégio
+ autenticação OAuth própria
+ conexões longas/reconectáveis
+ payloads controlados
+ observabilidade forte
```

### 4.1 Baixa cardinalidade

Em um website, milhares de IPs podem chegar legitimamente. Aqui, o conjunto esperado é pequeno:

- ChatGPT.com;
- eventualmente OpenAI/infra associada;
- scripts internos;
- CI/CD controlado;
- administradores.

Portanto, limite por volume bruto deve ser conservador para tráfego autenticado.

### 4.2 Alto privilégio

Mesmo com poucos clientes, o impacto de uma chamada MCP pode ser alto. A segurança principal deve residir em:

- OAuth/JWT;
- escopos;
- autorização por ferramenta;
- políticas de escrita;
- auditoria;
- validação de payload;
- confirmação humana quando aplicável.

Cloudflare deve complementar isso, não substituir.

### 4.3 Longa duração

Para streaming, o desenho robusto não é “a conexão nunca cai”. É:

```txt
queda eventual não destrói a sessão lógica
```

Isso implica heartbeat, timeout coerente, reconexão, idempotência e payloads paginados.

---

## 5. Fontes oficiais Cloudflare usadas

Este documento é baseado nas seguintes documentações oficiais:

1. Cloudflare Node SDK
   https://developers.cloudflare.com/api/node/

2. Cloudflare Fundamentals / Get started
   https://developers.cloudflare.com/fundamentals/get-started/

3. API tokens
   https://developers.cloudflare.com/fundamentals/api/get-started/create-token/

4. API permissions
   https://developers.cloudflare.com/fundamentals/api/reference/permissions/

5. Make API calls
   https://developers.cloudflare.com/fundamentals/api/how-to/make-api-calls/

6. Connection limits
   https://developers.cloudflare.com/fundamentals/reference/connection-limits/

7. Cloudflare Tunnel
   https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/

8. Tunnel origin parameters
   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/origin-configuration/

9. Tunnel metrics
   https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/monitor-tunnels/metrics/

10. Cloudflare Tunnel API
    https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/

11. DNS records API
    https://developers.cloudflare.com/api/resources/dns/subresources/records/

12. DNS record management
    https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/

13. Cache Rules
    https://developers.cloudflare.com/cache/how-to/cache-rules/

14. Create Cache Rules via API
    https://developers.cloudflare.com/cache/how-to/cache-rules/create-api/

15. WAF Custom Rules
    https://developers.cloudflare.com/waf/custom-rules/

16. Create WAF Custom Rules via API
    https://developers.cloudflare.com/waf/custom-rules/create-api/

17. WAF Skip options
    https://developers.cloudflare.com/waf/custom-rules/skip/options/

18. WAF Skip API examples
    https://developers.cloudflare.com/waf/custom-rules/skip/api-examples/

19. Rate Limiting Rules
    https://developers.cloudflare.com/waf/rate-limiting-rules/

20. Create Rate Limiting Rules via API
    https://developers.cloudflare.com/waf/rate-limiting-rules/create-api/

21. Cloudflare Access Service Tokens
    https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/

22. API Shield JWT Validation
    https://developers.cloudflare.com/api-shield/security/jwt-validation/

23. SSL/TLS Full Strict
    https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/

24. Response Header Transform Rules
    https://developers.cloudflare.com/rules/transform/response-header-modification/

---

## 6. Arquitetura-alvo para `mcp.aurelin.org`

### 6.1 Desenho lógico

```txt
ChatGPT.com / clientes controlados
        |
        | HTTPS público
        v
Cloudflare Edge
  - DNS proxied
  - TLS edge
  - WAF seletivo
  - Cache bypass
  - Rate limit antiabuso
  - Logs/Security Events
        |
        | Cloudflare Tunnel
        v
cloudflared no workspace/devcontainer
        |
        | HTTP local
        v
MCP Server local
  http://127.0.0.1:3333
```

### 6.2 Objetivo de Cloudflare

Cloudflare deve fornecer:

- endpoint público estável;
- TLS público;
- túnel outbound-only;
- proteção contra ruído anônimo;
- visibilidade de eventos;
- controle declarativo por API;
- não-interferência no cliente legítimo.

### 6.3 Não objetivos

Cloudflare não deve, em `/mcp`:

- exigir login Access interativo;
- exigir certificado mTLS do ChatGPT;
- injetar challenge JS;
- cachear respostas;
- transformar headers OAuth;
- impor limite baixo de conexão legítima;
- otimizar HTML inexistente.

---

## 7. Matriz de rotas e políticas recomendadas

| Rota               | Função                       | Cache                     | WAF                      | Rate limit                            | Access/mTLS          | Observações                            |
| ------------------ | ---------------------------- | ------------------------- | ------------------------ | ------------------------------------- | -------------------- | -------------------------------------- |
| `/mcp`             | MCP JSON-RPC/Streamable HTTP | Bypass                    | Sem challenge interativo | Nenhum ou muito alto para autenticado | Não                  | Rota crítica do ChatGPT                |
| `/.well-known/*`   | OAuth/OIDC discovery         | Bypass ou TTL muito baixo | Permissivo               | Alto                                  | Não                  | Deve funcionar sempre                  |
| `/oauth/authorize` | OAuth authorization          | Bypass                    | Sem challenge quebrável  | Moderado                              | Não                  | Pode envolver redirects                |
| `/oauth/token`     | Emissão/refresh token        | Bypass                    | Proteção antiabuso       | Moderado/baixo                        | Não                  | Sensível a loops/brute force           |
| `/health`          | Health check                 | Bypass                    | Permissivo               | Alto                                  | Não ou token simples | Útil para smoke                        |
| `/admin/*`         | Administração                | Bypass                    | Forte                    | Baixo                                 | Sim                  | Usar Access/service token/mTLS         |
| `/metrics`         | Métricas                     | Não público               | Forte                    | Baixo                                 | Sim/local-only       | Preferir `127.0.0.1`                   |
| `/internal/*`      | APIs internas                | Bypass                    | Forte                    | Baixo                                 | Sim                  | Nunca expor ao ChatGPT sem necessidade |

---

## 8. O que significa “conexão ilimitada” neste caso

Cloudflare e TCP nunca são literalmente ilimitados. A documentação oficial de limites de conexão cita, entre outros, `Proxy Read Timeout` de 120 segundos, `Proxy Idle Timeout` de 900 segundos, `Proxy Write Timeout` de 30 segundos e limite de headers de 128 KB.

**Origem oficial:**
https://developers.cloudflare.com/fundamentals/reference/connection-limits/

Portanto, “ilimitado” deve ser traduzido como:

```txt
sem limites artificiais baixos impostos por WAF/rate limit/cache para clientes autenticados e esperados
```

Não significa ignorar limites físicos ou operacionais.

### 8.1 Estratégia para conexões longas

- heartbeat menor que os timeouts relevantes;
- cliente com timeout maior que heartbeat;
- reconexão automática;
- `Last-Event-ID`/replay quando aplicável;
- respostas parciais pequenas;
- logs de job paginados/resumidos;
- não ficar silencioso por mais de 120s.

### 8.2 Perfil recomendado

```txt
heartbeat SSE/stream: 10s-20s
client idle timeout: >= 3x heartbeat
respostas grandes: resumir, paginar, chunkar
reconnect: exponencial, idempotente
Cloudflare rate limit para autenticado: desativado ou fusível muito alto
```

---

## 9. DNS e proxy status

### 9.1 O que queremos

Para `mcp.aurelin.org`:

```txt
DNS record proxied = true
hostname apontando para o túnel/Cloudflare
sem exposição direta de IP de origem
```

A documentação oficial de DNS explica criação/edição de registros e uso de proxy status para A/AAAA/CNAME quando aplicável.

**Origem oficial:**
https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/
https://developers.cloudflare.com/api/resources/dns/subresources/records/

### 9.2 Como checar via API

```bash
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=mcp.aurelin.org" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json"
```

Verificar campos:

```txt
name
content
type
proxied
proxiable
comment
tags
```

### 9.3 Como alterar via API

```bash
curl -sS -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$DNS_RECORD_ID" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "proxied": true,
    "comment": "MCP connector hostname managed for low-cardinality API profile"
  }'
```

Nunca alterar DNS sem confirmar se o hostname está mesmo associado ao tunnel public hostname.

---

## 10. Cloudflare Tunnel e parâmetros de origem

Cloudflare Tunnel cria conexões outbound-only a partir do `cloudflared`, sem exigir IP público roteável para a origem. A documentação descreve o fluxo como tráfego passando por conexões estabelecidas entre `cloudflared` e a rede Cloudflare.

**Origem oficial:**
https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/

### 10.1 Estado desejado

```txt
tunnel: workspace-mcp-dev
public hostname: mcp.aurelin.org
service: http://127.0.0.1:3333
transport protocol cloudflared <-> Cloudflare: http2
origin local: HTTP/1.1 aceitável
```

### 10.2 Por que `127.0.0.1`, não `localhost`

`localhost` pode resolver para IPv6 `::1`. Se o servidor local escuta apenas `127.0.0.1`, `cloudflared` pode falhar com:

```txt
dial tcp [::1]:3333: connect: connection refused
```

Para reduzir ambiguidade, o serviço do public hostname deve ser:

```txt
http://127.0.0.1:3333
```

### 10.3 Parâmetros de origem relevantes

A documentação oficial de origin parameters diz que esses parâmetros determinam como `cloudflared` envia requisições à origem. Também documenta, por exemplo:

- `disableChunkedEncoding`: quando `false`, usa chunked transfer encoding em HTTP/1.1;
- `http2Origin`: quando `true`, usa HTTP/2 para a origem e exige certificado SSL na origem;
- `connectTimeout`, `tcpKeepAlive`, `keepAliveConnections` e outros controles.

**Origem oficial:**
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/origin-configuration/

### 10.4 Estado recomendado para MCP

```yaml
service: http://127.0.0.1:3333
originRequest:
  disableChunkedEncoding: false
  http2Origin: false
  connectTimeout: 15s
  tcpKeepAlive: 30s
```

Notas:

- não ativar `disableChunkedEncoding` sem motivo;
- não ativar `http2Origin` se a origem local não tiver HTTPS/certificado compatível;
- não usar `localhost` no service remoto;
- não tratar `keepAliveConnections` como limite total de concorrência: a documentação indica que ele controla conexões keep-alive ociosas, não total concorrente.

### 10.5 Como checar via API

A API oficial de Zero Trust/Tunnels possui endpoints para listar, obter, atualizar e deletar tunnels, bem como obter/atualizar configurações e listar conexões.

**Origem oficial:**
https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/

```bash
# Listar túneis
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"

# Obter túnel específico
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"

# Obter configuração remota do túnel
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"

# Listar conexões ativas do túnel
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/connections" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### 10.6 Como alterar via API

A alteração de configuração de tunnel deve seguir este fluxo:

1. `GET` da configuração atual;
2. salvar backup JSON;
3. aplicar patch local no JSON;
4. revisar diff;
5. `PUT` completo preservando regras existentes;
6. rodar smoke externo;
7. se falhar, rollback.

Exemplo conceitual:

```bash
curl -sS -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data @desired-tunnel-config.json
```

**Atenção:** validar o schema exato aceito pela API antes de automatizar `PUT`. Não sobrescrever ingress rules existentes sem inventário.

---

## 11. Cache Rules: bypass cirúrgico, não Development Mode

Cloudflare Cache Rules permitem customizar elegibilidade e comportamento do cache via Dashboard, API ou Terraform. A documentação indica que o DNS deve estar proxied para que regras de cache funcionem e recomenda Cloudflare Trace para investigar se uma regra está disparando.

**Origem oficial:**
https://developers.cloudflare.com/cache/how-to/cache-rules/
https://developers.cloudflare.com/cache/how-to/cache-rules/create-api/

### 11.1 Por que Development Mode não é solução

Development Mode é global/temporário e pensado para desenvolvimento de sites. Para MCP, precisamos de política permanente e cirúrgica por rota.

### 11.2 Regra recomendada

Expressão:

```txt
http.host eq "mcp.aurelin.org"
and (
  starts_with(http.request.uri.path, "/mcp")
  or starts_with(http.request.uri.path, "/.well-known/")
  or starts_with(http.request.uri.path, "/oauth/")
  or http.request.uri.path eq "/health"
)
```

Ação:

```txt
Bypass cache / cache=false
```

### 11.3 Como checar via API

Cache Rules usam a Rulesets API na fase:

```txt
http_request_cache_settings
```

```bash
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_cache_settings/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### 11.4 Como criar via API

A documentação oficial mostra uso de `set_cache_settings` com `action_parameters`.

Exemplo conceitual:

```bash
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/$RULESET_ID/rules" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "description": "Bypass cache for MCP/OAuth dynamic endpoints",
    "expression": "http.host eq \"mcp.aurelin.org\" and (starts_with(http.request.uri.path, \"/mcp\") or starts_with(http.request.uri.path, \"/.well-known/\") or starts_with(http.request.uri.path, \"/oauth/\") or http.request.uri.path eq \"/health\")",
    "action": "set_cache_settings",
    "action_parameters": {
      "cache": false
    },
    "enabled": true
  }'
```

**Cuidado:** a documentação alerta que exemplos de atualização podem deletar regras existentes se usados diretamente. Sempre obter ruleset atual e preservar regras.

---

## 12. WAF Custom Rules: evitar desafios interativos em `/mcp`

WAF Custom Rules filtram requisições com expressões e aplicam ações como Block, Managed Challenge, JS Challenge, Log, Skip etc. Elas são avaliadas em ordem.

**Origem oficial:**
https://developers.cloudflare.com/waf/custom-rules/
https://developers.cloudflare.com/waf/custom-rules/create-api/

### 12.1 Regra de ouro

Para `/mcp`, evitar:

```txt
Managed Challenge
JS Challenge
Interactive Challenge
Bot Fight agressivo
```

O cliente ChatGPT/MCP não é um navegador humano que resolve desafios.

### 12.2 Quando usar Skip

Se regras gerenciadas ou bot mitigations estiverem causando falso positivo, criar exceção cirúrgica para `/mcp`, sem desligar proteção global da zona.

A documentação de Skip Rules permite pular fases/produtos, como:

- `http_request_firewall_managed`;
- `http_ratelimit`;
- `http_request_sbfm`;
- outros recursos conforme plano.

**Origem oficial:**
https://developers.cloudflare.com/waf/custom-rules/skip/options/
https://developers.cloudflare.com/waf/custom-rules/skip/api-examples/

Exemplo conceitual:

```json
{
  "description": "Do not apply interactive/bot challenges to MCP route",
  "expression": "http.host eq \"mcp.aurelin.org\" and starts_with(http.request.uri.path, \"/mcp\")",
  "action": "skip",
  "action_parameters": {
    "phases": [
      "http_request_firewall_managed",
      "http_request_sbfm"
    ],
    "logging": {
      "enabled": true
    }
  },
  "enabled": true
}
```

### 12.3 Bloqueios seguros

Bloquear ruído óbvio:

```txt
métodos inesperados
paths de scanner
path traversal
payloads muito grandes
hosts incorretos
```

Mas evitar bloquear por User-Agent ou ASN sem evidência, pois a origem do tráfego legítimo pode variar.

### 12.4 Como checar via API

WAF Custom Rules usam fase:

```txt
http_request_firewall_custom
```

```bash
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_firewall_custom/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### 12.5 Como criar regra via API

```bash
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/$RULESET_ID/rules" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data @waf-mcp-rule.json
```

---

## 13. Rate Limiting: fusível antiabuso, não limite de uso legítimo

Rate Limiting Rules definem limites para requisições que correspondem a uma expressão e têm parâmetros como características, período, quantidade e mitigation timeout.

**Origem oficial:**
https://developers.cloudflare.com/waf/rate-limiting-rules/
https://developers.cloudflare.com/waf/rate-limiting-rules/create-api/

A documentação também alerta que rate limiting não é perfeitamente preciso: há atrasos de atualização de contadores e algumas requisições excedentes podem alcançar a origem antes da mitigação.

### 13.1 Modelo recomendado

```txt
Cliente autenticado e esperado:
  sem limite Cloudflare ou limite muito alto

Anônimo / sem Authorization / inválido:
  limite baixo/médio

/oauth/token:
  limite moderado anti-loop/brute-force

/health:
  limite alto
```

### 13.2 Exemplo: limitar `/oauth/token`

```json
{
  "description": "Protect OAuth token endpoint from loops/brute force",
  "expression": "http.host eq \"mcp.aurelin.org\" and http.request.uri.path eq \"/oauth/token\"",
  "action": "block",
  "ratelimit": {
    "characteristics": ["ip.src", "cf.colo.id"],
    "period": 60,
    "requests_per_period": 120,
    "mitigation_timeout": 60
  },
  "enabled": true
}
```

### 13.3 Exemplo: limitar `/mcp` sem Authorization

```json
{
  "description": "Throttle anonymous MCP traffic",
  "expression": "http.host eq \"mcp.aurelin.org\" and starts_with(http.request.uri.path, \"/mcp\") and not http.request.headers[\"authorization\"][0] contains \"Bearer \"",
  "action": "block",
  "ratelimit": {
    "characteristics": ["ip.src", "cf.colo.id"],
    "period": 60,
    "requests_per_period": 60,
    "mitigation_timeout": 60
  },
  "enabled": true
}
```

### 13.4 Como checar via API

Rate Limiting Rules usam fase:

```txt
http_ratelimit
```

```bash
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_ratelimit/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### 13.5 Como criar via API

```bash
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/$RULESET_ID/rules" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data @rate-limit-mcp-rule.json
```

---

## 14. Access, Service Tokens e mTLS

### 14.1 Access interativo

Cloudflare Access é útil para aplicações privadas, mas se aplicado diretamente a `/mcp`, pode inserir login/cookie/desafio incompatível com ChatGPT.

Recomendação:

```txt
Não aplicar Access interativo em /mcp.
Aplicar em /admin, /metrics, /internal ou hostname separado.
```

### 14.2 Service Tokens

Access Service Tokens são credenciais para sistemas automatizados. A documentação mostra uso de `Client ID` e `Client Secret`, normalmente enviados nos headers:

```txt
CF-Access-Client-Id
CF-Access-Client-Secret
```

Também alerta que, após criar token, é necessário associá-lo a uma política `Service Auth`; caso contrário, Access pode pedir login de identidade.

**Origem oficial:**
https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/

Uso recomendado:

```txt
/admin/*
/metrics
/internal/*
```

Não usar em `/mcp` enquanto ChatGPT.com não puder enviar esses headers de modo controlado e compatível.

### 14.3 mTLS

mTLS é forte para cliente controlado com certificado. Mas ChatGPT.com não apresentará nosso certificado cliente Cloudflare. Portanto:

```txt
mTLS obrigatório em /mcp: não recomendado agora
mTLS em /admin ou APIs internas: recomendado futuramente
```

Se usar mTLS, considerar tanto verificação quanto revogação de certificado.

---

## 15. API Shield / JWT Validation

API Shield JWT Validation permite validar JWTs na borda antes da origem, usando JWKS e regras de validação. A documentação indica validação contra assinatura, expiração, `not before`, manipulação e também uso de header/cookie. Também menciona rate limiting por claim JWT em alguns cenários.

**Origem oficial:**
https://developers.cloudflare.com/api-shield/security/jwt-validation/

### 15.1 Potencial para MCP

Poderia validar tokens OAuth/JWT antes do MCP Server, reduzindo tráfego inválido na origem.

### 15.2 Riscos

- precisa compatibilidade exata com nossos tokens;
- a localização do JWT deve ser header/cookie, não body;
- endpoints de discovery e token não devem exigir JWT;
- preflight `OPTIONS` pode precisar exceção;
- mudanças de JWKS/rotação exigem cuidado.

### 15.3 Roadmap recomendado

```txt
Fase 1: apenas inventariar
Fase 2: configurar em modo monitor/log, se disponível
Fase 3: enforcement apenas depois de smoke OAuth/MCP completo
```

---

## 16. SSL/TLS: edge HTTPS vs origem local do Tunnel

Full Strict exige que a origem aceite HTTPS com certificado válido, não expirado, emitido por CA confiável ou Cloudflare Origin CA e com CN/SAN correspondente; caso contrário, Cloudflare pode retornar 526.

**Origem oficial:**
https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/

### 16.1 Nosso caso

No desenho atual:

```txt
Cliente -> Cloudflare Edge: HTTPS público
Cloudflare Edge -> cloudflared: túnel Cloudflare
cloudflared -> origem local: http://127.0.0.1:3333
```

Full Strict não é a correção principal para a origem local do túnel. A prioridade é túnel saudável, service correto, OAuth saudável e rules compatíveis.

### 16.2 Quando considerar HTTPS na origem local

Apenas se houver redesenho:

```txt
cloudflared -> https://127.0.0.1:3333
```

Isso exigiria certificado local compatível e provável ajuste de `http2Origin`/TLS. Não é prioridade imediata.

---

## 17. Transform Rules e cabeçalhos sensíveis

Response Header Transform Rules permitem set/add/remove headers em respostas. A documentação também alerta que modificar `Cache-Control` por Transform Rule não altera comportamento de cache; para isso, usar Cache Rules.

**Origem oficial:**
https://developers.cloudflare.com/rules/transform/response-header-modification/

### 17.1 Headers que não devem ser alterados em MCP/OAuth

Evitar alterações globais em:

```txt
Authorization
WWW-Authenticate
Content-Type
Cache-Control
Set-Cookie
Location
Access-Control-Allow-Origin
Access-Control-Allow-Headers
Connection
Transfer-Encoding
```

### 17.2 Como checar via API

Response Header Transform Rules usam fase:

```txt
http_response_headers_transform
```

```bash
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_response_headers_transform/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

---

## 18. Observabilidade: Security Events, Ray ID e métricas do `cloudflared`

### 18.1 Métricas do tunnel

A documentação oficial diz que `cloudflared` expõe métricas Prometheus; por padrão, em ambiente não-container ele tenta portas `127.0.0.1:20241` a `20245`, e em container usa `0.0.0.0`. Também permite endpoint customizado com `--metrics`.

**Origem oficial:**
https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/monitor-tunnels/metrics/

### 18.2 Comando recomendado

```bash
cloudflared tunnel --metrics 127.0.0.1:60123 run workspace-mcp-dev
```

### 18.3 Métricas úteis

A documentação lista métricas como:

```txt
cloudflared_tunnel_active_streams
cloudflared_tunnel_concurrent_requests_per_tunnel
cloudflared_tunnel_ha_connections
cloudflared_tunnel_request_errors
cloudflared_tunnel_total_requests
cloudflared_tcp_active_sessions
```

### 18.4 Security Events

No painel, filtrar:

```txt
host = mcp.aurelin.org
path contains /mcp or /oauth or /.well-known
status = 403/429/5xx
Ray ID conhecido
Rule ID acionada
Action = block/challenge/skip/log
```

O Ray ID deve ser capturado em logs de erro externos sempre que houver “conexão perdida”.

---

## 19. Como checar tudo via API

### 19.1 Pré-requisitos

```bash
export CLOUDFLARE_API_TOKEN="..."
export ACCOUNT_ID="..."
export ZONE_ID="..."
export TUNNEL_ID="..."
```

### 19.2 Verificar token

A documentação de API tokens mostra endpoint de verify e recomenda permissões específicas por recurso.

**Origem oficial:**
https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
https://developers.cloudflare.com/fundamentals/api/reference/permissions/

```bash
curl -sS "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### 19.3 DNS

```bash
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=mcp.aurelin.org" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### 19.4 Tunnel

```bash
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"

curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"

curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/connections" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### 19.5 Rulesets por fase

```bash
for phase in \
  http_request_cache_settings \
  http_request_firewall_custom \
  http_ratelimit \
  http_response_headers_transform
  do
    echo "=== $phase ==="
    curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/$phase/entrypoint" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
  done
```

### 19.6 SSL/TLS mode

```bash
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/ssl" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### 19.7 Access apps e service tokens

```bash
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"

curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/service_tokens" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

---

## 20. Como alterar tudo via API com segurança

### 20.1 Regra de ouro

```txt
GET -> backup -> diff -> alteração mínima -> smoke -> rollback se necessário
```

Nunca fazer `PUT` de ruleset/tunnel config sem preservar regras existentes.

### 20.2 Separar tokens read-only e write

Criar pelo menos dois tokens:

```txt
cloudflare-audit-readonly:
  DNS Read
  Zone Settings Read
  Rulesets Read
  Access Read
  Cloudflare Tunnel Read

cloudflare-admin-change:
  DNS Edit quando necessário
  Rulesets Edit
  Cloudflare Tunnel Edit
  Access Edit se necessário
```

A documentação de API tokens recomenda permissões específicas, recursos específicos e alerta que o token secret só é exibido uma vez.

**Origem oficial:**
https://developers.cloudflare.com/fundamentals/api/get-started/create-token/

### 20.3 Smoke obrigatório após alteração

Após qualquer alteração:

```bash
curl -i https://mcp.aurelin.org/health
curl -i https://mcp.aurelin.org/.well-known/oauth-protected-resource
curl -i https://mcp.aurelin.org/.well-known/oauth-authorization-server
```

E smoke MCP:

```bash
curl -i https://mcp.aurelin.org/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Quando OAuth exige bearer token, esse último smoke deve ser executado com token válido ou pelo fluxo de smoke interno apropriado.

---

## 21. SDK Node oficial da Cloudflare

Cloudflare mantém SDK oficial Node em TypeScript.

**Origem oficial:**
https://developers.cloudflare.com/api/node/

### 21.1 Instalação

```bash
npm install cloudflare
```

### 21.2 Autenticação

O SDK lê `CLOUDFLARE_API_TOKEN` por padrão:

```ts
import Cloudflare from 'cloudflare';

const client = new Cloudflare({
  apiToken: process.env.CLOUDFLARE_API_TOKEN,
});
```

### 21.3 Retries e paginação

A documentação oficial informa que o SDK faz retry por padrão em erros de conexão, 408, 409, 429 e 5xx, e permite configurar `maxRetries`. Também suporta auto-pagination via async iterator.

Exemplo:

```ts
const client = new Cloudflare({
  apiToken: process.env.CLOUDFLARE_API_TOKEN,
  maxRetries: 2,
});

for await (const record of client.dns.records.list({ zone_id: zoneId })) {
  console.log(record.name, record.type, record.proxied);
}
```

### 21.4 Custom requests

A documentação mostra uso de métodos customizados como `client.get`, útil quando o SDK tipado ainda não cobre algum endpoint específico.

```ts
const result = await client.get(`/zones/${zoneId}/settings/ssl`);
```

---

## 22. Inventário desired-vs-actual

### 22.1 Desired state

```yaml
host: mcp.aurelin.org
profile: low-cardinality-mcp-api

dns:
  proxied: true

tunnel:
  service: http://127.0.0.1:3333
  protocol: http2
  originRequest:
    disableChunkedEncoding: false
    http2Origin: false

cache:
  /mcp: bypass
  /.well-known/*: bypass
  /oauth/*: bypass
  /health: bypass

waf:
  /mcp: no interactive challenge
  anonymous_invalid: block/log
  scanner_paths: block

rate_limit:
  authenticated_mcp: none_or_very_high
  anonymous_mcp: moderate
  oauth_token: moderate
  health: high

access:
  /mcp: disabled
  /admin/*: enabled
  /metrics: enabled_or_local_only

api_shield:
  jwt_validation: future_monitor_first

transforms:
  do_not_touch:
    - Authorization
    - WWW-Authenticate
    - Content-Type
    - Cache-Control
    - Set-Cookie
    - Connection
    - Transfer-Encoding
```

### 22.2 Actual state

Gerar por API:

```txt
DNS records
Tunnel config
Tunnel connections
Rulesets phases
Zone settings
Access apps
Service tokens metadata
Security Events export/manual
```

### 22.3 Diff

Classificar cada divergência:

```txt
P0: quebra conexão/autenticação
P1: risco alto de instabilidade
P2: endurecimento/observabilidade
P3: documentação/automação
```

---

## 23. Roadmap por fases

### Fase 0 — Congelar escopo

- declarar `mcp.aurelin.org` como API/MCP, não website;
- registrar rotas públicas e internas;
- separar `src/copilot` local de Cloudflare externo.

### Fase 1 — Estabilização

- confirmar `service=http://127.0.0.1:3333` no tunnel;
- remover dependência de quick tunnel antigo;
- smoke `/health`, discovery OAuth e `tools/list`;
- revisar Security Events.

### Fase 2 — Não interferência

- Cache Rule bypass;
- remover/evitar challenge em `/mcp`;
- confirmar que Access/mTLS não interceptam `/mcp`;
- confirmar Transform Rules neutras.

### Fase 3 — Observabilidade

- habilitar `cloudflared --metrics`;
- coletar métricas Prometheus;
- capturar Ray ID;
- correlacionar Security Events, tunnel logs e MCP logs.

### Fase 4 — Antiabuso seletivo

- rate limit `/oauth/token`;
- throttle `/mcp` anônimo/sem bearer;
- bloquear scanners óbvios;
- manter cliente autenticado sem limite prático.

### Fase 5 — Rotas internas fortes

- proteger `/admin/*` com Access/service tokens/mTLS;
- manter `/metrics` não público;
- criar host separado se necessário.

### Fase 6 — API automation

- implementar inventário read-only via SDK Node oficial;
- gerar relatório desired-vs-actual;
- aplicar mudanças apenas por planos revisáveis;
- armazenar backups JSON.

### Fase 7 — Hardening avançado

- avaliar API Shield/JWT Validation;
- testar em modo monitor/log;
- só aplicar enforcement após smoke completo;
- considerar split de hosts.

---

## 24. Checklist operacional

### Antes de qualquer alteração

- [ ] token read-only verificado;
- [ ] zone id e account id confirmados;
- [ ] tunnel id confirmado;
- [ ] backup de rulesets;
- [ ] backup de tunnel config;
- [ ] smoke atual registrado.

### Configuração desejada

- [ ] DNS proxied;
- [ ] tunnel service `http://127.0.0.1:3333`;
- [ ] cache bypass em `/mcp`, `/.well-known/*`, `/oauth/*`, `/health`;
- [ ] sem challenge interativo em `/mcp`;
- [ ] sem Access/mTLS em `/mcp`;
- [ ] rate limit seletivo, não global;
- [ ] Transform Rules não alteram headers sensíveis;
- [ ] métricas `cloudflared` habilitadas;
- [ ] Security Events monitorados;
- [ ] documentação atualizada.

### Pós-alteração

- [ ] `/health` OK;
- [ ] OAuth protected resource OK;
- [ ] OAuth authorization server metadata OK;
- [ ] `tools/list` OK;
- [ ] tunnel connections ativas;
- [ ] nenhum 403/429 inesperado;
- [ ] nenhum cache hit indevido;
- [ ] rollback pronto.

---

## 25. Snippets `curl`

### 25.1 Ver token

```bash
curl -sS "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### 25.2 Listar DNS

```bash
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=mcp.aurelin.org" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### 25.3 Ler regras por fase

```bash
PHASE=http_request_firewall_custom
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/$PHASE/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### 25.4 Ler tunnel config

```bash
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### 25.5 Ler tunnel connections

```bash
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/connections" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### 25.6 Smoke básico

```bash
curl -i https://mcp.aurelin.org/health
curl -i https://mcp.aurelin.org/.well-known/oauth-protected-resource
curl -i https://mcp.aurelin.org/.well-known/oauth-authorization-server
```

---

## 26. Snippets Node/TypeScript

### 26.1 Inventário mínimo com SDK oficial

```ts
import Cloudflare from 'cloudflare';

const cf = new Cloudflare({
  apiToken: process.env.CLOUDFLARE_API_TOKEN,
  maxRetries: 2,
});

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID!;
const zoneId = process.env.CLOUDFLARE_ZONE_ID!;
const tunnelId = process.env.CLOUDFLARE_TUNNEL_ID!;

async function main() {
  const token = await cf.get('/user/tokens/verify');
  console.log('token', token);

  const dns = await cf.dns.records.list({
    zone_id: zoneId,
    name: 'mcp.aurelin.org',
  });
  console.log('dns', dns);

  const tunnelConfig = await cf.get(
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
  );
  console.log('tunnelConfig', tunnelConfig);

  for (const phase of [
    'http_request_cache_settings',
    'http_request_firewall_custom',
    'http_ratelimit',
    'http_response_headers_transform',
  ]) {
    const ruleset = await cf.get(
      `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`,
    );
    console.log(phase, ruleset);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

### 26.2 Desired-vs-actual conceitual

```ts
type FindingSeverity = 'P0' | 'P1' | 'P2' | 'P3';

type Finding = {
  severity: FindingSeverity;
  area: string;
  message: string;
  expected: unknown;
  actual: unknown;
  source: string;
};

function checkTunnelService(config: any): Finding[] {
  const findings: Finding[] = [];
  const ingress = config?.result?.config?.ingress ?? [];
  const mcpRule = ingress.find((rule: any) => rule.hostname === 'mcp.aurelin.org');
  const actual = mcpRule?.service;

  if (actual !== 'http://127.0.0.1:3333') {
    findings.push({
      severity: 'P0',
      area: 'cloudflare-tunnel',
      message: 'Tunnel service should use 127.0.0.1, not localhost or another origin.',
      expected: 'http://127.0.0.1:3333',
      actual,
      source: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/origin-configuration/',
    });
  }

  return findings;
}
```

---

## 27. Expressões Cloudflare recomendadas

### 27.1 Dynamic endpoints

```txt
http.host eq "mcp.aurelin.org"
and (
  starts_with(http.request.uri.path, "/mcp")
  or starts_with(http.request.uri.path, "/.well-known/")
  or starts_with(http.request.uri.path, "/oauth/")
  or http.request.uri.path eq "/health"
)
```

Uso:

```txt
Cache bypass
```

### 27.2 MCP route

```txt
http.host eq "mcp.aurelin.org"
and starts_with(http.request.uri.path, "/mcp")
```

Uso:

```txt
não aplicar challenge interativo
monitorar eventos
```

### 27.3 Anonymous MCP traffic

```txt
http.host eq "mcp.aurelin.org"
and starts_with(http.request.uri.path, "/mcp")
and not http.request.headers["authorization"][0] contains "Bearer "
```

Uso:

```txt
rate limit ou block seletivo
```

### 27.4 Token endpoint

```txt
http.host eq "mcp.aurelin.org"
and http.request.uri.path eq "/oauth/token"
```

Uso:

```txt
rate limit moderado
```

### 27.5 Admin route

```txt
http.host eq "mcp.aurelin.org"
and starts_with(http.request.uri.path, "/admin/")
```

Uso:

```txt
Access/service token/mTLS
```

---

## 28. Riscos e decisões pendentes

### 28.1 Dependência de plano Cloudflare

Algumas features variam por plano:

- quantidade/tipo de Rulesets;
- Rate Limiting avançado;
- API Shield;
- logs/export;
- WAF managed rules;
- Transform Rules avançadas.

Precisamos inventariar o que a conta/zone realmente suporta.

### 28.2 Identidade do cliente ChatGPT

Não devemos presumir IPs fixos, certificados mTLS ou capacidade de enviar headers Access customizados sem confirmação. Por isso, `/mcp` deve permanecer compatível com OAuth próprio.

### 28.3 API Shield

Pode ser muito útil, mas só depois de confirmar forma exata dos tokens e JWKS. Aplicar cedo pode quebrar OAuth/MCP.

### 28.4 Conexões longas

Cloudflare pode encerrar conexões por timeout, deploy, idle ou falha transitória. O sistema deve tolerar reconexão.

### 28.5 Automação de alterações

A automação deve começar read-only. Alterações via API só após:

- diff claro;
- plano textual;
- backup;
- smoke;
- rollback.

---

## 29. Conclusão

O perfil correto para `mcp.aurelin.org` é uma configuração Cloudflare orientada a API/MCP:

```txt
poucos clientes legítimos
alta confiança após autenticação
baixa tolerância a interferência de cache/challenge
alta exigência de observabilidade
controle forte para anônimo/inválido/admin
```

A configuração ideal não remove segurança; ela reposiciona segurança:

- **identidade e OAuth** governam o cliente legítimo;
- **Cloudflare** bloqueia ruído, scanners e abuso anônimo;
- **Access/mTLS/service tokens** protegem rotas administrativas;
- **Cache Rules** impedem cache indevido;
- **Tunnel metrics/Security Events** tornam falhas diagnosticáveis;
- **API automation** garante desired-vs-actual e evita drift.

A diretriz final é:

```txt
Para /mcp autenticado, Cloudflare deve ser quase transparente.
Para tráfego anônimo, inválido ou administrativo, Cloudflare deve ser rigorosa.
```
