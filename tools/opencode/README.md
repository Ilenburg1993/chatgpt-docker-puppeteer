# OpenCode + Ollama (integração de dev)

Este repo já tem a estrutura ideal para usar **OpenCode** como assistente de desenvolvimento
(TUI/CLI) e **Ollama** como provider local (privacidade + custo previsível).

## 1) Instalação rápida

### OpenCode

- Instalar o CLI (conforme docs oficiais do OpenCode/Ollama):
  - `curl -fsSL https://opencode.ai/install | bash`

### Ollama

- Instalar e iniciar o daemon do Ollama (host).
- Baixar um modelo “coder” via `ollama pull ...`.

## 1.1) Melhor topologia no WSL + DevContainer

Recomendação prática para “WSL Container” (VS Code DevContainer rodando via Docker no WSL2):

- **Nível 0 (Windows Host)**: Docker Desktop e serviços de máquina.
- **Nível 1 (WSL sem container)**: onde o repositório vive (filesystem Linux).
- **Nível 2 (WSL com container / DevContainer)**: onde o Node do projeto roda (e onde o OpenCode
  deve rodar).

- **Ollama roda no host (WSL/Windows)** para manter pesos/cache fora do container e facilitar GPU.
- **OpenCode roda dentro do DevContainer**, porque é onde seus `npm run ...` e scripts do repo
  rodam.
- O DevContainer acessa o Ollama via `http://host.docker.internal:11434`.

Se você preferir, também funciona rodar o OpenCode no host (WSL) e apontar para Ollama local, mas
você perde a garantia de que os comandos/paths/Node version são exatamente os do container.

Observação importante do seu cenário:

- Se o Docker é via **Docker Desktop no Windows**, então `host.docker.internal` (visto do
  DevContainer) normalmente aponta para o **Windows**.
- A forma mais estável tende a ser **rodar o Ollama no Windows** e expor `11434` (bind + firewall),
  e o DevContainer acessa via `host.docker.internal`.

## 2) Configuração (templates)

Copie um dos templates abaixo para o seu config global do OpenCode:

- Linux/macOS: `~/.config/opencode/opencode.jsonc`
- Windows: use o diretório equivalente do OpenCode (ou rode no WSL)

### Host (OpenCode no host, Ollama em localhost)

- Template: `tools/opencode/opencode.ollama.local.example.jsonc`

### DevContainer (OpenCode dentro do container, Ollama no host)

- Template: `tools/opencode/opencode.ollama.devcontainer.example.jsonc`

### Multi-provider (Ollama + Claude + OpenAI)

- Template: `tools/opencode/opencode.multi-provider.example.jsonc`
- Use quando quiser:
  - modelos locais (Ollama) como padrão para privacidade/custo
  - e fallback/alternância para Claude/OpenAI conforme necessidade

## 2.1) Checklist de conectividade (DevContainer → Ollama)

1. No host onde o Ollama roda (Windows ou WSL), valide:
   - `curl -sS http://127.0.0.1:11434/api/version`

2. Garanta que o Ollama aceite conexões “fora do localhost”.
   - Em geral, configure `OLLAMA_HOST=0.0.0.0:11434` (ou equivalente) e reinicie o serviço.
   - Objetivo: o host “escutar” na interface que o Docker enxerga.

3. Dentro do DevContainer, valide:
   - `curl -sS http://host.docker.internal:11434/api/version`
   - `curl -sS http://host.docker.internal:11434/v1/models`

4. Se `host.docker.internal` não resolver ou o tráfego não chegar:
   - Descubra o “gateway” do host: `ip route | awk '/default/ {print $3}'`
   - Teste direto pelo IP: `curl -sS http://<gateway-ip>:11434/api/version`
   - (Opcional) Ajuste o DevContainer para mapear `host.docker.internal` para `host-gateway`. Isso é
     uma mudança de infra e deve ser feito em `.devcontainer/devcontainer.json`.

## 2.2) Persistência do OpenCode no DevContainer

No DevContainer atual, `~/.config/opencode` já fica sob o volume compartilhado de
`/home/node/.config`, então o config do OpenCode persiste entre rebuilds normais.

Leitura prática:

- você ainda deve manter um “source of truth” no repo (templates em `tools/opencode/`), porque isso
  facilita auditoria, versionamento de exemplos e recovery manual;
- não é mais necessário criar um mount separado só para `~/.config/opencode`, porque o mount
  canônico de `.config` já cobre esse caminho;
- se o volume do DevContainer for destruído manualmente, o estado some junto com ele, então os
  templates do repo continuam sendo o backup operacional correto.

## 3) Uso neste repositório

- Rode `opencode` na raiz do repo.
- OpenCode vai carregar automaticamente:
  - `OpenCode.md` (memória do projeto)
  - `.opencode/commands/*` (comandos customizados)

Comandos úteis no TUI:

- `/validate` (roda `npm run validate:all` e sugere correções)
- `/ollama-check` (testa DNS + conectividade Ollama do DevContainer)
- `/triage-chrome` (sanidade de Chrome/Proxy)

## 4) Observação importante (escopo)

- Esta integração é **de desenvolvimento** (assistente para engenharia).
- Substituir o runtime “Puppeteer → UI” por “API local (Ollama)” exigiria um modo novo de execução
  (drivers API), não apenas troca de modelo.

## 5) Como conviver com Copilot/Codex/Claude (recomendação prática)

- Trate cada assistente como “UI diferente” para o mesmo kit:
  - **Fonte de verdade**: comandos do repo (`npm run ...`) + docs em `DOCUMENTAÇÃO/`
  - **Ações repetíveis**: `.opencode/commands/*` (OpenCode) e `tasks.json` (VSCode) chamando os
    mesmos scripts
- Política simples:
  - **Copilot**: autocompletar/refactors pequenos e locais
  - **OpenCode**: tarefas maiores orientadas a comandos (lint/test/triage) com contexto do repo
  - **Codex CLI**: mudanças multi-arquivo + execução/validação automatizada no container
  - **Claude**: revisão/ideação/arquitetura; usar API com governança (não enviar segredos)
