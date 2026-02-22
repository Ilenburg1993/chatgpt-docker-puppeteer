# MIGRATION_TO_WSL

Este documento descreve os passos recomendados para clonar e preparar este repositório no WSL
(Windows Subsystem for Linux) e abrir no VS Code.

## Objetivo

Garantir que o repositório hospedado em GitHub (`origin/main`) seja uma cópia fiel do diretório
local, e preparar um ambiente WSL/VS Code que reproduza o ambiente de desenvolvimento (devcontainer)
com o mínimo de atrito.

## Pré-requisitos no Windows

- Windows 10/11 com WSL2 habilitado e uma distribuição instalada (ex.: Ubuntu).
- VS Code instalado (Stable) com a extensão "Remote - WSL" e "Dev Containers".
- Docker Desktop (opcional para devcontainer) com integração WSL2 habilitada, se for usar o
  devcontainer.
- Conta GitHub e credenciais (SSH ou HTTPS) configuradas.

## Passos rápidos (resumido)

```bash
# no WSL
git clone https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git
cd chatgpt-docker-puppeteer
git fetch origin
git rev-parse --short HEAD  # verificar commit
git status --porcelain      # deve estar limpo
```

## Configurar Git (recomendado)

```bash
git config --global user.name "Seu Nome"
git config --global user.email "seu@email"
git config --global core.autocrlf input
```

`core.autocrlf input` preserva `LF` no checkout em Linux/WSL e converte CRLF apenas ao commitar (bom
para equipes multi-OS).

## Instalar Node.js (recomendado: `nvm`)

Recomendo usar `nvm` para instalar Node 24 (compatível com o projeto):

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.6/install.sh | bash
source ~/.bashrc
nvm install 24
nvm use 24
node -v && npm -v
```

Alternativa (NodeSource):

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## Dependências de sistema (WSL/Ubuntu)

```bash
sudo apt update
sudo apt install -y build-essential make python3 curl git ca-certificates jq
```

Esses pacotes cobrem `node-gyp`, compilação de addons e utilitários usados nos scripts do projeto.

## Instalar dependências do projeto

No diretório do projeto:

```bash
# preferível quando package-lock.json existe
npm ci
# ou, se preferir o fluxo do projeto
make install-deps || true
```

Se `npm ci` falhar por dependências nativas, verifique `python3` e `build-essential` e rode
`npm rebuild`.

## Abrir no VS Code (WSL)

No WSL, execute:

```bash
code .
```

No VS Code aberto na WSL, para usar o devcontainer escolha `Dev Containers: Reopen in Container`
(Command Palette). Isso criará o ambiente previsto por `.devcontainer`.

Observação: o devcontainer depende do Docker (ou do runtime definido em `.devcontainer`); assegure
que o Docker Desktop esteja rodando e com integração WSL habilitada.

## Verificações pós-instalação

- `git status --porcelain` deve estar limpo.
- `npm run lint` ou `make format-code` (se disponível) para checar estilo.
- `make test-fast` ou `npm test` para executar os testes rápidos.
- `make health-core` para checagem rápida de endpoints (quando aplicável).

## Dicas e resolução de problemas

- CRLF / EOL: já incluímos `.gitattributes` no repositório; se ver avisos, rode `git status` e
  `git add --renormalize .` seguido de `git commit -m "chore: normalize EOL"` (apenas se for
  intencional).
- Node-gyp e builds nativos: instale `python3`, `build-essential` e execute
  `npm ci --build-from-source` quando necessário.
- Puppeteer / Chrome: O projeto está desenhado para usar Chrome externo via proxy; veja
  `.devcontainer/devcontainer.json` e variáveis `PUPPETEER_*` no `containerEnv`. Se faltar Chromium
  local, ajuste `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` ou forneça `PUPPETEER_WS_ENDPOINT`.
- Docker: se o devcontainer falhar por Docker, verifique `docker version` e a integração WSL.
- Arquivos grandes / segredos: execute verificações rápidas (opcional) antes de mover o repositório.

## Comandos úteis (FAQ rápido)

- Atualizar branch remoto e verificar divergências:

```bash
git fetch origin
git rev-list --left-right --count origin/main...main
```

- Remover arquivos que ficaram rastreados mas devem ser ignorados:

```bash
git rm -r --cached backups old profile node_modules || true
git commit -m "chore: remove local-only directories from repo" || true
git push origin main
```

## Checklist antes de desligar / trocar máquina

- [ ] Confirme `git rev-parse --short HEAD` com o commit esperado.
- [ ] Verifique `git status --porcelain` (limpo).
- [ ] `npm ci` concluído sem erros.
- [ ] `code .` + devcontainer aberto com sucesso (opcional).

---

Se desejar, eu posso:

- executar uma verificação rápida por arquivos grandes e padrões de segredos no repositório agora;
  ou
- adaptar este guia com comandos específicos para sua distro WSL (Ubuntu, Debian, etc.).
