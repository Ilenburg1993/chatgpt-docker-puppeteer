# Sandbox Dependencies Reference

## Overview

Este documento descreve as dependências necessárias para o **sandbox de execução de comandos** usado
pelo GitHub Copilot Agent (Claude).

## O que é o Sandbox?

O sandbox é uma camada de segurança que isola a execução de comandos em um ambiente controlado
usando **Linux namespaces e cgroups**. Funciona como uma "caixa de areia" onde comandos são
executados com:

- **Isolamento de filesystem** (somente acesso ao workspace)
- **Limites de recursos** (CPU, memória, processos)
- **Filtragem de rede** (controle de conexões)
- **Timeout automático** para prevenir comandos infinitos

## Dependências Necessárias

### 1. ripgrep (rg)

- **Versão**: 13.0.0+
- **Finalidade**: Busca ultrarrápida em arquivos (usado pelo sandbox)
- **Status**: ✅ Instalado no Dockerfile (linha ~469)
- **Pacote**: `ripgrep`

### 2. bubblewrap (bwrap)

- **Versão**: 0.8.0+
- **Finalidade**: Container leve para isolamento de processos
- **Status**: ✅ Instalado no Dockerfile (linha ~469)
- **Pacote**: `bubblewrap`
- **Nota**: Requer user namespaces habilitados no kernel

### 3. socat

- **Versão**: 1.7.x+
- **Finalidade**: Relay socket para comunicação entre processos
- **Status**: ✅ Instalado no Dockerfile (linha ~500)
- **Pacote**: `socat`

## Instalação

### Dockerfile (Automático)

Todas as dependências são instaladas automaticamente durante o build do DevContainer.

### Manual (Host Linux)

```bash
sudo apt-get update
sudo apt-get install -y ripgrep bubblewrap socat
```

## Configuração

### VSCode Settings

```jsonc
{
  // Habilita o sandbox (requer todas as 3 dependências)
  "chat.tools.terminal.sandbox.enabled": true,

  // Desabilita o sandbox (modo compatibilidade)
  "chat.tools.terminal.sandbox.enabled": false,
}
```

### Arquivo: `.vscode/settings.json`

## Comportamento em DevContainer

### ⚠️ User Namespaces em Containers

O sandbox pode **não funcionar** em alguns ambientes Docker/DevContainer devido a restrições de
kernel:

```
❌ Erro: "No permissions to create new namespace"
```

**Motivo**: Kernel não permite user namespaces não privilegiados em containers.

### Recomendação para DevContainer

```jsonc
{
  // Recomendado para DevContainer (container já fornece isolamento)
  "chat.tools.terminal.sandbox.enabled": false,
}
```

**Justificativa:**

- Container Docker já fornece isolamento (namespaces + cgroups)
- Sandbox adicional é redundante e pode causar incompatibilidades
- Modo non-sandbox funciona corretamente em ambientes containerizados

## Diagnóstico

### Verificar Instalação

```bash
which rg bwrap socat
```

### Verificar Versões

```bash
rg --version
bwrap --version
socat -V
```

### Testar Sandbox

```bash
# Teste simples de isolamento
bwrap \
  --ro-bind /usr /usr \
  --ro-bind /lib /lib \
  --bind $PWD $PWD \
  --unshare-all \
  echo "Sandbox OK"
```

## Troubleshooting

### Erro: "Sandbox dependencies are not available"

**Solução**: Instalar as 3 dependências (ripgrep, bubblewrap, socat)

### Erro: "No permissions to create new namespace"

**Solução**: Desabilitar sandbox em `.vscode/settings.json`

```jsonc
{
  "chat.tools.terminal.sandbox.enabled": false,
}
```

### Erro: "bubblewrap not found"

**Solução**: Reconstruir DevContainer após adicionar ao Dockerfile

```bash
# No VSCode: Ctrl+Shift+P -> "Rebuild Container"
```

## Referências

- [Bubblewrap Documentation](https://github.com/containers/bubblewrap)
- [ripgrep GitHub](https://github.com/BurntSushi/ripgrep)
- [socat Manual](http://www.dest-unreach.org/socat/)
- [Linux Namespaces](https://man7.org/linux/man-pages/man7/namespaces.7.html)

## Changelog

### 2026-02-07

- ✅ Adicionado bubblewrap ao Dockerfile (v5.2+)
- 📝 Criada documentação de referência
- ⚙️ Sandbox desabilitado por padrão em DevContainer

### Histórico

- ripgrep: Instalado desde v5.1
- socat: Instalado desde v5.1
- bubblewrap: Adicionado em v5.2 (2026-02-07)
