# Guia de Troubleshooting: SSH Forwarding v5.3
**Versão:** 1.0
**Data:** 03 de Fevereiro de 2026

---

## 🚀 Quick Check: Container Iniciou?

### ✅ SIM - Container Iniciou com Sucesso

**Parabéns!** A migração v5.3 resolveu o problema de build.

**Próximos passos:**
1. [Verificar se SSH está funcionando](#verificar-ssh-funcionando)
2. [Testar git operations](#testar-git-operations)

---

### ❌ NÃO - Container Ainda Não Inicia

**Se você ainda vê erro de mount:**
```
error mounting ... to rootfs at "/ssh-agent"
```

**Causa:** Container antigo ainda existe (cache).

**Solução:**
```bash
# 1. Parar e remover container antigo
docker ps -a
docker rm -f <container-id>

# 2. Remover volumes antigos (opcional, se rebuild não resolver)
docker volume ls | grep devcontainer
docker volume rm <volume-name>

# 3. Rebuild COMPLETO no VS Code
# CMD/CTRL + Shift + P
# > Dev Containers: Rebuild Container Without Cache

# 4. Se ainda falhar, limpar TUDO:
docker system prune -a --volumes
# ⚠️ CUIDADO: Remove TODOS containers/images/volumes não usados
```

---

## 🔍 Verificar SSH Funcionando {#verificar-ssh-funcionando}

### Dentro do Container

```bash
# 1. Verificar se SSH_AUTH_SOCK está definido
echo $SSH_AUTH_SOCK

# Possíveis saídas:
# ✅ /tmp/vscode-ssh-auth-XXXX.sock  → SSH forwarding ativo
# ⚠️  (vazio)                         → SSH não disponível (normal)
```

### Se SSH_AUTH_SOCK Está Vazio

**Isso é NORMAL e ESPERADO quando:**
- SSH agent não está rodando no host
- VS Code não detectou SSH agent ao iniciar container

**Solução: Usar HTTPS para git**
```bash
# Trocar remote para HTTPS
git remote set-url origin https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git

# Git operations funcionarão normalmente
git fetch origin
git push origin main  # Pode pedir credenciais
```

### Se SSH_AUTH_SOCK Está Definido

```bash
# 2. Verificar se socket é válido
test -S "$SSH_AUTH_SOCK" && echo "✅ Socket válido" || echo "❌ Socket inválido"

# 3. Listar chaves SSH
ssh-add -l

# Possíveis saídas:
# ✅ 256 SHA256:xxx... /home/user/.ssh/id_ed25519  → Chave carregada
# ⚠️  The agent has no identities                  → Nenhuma chave (adicionar no host)
# ❌ Could not open a connection to your auth...   → Socket inválido (bug)

# 4. Testar autenticação GitHub
ssh -T git@github.com

# Saída esperada:
# ✅ Hi Ilenburg1993! You've successfully authenticated...
```

---

## 🛠️ Troubleshooting por Sintoma

### Sintoma 1: Container Inicia, Mas SSH Não Funciona

**Verificar:**
```bash
# No HOST (fora do container):
echo $SSH_AUTH_SOCK
ssh-add -l

# Saída esperada:
# ✅ /tmp/ssh-xxx/agent.123  → Agent rodando
# ✅ 256 SHA256:xxx...       → Chave carregada
```

**Se agent não está rodando no host:**
```bash
# Iniciar SSH agent
eval $(ssh-agent -s)
ssh-add ~/.ssh/id_ed25519

# Reiniciar container (VS Code detectará SSH)
# CMD/CTRL + Shift + P > Dev Containers: Rebuild Container
```

**Se agent está rodando mas container não vê:**
```bash
# VS Code pode não ter detectado
# Solução: Fechar VS Code completamente e reabrir

# Windows:
# 1. Fechar todas as janelas VS Code
# 2. Verificar Task Manager (matar processos órfãos)
# 3. Reabrir: code .

# Linux/macOS:
pkill code
code .
```

### Sintoma 2: SSH Funcionava Antes, Parou Depois de Reboot

**Causa:** SSH agent no host não inicia automaticamente.

**Solução permanente (Linux/WSL):**
```bash
# Adicionar ao ~/.bashrc ou ~/.zshrc:
if [ -z "$SSH_AUTH_SOCK" ]; then
  eval $(ssh-agent -s) > /dev/null
  ssh-add ~/.ssh/id_ed25519 2>/dev/null
fi
```

**Solução permanente (Windows + WSL):**
```powershell
# Windows: Habilitar serviço OpenSSH Authentication Agent
# 1. Abrir Services (services.msc)
# 2. Procurar "OpenSSH Authentication Agent"
# 3. Set Startup type: Automatic
# 4. Start service
```

### Sintoma 3: Git Push Pede Senha (Antes Não Pedia)

**Causa:** SSH forwarding não está ativo, git tentando usar SSH sem agent.

**Diagnóstico:**
```bash
# Verificar remote URL
git remote -v

# Se for SSH (git@github.com):
origin  git@github.com:user/repo.git

# E SSH não está funcionando, terá problema
```

**Soluções:**

**Opção A: Ativar SSH**
```bash
# No host, garantir que agent está rodando
eval $(ssh-agent -s)
ssh-add ~/.ssh/id_ed25519

# Rebuild container
```

**Opção B: Mudar para HTTPS (mais simples)**
```bash
git remote set-url origin https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git

# Configurar Git Credential Manager (uma vez):
git config --global credential.helper store
# Primeira push pedirá senha, depois salva
```

### Sintoma 4: Erro "Permission Denied (publickey)"

**Diagnóstico:**
```bash
ssh -vT git@github.com

# Procurar na saída:
# ✅ "debug1: Offering public key: ..."  → Chave sendo testada
# ❌ "debug1: No more authentication..."  → Nenhuma chave disponível
```

**Soluções:**

**Se nenhuma chave oferecida:**
```bash
# No HOST:
ssh-add ~/.ssh/id_ed25519

# Verificar:
ssh-add -l

# Rebuild container
```

**Se chave não está em ~/.ssh:**
```bash
# Verificar onde está a chave
ls -la ~/.ssh/

# Se não existe, criar nova:
ssh-keygen -t ed25519 -C "your_email@example.com"

# Adicionar ao GitHub:
cat ~/.ssh/id_ed25519.pub
# Copiar saída → GitHub Settings → SSH Keys → Add
```

---

## 🎯 Validação Completa

### Checklist de Validação

Execute estes comandos **dentro do container**:

```bash
# 1. Identidade
whoami
# Esperado: node

# 2. SSH variable
echo $SSH_AUTH_SOCK
# Esperado: /tmp/vscode-ssh-auth-xxx.sock OU (vazio)

# 3. Se SSH disponível, testar socket
test -S "$SSH_AUTH_SOCK" && ssh-add -l
# Esperado: Lista de chaves OU "agent has no identities"

# 4. Git remote
git remote -v
# Verificar se é SSH ou HTTPS

# 5. Se SSH, testar GitHub
ssh -T git@github.com
# Esperado: "Hi <username>! You've successfully authenticated..."

# 6. Git operations
git fetch origin
git status
# Esperado: Funciona sem erros
```

**Se TODOS os comandos acima funcionarem: ✅ TUDO OK**

---

## 📋 Comparação: SSH vs HTTPS

### SSH (Requer SSH Agent)

**Prós:**
- ✅ Não pede senha
- ✅ Mais seguro (chaves em vez de passwords)
- ✅ Recomendado para uso intenso

**Contras:**
- ⚠️ Requer SSH agent rodando no host
- ⚠️ Requer chave SSH configurada
- ⚠️ Mais complexo de debugar

**Quando usar:**
- Você já tem SSH agent configurado no host
- Faz muitos git push/pull por dia
- Prefere não guardar passwords

### HTTPS (Sempre Funciona)

**Prós:**
- ✅ Funciona SEMPRE (não depende de SSH)
- ✅ Simples de configurar
- ✅ Git Credential Manager salva senha

**Contras:**
- ⚠️ Pode pedir senha na primeira vez
- ⚠️ Menos "elegante" (mas funcional)

**Quando usar:**
- SSH não está disponível/configurado
- Quer simplicidade
- Container deve funcionar em qualquer ambiente

**Trocar para HTTPS:**
```bash
git remote set-url origin https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git
```

---

## 🐛 Debug Avançado

### Verificar Configuração VS Code

```bash
# Dentro do container, verificar variáveis de ambiente:
env | grep -i ssh

# Esperado ver:
# SSH_AUTH_SOCK=/tmp/vscode-ssh-auth-xxx.sock (se SSH ativo)
# Ou nada (se SSH não disponível)

# NÃO deve ver:
# SSH_AUTH_SOCK=/ssh-agent  ← Configuração antiga (v5.2)
```

### Verificar Mounts Ativos

```bash
# Dentro do container:
mount | grep ssh

# NÃO deve aparecer mount em /ssh-agent
# Se aparecer, container ainda está usando config antiga
# Solução: docker rm -f <container> e rebuild
```

### Logs do VS Code

```bash
# VS Code Output panel:
# CMD/CTRL + Shift + P > View: Show Output
# Select: "Dev Containers" no dropdown

# Procurar por:
# ✅ "SSH forwarding enabled"
# ⚠️ "SSH agent not detected"
# ❌ "error mounting ... /ssh-agent"  ← Config antiga ainda presente
```

---

## 🔄 Reset Completo (Última Recurso)

Se nada funcionar, reset completo:

```bash
# 1. Parar TUDO
docker stop $(docker ps -aq)

# 2. Remover container do projeto
docker ps -a | grep chatgpt-docker-puppeteer
docker rm -f <container-id>

# 3. Remover volumes (CUIDADO: perde cache)
docker volume ls | grep devcontainer
docker volume rm <cada-volume-listado>

# 4. Limpar build cache
docker builder prune -a

# 5. Fechar VS Code COMPLETAMENTE
pkill code  # Linux/macOS
# Windows: Fechar todas as janelas + Task Manager

# 6. Reabrir e rebuild
code .
# CMD/CTRL + Shift + P
# > Dev Containers: Rebuild Container Without Cache

# 7. Esperar build completo (pode levar 5-10 min)
```

---

## 📞 Suporte

### Se Container Não Iniciar

1. ✅ Verificar se arquivos foram editados corretamente:
   - `.devcontainer/devcontainer.json` (mount removido)
   - Linha 721 NÃO deve ter `source=${localEnv:SSH_AUTH_SOCK}`

2. ✅ Verificar logs VS Code (Output panel)

3. ✅ Tentar rebuild sem cache

4. ✅ Se persistir, abrir issue no GitHub com:
   - Log completo do VS Code Output
   - Output de `docker ps -a`
   - Output de `docker logs <container-id>`

### Se Container Inicia Mas SSH Não Funciona

1. ✅ Verificar SSH agent no **host** (não no container)
2. ✅ Considerar usar HTTPS em vez de SSH (mais simples)
3. ✅ Verificar logs do VS Code (Output panel)

---

## ✅ Tudo Funcionando?

**Se você chegou aqui e tudo está OK:**

Parabéns! Migração v5.3 concluída com sucesso. 🎉

**Próximos passos recomendados:**
1. ⭐ Fazer commit das mudanças
2. 📝 Atualizar CHANGELOG.md
3. 🧪 Testar workflow completo de desenvolvimento
4. 📚 Ler documentação completa em `MIGRATION_SSH_V5.3.md`

---

**Fim do Guia de Troubleshooting**
**Versão:** 1.0
**Última Atualização:** 03 de Fevereiro de 2026
