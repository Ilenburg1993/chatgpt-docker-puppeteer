# Auditoria Cloudflare 1 — MCP externo do ChatGPT.com vs runtime local `src/copilot`

Data: 2026-05-24 Escopo deste turno: Cloudflare, Cloudflare Tunnel, SDK/API oficial Node/TypeScript,
operação do hostname `mcp.aurelin.org`, e superfície MCP externa usada pelo ChatGPT.com. Modo:
diagnóstico/auditoria somente leitura. Nenhuma transformação foi aplicada no workspace.

---

## 0. Correção conceitual importante

Há duas camadas que não devem ser confundidas:

1. **Runtime local `src/copilot` / GitHub Copilot SDK local / LLM-B no workspace**
   - Código, ferramentas, jobs, indexação, validações, runtime do agente, SSE local, plugins e
     documentação interna.
   - Vive no repositório e roda no Dev Container/host local.
   - Pode existir sem exposição pública.

2. **MCP Server + Cloudflare para ChatGPT.com**
   - Camada de publicação externa para que o ChatGPT.com consiga alcançar o MCP local.
   - Envolve `cloudflared`, Cloudflare Tunnel, hostname público, OAuth do MCP, token de túnel,
     observabilidade e recuperação pós-restart.
   - Deve ser tratada como borda/rede/identidade, não como “SDK Copilot local”.

A integração futura desejável é: o runtime local fornece capacidades; o MCP expõe uma interface
segura; a Cloudflare publica essa interface com alta disponibilidade e observabilidade. Mas as
falhas de cada camada precisam ser diagnosticadas separadamente.

---

## 1. Fontes oficiais lidas neste turno

### 1.1 Cloudflare Fundamentals

Fonte: `https://developers.cloudflare.com/fundamentals/get-started/`

Pontos relevantes:

- Cloudflare exige uma conta antes do uso dos produtos.
- Se múltiplas pessoas administram a conta, a documentação orienta configurar permissões de membros
  para controlar acesso por recurso.
- A documentação separa “Build” de “Protect & Connect”.
- Zero Trust é explicitamente o domínio para proteger usuários/dispositivos internos e recursos
  acessados por eles.
- A área de API aparece como superfície própria, com criação de token, chamadas de API,
  restrição/rotação de tokens e referência REST/GraphQL/SDK.

Aplicação ao nosso caso:

- A ponte ChatGPT.com → MCP deve ficar no domínio **Protect & Connect / Zero Trust / Tunnel**, não
  no domínio do SDK local.
- Tokens da Cloudflare devem ser tratados como credenciais de borda, com menor privilégio, rotação e
  auditoria.
- Um módulo de automação Cloudflare no workspace deve ser uma integração de infraestrutura, separada
  do core Copilot local.

### 1.2 Cloudflare API Node/TypeScript SDK

Fonte: `https://developers.cloudflare.com/api/node/`

Pontos relevantes:

- Instalação oficial: `npm install cloudflare`.
- Uso oficial:
  `import Cloudflare from 'cloudflare'; const client = new Cloudflare({ apiToken: process.env['CLOUDFLARE_API_TOKEN'] })`.
- O SDK inclui tipos TypeScript para parâmetros de request e campos de response.
- Erros da API geram subclasses de `APIError`, com tipos para 400, 401, 403, 404, 422, 429, >=500 e
  falha de conexão.
- O SDK faz retry automático por padrão em erros de conexão, 408, 409, 429 e >=500.
- Timeout padrão de requests: 1 minuto, configurável por cliente ou por request.
- Listagens são paginadas e podem ser consumidas com `for await`.
- O SDK permite obter response bruto e headers via `.asResponse()` / `.withResponse()`.
- Também permite chamadas customizadas/undocumented via `client.get`, `client.post`, etc.,
  respeitando opções do client.
- Há suporte a `fetch` customizado, útil para logging/middleware.

Aplicação ao nosso caso:

- Falta uma integração Cloudflare API de auditoria/diagnóstico no workspace.
- O uso do SDK permitiria confirmar a configuração remota do túnel, ingress/service/hostname e DNS,
  sem depender apenas dos logs do `cloudflared`.
- O SDK deve ser encapsulado por uma camada read-only primeiro, com timeout curto, retries
  controlados e redaction de tokens/IDs sensíveis.
- Como a API é paginada, qualquer ferramenta MCP que liste recursos Cloudflare deve ter limite,
  cursor e sumário, para não reproduzir o problema de payload grande que já existe em outras áreas.

### 1.3 Cloudflare Tunnel: criação por dashboard/API, origem, parâmetros, firewall, métricas e disponibilidade

Fontes principais:

- `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/`
- `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/`
- `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/`
- `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/`
- `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/`
- `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/`
- `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-availability/`
- `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/monitor-tunnels/metrics/`

Pontos relevantes:

- Cloudflare Tunnel usa `cloudflared` como conector.
- Túneis permitem conectar recursos à Cloudflare sem IP público roteável.
- A configuração de Public Hostname/Service é parte crítica do túnel.
- `cloudflared` estabelece conexões outbound-only com a rede Cloudflare.
- Para alta disponibilidade, a documentação afirma que uma instância cria quatro conexões outbound
  para servidores distribuídos em pelo menos dois data centers.
- É possível usar réplicas de `cloudflared` para disponibilidade/failover; réplicas apontam para o
  mesmo túnel.
- Réplicas não são mecanismo de traffic steering inteligente; para steering/failover mais
  sofisticado, a documentação remete a Load Balancers.
- Métricas do `cloudflared` são expostas em formato Prometheus; o endpoint padrão fica em
  `127.0.0.1:<porta>/metrics` fora de containers, e em `0.0.0.0:<porta>/metrics` em ambientes
  containerizados.
- O endereço de métricas pode ser configurado com `--metrics`.

Aplicação ao nosso caso:

- A configuração remota de ingress do túnel precisa ser tratada como fonte de verdade, não apenas o
  default local em código.
- A suspeita `localhost` → IPv6 `::1` é Cloudflare/Tunnel, não GitHub Copilot SDK.
- Dev Containers costumam ter peculiaridades de rede; preferir `127.0.0.1` para origem local evita
  resolução dual-stack inesperada.
- Métricas Prometheus de `cloudflared` ainda não estão integradas ao diagnóstico MCP.
- Alta disponibilidade hoje parece limitada a um processo `cloudflared` local; réplicas ou restart
  supervisionado são upgrades futuros.

---

## 2. Estado atual observado via workspace

### 2.1 Estado do repositório

- Branch: `main`
- HEAD: `cb63f52c`
- Status: limpo
- Dirty: `false`

### 2.2 Estado do túnel

Ferramenta usada: `mcp_tunnel_status`

Resumo:

- Modo: `named-permanent`
- Tunnel name: `workspace-mcp-dev`
- Zone: `aurelin.org`
- Public hostname: `mcp.aurelin.org`
- Public MCP URL: `https://mcp.aurelin.org/mcp`
- Auth para ChatGPT: OAuth
- Local MCP URL: `http://127.0.0.1:3333/mcp`
- Transporte `cloudflared`: `http2`
- Token direto: ausente
- Token file: presente
- Último smoke permanente: `ok`, fresco dentro da janela configurada
- Fallback temporário `trycloudflare`: existe em state file, mas processo morto/stale e ignorado
  para readiness operacional

### 2.3 Inconsistência crítica: origem local em código vs origem remota efetiva

O estado local/config do workspace indica:

- `originUrl`: `http://127.0.0.1:3333`
- `localMcpUrl`: `http://127.0.0.1:3333/mcp`

Mas os logs recentes do `cloudflared` indicam configuração remota efetiva:

```text
"service":"http://localhost:3333"
```

E o próprio log registrou falha:

```text
dial tcp [::1]:3333: connect: connection refused
originService=http://localhost:3333
```

Diagnóstico:

- O código local já tem default correto (`127.0.0.1`).
- O processo `cloudflared` está recebendo configuração remota do túnel com `localhost`.
- Em ambientes onde `localhost` resolve para `::1` antes de `127.0.0.1`, e o servidor MCP escuta em
  `127.0.0.1:3333`, a ponte externa pode falhar intermitentemente.
- Isso é um problema Cloudflare Tunnel/ingress remoto, não um problema do GitHub Copilot SDK local.

Impacto provável:

- Mensagens de “conexão perdida” no ChatGPT.com quando Cloudflare tenta encaminhar para `::1:3333`.
- Falhas intermitentes: nem sempre ocorrem se há retry, reconfiguração, cache, outro socket, ou se o
  origin volta por IPv4 em outra tentativa.
- Diagnóstico local pode parecer saudável, pois `http://127.0.0.1:3333/mcp` funciona localmente.

Prioridade: **P0/P1**.

Ação recomendada futura:

- Auditar remotamente o ingress do túnel via Cloudflare API.
- Trocar o service remoto do public hostname para `http://127.0.0.1:3333`.
- Confirmar que o dashboard/API parou de empurrar `http://localhost:3333`.
- Reiniciar `cloudflared` se necessário.
- Validar logs posteriores: não deve haver `originService=http://localhost:3333` nem
  `dial tcp [::1]:3333`.

---

## 3. Leitura do código Cloudflare local

### 3.1 `src/copilot/mcp/cloudflare/config.js`

Observações:

- `DEFAULT_CLOUDFLARE_ORIGIN_URL = 'http://127.0.0.1:3333'`
- `DEFAULT_CLOUDFLARE_PUBLIC_URL = https://mcp.aurelin.org/mcp`
- Modo default: `named-permanent`
- `normalizeTransportProtocol` aceita `auto`, `http2`, `quic`
- Default de transporte: `http2`
- Comentário justifica `http2`: Dev Containers podem ter egress UDP mais restrito do que HTTPS/TCP.
- `buildManagedTunnelArgs` usa token ou token file.
- `buildQuickTunnelArgs` usa `cloudflared tunnel --url <origin> --no-autoupdate`.
- Não há suporte configurável para `--metrics`.
- Não há suporte explícito para `--loglevel`.
- Não há integração com Cloudflare API SDK.

Conclusão:

- A base local está razoavelmente boa para rodar o túnel.
- O gap principal é que ela não audita nem reconcilia a configuração remota do túnel.

### 3.2 `src/copilot/mcp/cloudflare/cli.js`

Observações:

- Comandos: `doctor`, `quick`, `status`, `smoke`, `up`, `down`, `restart`, `run`.
- `doctor` cruza versão `cloudflared`, health local, public URL validation, pid files e estado
  temporário.
- `status` resume modo permanente/temporário, processo, smoke, URL, auth e ação recomendada.
- `smoke` chama `/health`, metadados OAuth e `tools/list` remoto via MCP JSON-RPC.
- `run` dispara `cloudflared tunnel --no-autoupdate run --token` ou `--token-file`.
- A saída de comandos é JSON, útil para automação.
- Não há comando `audit-remote`/`reconcile` usando a API Cloudflare.
- Não há coleta de métricas Prometheus do `cloudflared`.
- Não há parsing estruturado contínuo de logs além do diagnóstico em `tunnel-status`.

Conclusão:

- O wrapper é operacionalmente útil.
- Falta uma camada de controle Cloudflare remota, ou seja, “o que o dashboard/API está de fato
  servindo?”.

### 3.3 `src/copilot/mcp/tools/tunnel-status.js`

Observações da auditoria anterior, reforçadas agora:

- Detecta `originUsesLocalhost`.
- Detecta `originUsesLoopbackIp`.
- Lê tail do log `src/copilot/.ai/cloudflare/cloudflared.log`.
- Emite recomendação correta: preferir `http://127.0.0.1:3333` em vez de `http://localhost:3333`.

Conclusão:

- O diagnóstico local já sabe apontar o problema.
- Falta transformar o diagnóstico em:
  - check de severidade P0/P1 em health/readiness;
  - sugestão operacional explícita;
  - auditoria remota por API;
  - teste regressivo.

---

## 4. Achados novos Cloudflare-específicos

### CF-01 — Remotely-managed tunnel ainda parece configurado para `localhost`

Severidade: **P0/P1**

Evidência:

- Config local: `127.0.0.1`
- Log remoto/orquestrado: `service=http://localhost:3333`
- Erro observado: `dial tcp [::1]:3333: connect: connection refused`

Hipótese:

- A configuração do Public Hostname no dashboard/Zero Trust ainda está `http://localhost:3333`.
- Como o túnel é remotely-managed, o `cloudflared` recebe essa configuração de Cloudflare e ignora o
  default local do wrapper para o serviço publicado.

Correção futura:

- Usar dashboard ou Cloudflare API para alterar Public Hostname Service para
  `http://127.0.0.1:3333`.
- Criar ferramenta read-only para confirmar essa configuração antes de qualquer alteração.

### CF-02 — Ausência de auditoria remota via Cloudflare API/SDK

Severidade: **P1**

O workspace não parece ter integração com o SDK oficial `cloudflare` para:

- validar account/zone IDs;
- listar túneis;
- obter configuração do túnel;
- checar ingress rules;
- checar DNS/CNAME associado ao public hostname;
- checar token/permission scopes;
- obter audit logs relevantes;
- comparar desejado vs efetivo.

Risco:

- Diagnóstico local pode dizer “ok” enquanto o dashboard empurra `localhost`.
- Drift de configuração pode reaparecer sem ser detectado no PR/teste local.
- Rotação manual de token/hostname pode quebrar a ponte sem alerta claro.

Recomendação:

- Criar `src/copilot/mcp/cloudflare/api-client.js` ou equivalente, isolado do runtime Copilot SDK
  local.
- Criar modo read-only primeiro.
- Variáveis sugeridas:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_ZONE_ID`
  - `COPILOT_MCP_CLOUDFLARE_TUNNEL_ID` ou resolução por nome
- Redaction obrigatória de tokens, tunnel token, account IDs se desejado, zone ID se desejado.
- Timeout baixo, retry controlado, outputs resumidos.

### CF-03 — Falta métrica Prometheus do `cloudflared`

Severidade: **P1/P2**

A documentação oficial mostra que `cloudflared` expõe endpoint Prometheus e que `--metrics` permite
configurar host/porta.

No workspace:

- `TUNNEL_METRICS` não aparece em `src/copilot`.
- `--metrics` não aparece no wrapper Cloudflare lido.
- `mcp_tunnel_status` depende de logs e smoke, mas não de métricas.

Risco:

- Não há visibilidade estruturada para:
  - conexões HA ativas;
  - streams ativos;
  - requests concorrentes;
  - erros/config pushes;
  - versão/config orchestration;
  - saúde de `cloudflared` sem parse de log.
- “Conexão perdida” pode ser correlacionada só por logs soltos, não por série temporal.

Recomendação:

- Adicionar suporte futuro a `COPILOT_MCP_CLOUDFLARE_METRICS_ADDR=127.0.0.1:60123`.
- Incluir `--metrics` no `cloudflared run`.
- Criar ferramenta read-only `mcp_cloudflare_metrics_snapshot`.
- Nunca expor métricas em `0.0.0.0` sem razão; se exposto, proteger no firewall.

### CF-04 — Falta `loglevel` configurável e logging estruturado mais robusto

Severidade: **P2**

No workspace:

- `TUNNEL_LOGLEVEL` não aparece.
- O wrapper usa log file, mas sem controle explícito de nível por config.
- Diagnóstico depende do tail textual.

Recomendação:

- Adicionar `COPILOT_MCP_CLOUDFLARE_LOGLEVEL` com allowlist (`debug`, `info`, `warn`, `error`,
  conforme suporte da versão `cloudflared`).
- Incluir modo temporário de diagnóstico elevado por janela curta.
- Parsear eventos de:
  - config update;
  - ingress service;
  - origin errors;
  - reconnects;
  - edge disconnects;
  - metrics server start.

### CF-05 — Alta disponibilidade ainda é “processo único + retry Cloudflare”

Severidade: **P2**

Pelos dados atuais:

- Há um processo `cloudflared` permanente.
- A documentação oficial diz que uma instância já estabelece quatro conexões outbound-only
  distribuídas.
- Mas a própria documentação também orienta réplicas para disponibilidade/failover de host.
- Não observei estratégia local de supervisor externo robusta além de `up/down/restart` e pid files.

Risco:

- Se o host/devcontainer/processo morrer, a ponte morre.
- Se o restart do workspace ocorrer, a conexão pode cair até o fluxo de post-restart recuperar.
- Réplicas não são triviais em Dev Container local, mas o plano deve reconhecer o limite.

Recomendação:

- Curto prazo: post-restart readiness mais agressivo + smoke + alertas.
- Médio prazo: supervisor local ou systemd/user service fora do container, se aplicável.
- Longo prazo: replica em host estável ou pequena VM, apontando para origem alcançável/segura.
- Para steering real ou alertas de tunnel inactive, avaliar Cloudflare Load Balancers.

### CF-06 — Quick Tunnel histórico ainda existe como fallback conceitual, mas não deve ser fonte de verdade

Severidade: **P2/P3**

Estado atual:

- Fallback `trycloudflare` salvo:
  - `https://gage-bon-beast-contribute.trycloudflare.com/mcp`
  - processo morto
  - stale
  - ignorado para readiness operacional

Risco:

- Documentação ou prompts antigos podem instruir usar Quick Tunnel.
- URLs `trycloudflare` mudam e geram perda de conexão no ChatGPT connector.
- O usuário pode confundir fallback temporário com ponte estável.

Recomendação:

- Tratar Quick Tunnel apenas como emergência/desenvolvimento.
- Documentação deve dizer: fonte de verdade é `https://mcp.aurelin.org/mcp`.
- Health deve continuar ignorando fallback temporário para readiness do modo permanente.

### CF-07 — Segurança de token e permissões Cloudflare ainda não auditada via API

Severidade: **P1/P2**

A documentação oficial de Fundamentals destaca API tokens, permissões, restrição e rotação.

No workspace:

- Há token file para o túnel.
- Não há evidência de API token read-only para auditoria.
- Não há checagem automatizada de permissões mínimas.

Recomendação:

- Criar token de auditoria Cloudflare separado do tunnel token.
- Permissões mínimas: leitura de Zero Trust/Tunnel, leitura de DNS/Zone, leitura de audit logs
  quando necessário.
- Para alterações futuras, usar token separado e escopo mínimo.
- Ferramentas MCP de Cloudflare devem ser read-only por padrão; qualquer write deve exigir plano e
  confirmação.

### CF-08 — Falta detector “remote desired state vs observed local state”

Severidade: **P1**

Estado desejado:

```json
{
  "publicHostname": "mcp.aurelin.org",
  "publicMcpUrl": "https://mcp.aurelin.org/mcp",
  "originService": "http://127.0.0.1:3333",
  "auth": "OAuth",
  "transportProtocol": "http2"
}
```

Estado observado:

```json
{
  "localOrigin": "http://127.0.0.1:3333",
  "logRemoteIngressService": "http://localhost:3333",
  "originError": "dial tcp [::1]:3333: connect: connection refused"
}
```

Gap:

- Não existe uma função declarativa “compare desejado vs efetivo remoto”.
- Esse é o check que teria impedido a falsa confiança.

Recomendação:

- Criar uma ferramenta `mcp_cloudflare_remote_audit`:
  - read-only;
  - retorna `ok`, `warnings`, `critical`;
  - compara remote tunnel config com desired config local;
  - reporta drift;
  - nunca retorna tokens.

### CF-09 — Health atual é bom, mas pode esconder drift intermitente

Severidade: **P2**

O smoke atual pode passar mesmo se a configuração remota tem `localhost`, porque:

- o problema pode ser intermitente;
- retries podem mascarar;
- a origem pode responder em outra janela;
- a conexão testada pode não reproduzir o caminho exato do ChatGPT UI;
- o teste não compara config remota declarativa.

Recomendação:

- Health Cloudflare deve ter duas dimensões:
  1. **Liveness**: consigo chamar `/health` e `tools/list`?
  2. **Correctness**: o túnel remoto está configurado exatamente com o origin service esperado?

### CF-10 — API Cloudflare deve ser isolada do core Copilot SDK local

Severidade: **Arquitetural / P2**

Como o usuário observou, não se deve misturar:

- GitHub Copilot SDK local / runtime agente / workspace tools;
- Cloudflare API/Tunnel/OAuth/public hostname.

Recomendação arquitetural:

```text
src/copilot/
  mcp/
    cloudflare/
      config.js              # já existe
      cli.js                 # já existe
      state.js               # já existe
      remote-api.js          # futuro: Cloudflare SDK read-only/write-plan
      remote-audit.js        # futuro: desired vs actual
      metrics.js             # futuro: Prometheus snapshot parser
      docs/                  # runbooks Cloudflare específicos
```

O módulo Cloudflare deve expor fatos para o MCP, mas não deve importar runtime Copilot SDK local
exceto onde estritamente necessário para smoke de ferramentas.

---

## 5. Hipótese refinada para “conexão perdida” no ChatGPT.com

### Causa principal provável

A configuração remota do Cloudflare Tunnel usa `http://localhost:3333`, o que pode resolver para
`::1`. O MCP local escuta em `127.0.0.1:3333`. Quando Cloudflare tenta encaminhar para `::1:3333`,
recebe `connection refused`.

### Causas secundárias possíveis

1. **Payload longo**
   - Chamadas grandes como `job_get_output` ou `repo_tree` excessivo podem degradar a UI.
   - Isso é MCP/runtime payload, não Cloudflare puro, mas passa pela mesma ponte.

2. **SSE/streaming local**
   - O runtime local tinha evidência de timeout/heartbeat muito apertados.
   - Isso pertence mais ao `src/copilot` local, não ao Cloudflare, mas afeta percepção no
     ChatGPT.com.

3. **Restart ou stale state**
   - Se `cloudflared` reinicia ou recebe config update, pode haver janela de queda.
   - Health pós-restart precisa diferenciar liveness local, config remota e smoke externo.

4. **Ausência de métricas**
   - Sem Prometheus snapshot, não é fácil correlacionar perda com active streams, HA connections ou
     config pushes.

---

## 6. Plano recomendado de continuidade — Cloudflare first

### Fase 1 — Auditoria remota read-only

Objetivo: confirmar a configuração efetiva no dashboard/API.

Tarefas:

1. Adicionar dependência oficial `cloudflare`, ou usar se já existir.
2. Criar client read-only:
   - lê `CLOUDFLARE_API_TOKEN`;
   - exige `CLOUDFLARE_ACCOUNT_ID`;
   - timeout configurável;
   - retries baixos;
   - redaction em todos os outputs.
3. Implementar `mcp_cloudflare_remote_audit` read-only:
   - account resolve;
   - tunnel resolve por nome/ID;
   - tunnel config;
   - ingress rules;
   - public hostname service;
   - DNS record associado;
   - tunnel status se disponível.
4. Comparar com desired local:
   - expected hostname `mcp.aurelin.org`;
   - expected service `http://127.0.0.1:3333`;
   - expected MCP URL `/mcp`;
   - expected OAuth issuer/public URL.

Resultado esperado:

```json
{
  "ok": false,
  "critical": [
    "Remote ingress service is http://localhost:3333; expected http://127.0.0.1:3333"
  ],
  "fixPlanAvailable": true,
  "writesPerformed": false
}
```

### Fase 2 — Correção controlada do ingress remoto

Objetivo: trocar `localhost` por `127.0.0.1`.

Tarefas:

1. Gerar plano de mudança sem aplicar.
2. Mostrar diff desired vs current.
3. Aplicar via dashboard ou API com confirmação.
4. Reiniciar/aguardar config push.
5. Confirmar logs:
   - config update com `service=http://127.0.0.1:3333`;
   - ausência de `dial tcp [::1]:3333`;
   - smoke ok.

### Fase 3 — Métricas e observabilidade

Objetivo: reduzir diagnóstico por “achismo”.

Tarefas:

1. Adicionar `COPILOT_MCP_CLOUDFLARE_METRICS_ADDR`.
2. Passar `--metrics 127.0.0.1:<porta>` para `cloudflared`.
3. Criar snapshot read-only de métricas.
4. Expor no `mcp_tunnel_status`:
   - HA connections;
   - active streams;
   - concurrent requests;
   - config version;
   - build/version info;
   - metrics endpoint status.

### Fase 4 — Hardening de docs e runbooks

Objetivo: parar regressão por documentação antiga.

Tarefas:

1. Remover instruções que sugiram `localhost` como service do public hostname.
2. Marcar Quick Tunnel como fallback emergencial.
3. Criar runbook “Cloudflare permanent tunnel — source of truth”.
4. Separar docs:
   - Cloudflare MCP externo;
   - runtime local `src/copilot`;
   - GitHub Copilot SDK local.

### Fase 5 — Disponibilidade

Objetivo: reduzir quedas em restart/process failure.

Tarefas:

1. Avaliar supervisor persistente do `cloudflared`.
2. Health pós-restart:
   - local HTTP;
   - tunnel process;
   - Cloudflare config;
   - public smoke;
   - OAuth metadata;
   - MCP `tools/list`.
3. Considerar réplicas de `cloudflared` se houver host estável.
4. Avaliar Load Balancer se precisar steering/health alert sofisticado.

---

## 7. Matriz de prioridade

| ID    | Achado                                              | Severidade | Tipo            | Próximo passo                                         |
| ----- | --------------------------------------------------- | ---------: | --------------- | ----------------------------------------------------- |
| CF-01 | Remote ingress usa `localhost` e gera `::1` refused |      P0/P1 | Correção infra  | Confirmar via API/dashboard e trocar para `127.0.0.1` |
| CF-02 | Falta auditoria remota via Cloudflare API           |         P1 | Upgrade         | Criar client read-only com SDK oficial                |
| CF-08 | Falta desired-vs-actual remoto                      |         P1 | Upgrade         | Criar `mcp_cloudflare_remote_audit`                   |
| CF-03 | Sem métricas Prometheus do `cloudflared`            |      P1/P2 | Observabilidade | Suportar `--metrics` e snapshot                       |
| CF-07 | Permissões/tokens Cloudflare não auditados          |      P1/P2 | Segurança       | Token read-only separado e checagem de escopo         |
| CF-04 | Sem `loglevel` configurável                         |         P2 | Operação        | Allowlist e diagnóstico temporário                    |
| CF-05 | HA limitada a processo único                        |         P2 | Disponibilidade | Supervisor/réplicas/Load Balancer futuro              |
| CF-06 | Quick Tunnel histórico pode confundir               |      P2/P3 | Documentação    | Despromover nos docs e prompts                        |
| CF-09 | Smoke pode mascarar drift                           |         P2 | Diagnóstico     | Separar liveness de correctness                       |
| CF-10 | Risco de misturar Cloudflare com Copilot SDK local  |         P2 | Arquitetura     | Módulo Cloudflare isolado                             |

---

## 8. Checklist de validação após futura correção

Depois de qualquer mudança Cloudflare:

1. `mcp_tunnel_status`
   - `originUsesLocalhost: false`
   - `originUsesLoopbackIp: true`
   - `recentOriginErrors` sem `::1`
2. Logs `cloudflared`
   - novo config push mostra `service=http://127.0.0.1:3333`
3. Public smoke
   - `/health` OK
   - OAuth metadata OK
   - `tools/list` OK
4. ChatGPT connector
   - URL permanece `https://mcp.aurelin.org/mcp`
   - OAuth permanece ativo
5. UI ChatGPT.com
   - sem “conexão perdida” em chamadas longas moderadas
6. Metrics futuro
   - HA connections > 0
   - active streams coerentes
   - sem crescimento de erros de origin

---

## 9. Conclusão

A auditoria Cloudflare reforça que o principal risco atual não está no GitHub Copilot SDK local, mas
na camada de publicação externa MCP+Cloudflare: o túnel permanente está operacional, mas há forte
evidência de drift remoto no ingress service (`localhost`) que contradiz o desired local
(`127.0.0.1`) e já produziu erro `dial tcp [::1]:3333`.

O próximo passo mais valioso não é mexer no runtime local; é criar ou executar uma auditoria remota
Cloudflare, preferencialmente com o SDK oficial Node/TypeScript, para verificar a configuração
efetiva do túnel e corrigir o service do public hostname. Em paralelo, a ponte precisa ganhar
métricas Prometheus e um modelo claro de desired-vs-actual, para que “conexão perdida” deixe de ser
tratada apenas por logs e smoke eventual.
