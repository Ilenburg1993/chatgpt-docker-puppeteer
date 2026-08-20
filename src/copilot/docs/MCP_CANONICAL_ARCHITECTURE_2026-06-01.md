# Arquitetura canônica MCP — 2026-06-01

## Decisão canônica

A arquitetura MCP do projeto deve separar quatro papéis, sem misturar servidor, transporte, túnel e
auditoria em um único arquivo:

1. `src/copilot/mcp/cli.js` é o entrypoint canônico do servidor MCP local. Ele só escolhe transporte
   (`stdio`, `http`, `http2`) e sobe o adapter correspondente.
2. `src/copilot/mcp/cloudflare/cli.js` é somente o entrypoint operacional do runtime Cloudflare. Ele
   delega para módulos focados em comandos, processo, runtime, probes e smoke.
3. `src/copilot/mcp/openai/secure-tunnel-cli.js` é uma auditoria específica de prontidão do Secure
   MCP Tunnel/OpenAI; não deve iniciar servidor MCP nem concorrer com Cloudflare.
4. `src/copilot/mcp/scripts/*.js` são suítes de validação, benchmark e auditoria local. Não são
   entrypoints de produção.

## Aplicação feita nesta rodada

- `src/copilot/mcp/cloudflare/cli.js` foi reduzido para entrypoint fino.
- Criados módulos canônicos:
  - `cli-commands.js`: registry e dispatch de comandos.
  - `cli-process.js`: PID, supervisão, versão do `cloudflared` e parada de processos.
  - `cli-runtime.js`: lifecycle do origin MCP + túnel Cloudflare.
  - `cli-probe.js`: probes HTTP/OAuth/MCP e parsing JSON/SSE.
  - `cli-smoke.js`: smoke externo do conector e persistência do estado.

## Por que havia outros CLIs

Eles não devem ser tratados como concorrentes diretos:

- `mcp/cli.js`: servidor MCP local. É o binário de execução real do MCP.
- `mcp/cloudflare/cli.js`: orquestra operação remota via Cloudflare Tunnel.
- `mcp/openai/secure-tunnel-cli.js`: checa readiness do túnel seguro OpenAI.
- `mcp/scripts/*.js`: validações auxiliares e ferramentas de diagnóstico.

O problema real não era a existência de múltiplos CLIs, mas a ausência de uma taxonomia explícita. A
nova regra é: CLIs de servidor sobem transporte MCP; CLIs de túnel orquestram exposição remota;
scripts apenas validam.

## Roadmap arquitetural próximo

1. Criar `src/copilot/mcp/runtime/` para agrupar lifecycle comum entre Cloudflare, OpenAI Secure
   Tunnel e futuros provedores.
2. Criar `src/copilot/mcp/providers/` ou `src/copilot/mcp/tunnels/` com adapters Cloudflare/OpenAI,
   expondo uma interface comum: `plan`, `up`, `down`, `status`, `smoke`.
3. Migrar smoke OAuth genérico de `scripts/oauth-smoke.js` para biblioteca reutilizável, mantendo
   script como wrapper.
4. Transformar `package.json` em façade de scripts, não em fonte de verdade arquitetural.
5. Adicionar validação CI para `node --check` dos entrypoints MCP e para consistência entre scripts
   npm e command registry.

## Invariantes

- `/mcp` é o caminho público canônico.
- Smoke remoto deve enviar `Accept: application/json, text/event-stream` e `MCP-Protocol-Version`.
- Túnel permanente Cloudflare deve preferir token por arquivo quando disponível e validar versão
  compatível do `cloudflared`.
- Nenhum módulo deve ler conteúdo de token; apenas presença/caminho.
- `up`, `down`, `restart`, `status` e `smoke` devem ser idempotentes e produzir JSON estável.
