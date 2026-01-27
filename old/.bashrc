# =============================================================================
# .bashrc - ChatGPT Docker Puppeteer DevContainer
# Version: 3.1 FINAL (23/01/2026)
# =============================================================================
#
# OBJETIVO:
# • UX informativo mas nao poluidor
# • Compativel com Linux / Docker / WSL2
# • Aliases e funcoes uteis para desenvolvimento
# • Prompt com Git integration
# • Deteccao inteligente de ambiente
#
# ESTRATEGIA:
# • Versao balanceada: minimalismo + produtividade
# • Funcionalidades opcionais (detecta dependencias)
# • Chrome remoto: validacao automatica (nao-bloqueante)
#
# CHANGELOG v3.1:
# • Nome consistente: ChatGPT Docker Puppeteer
# • Welcome message atualizado
# • Encoding UTF-8 limpo
#
# v3.0:
# • Consolidado versao minimalista + completa
# • npm aliases, docker aliases, funcoes uteis
# • Removido FZF integration (opcional)
#
# =============================================================================

# -----------------------------------------------------------------------------
# Protecao basica
# -----------------------------------------------------------------------------
# Evita execucao duplicada
[[ -n "${__DEVCONTAINER_BASHRC_LOADED:-}" ]] && return
export __DEVCONTAINER_BASHRC_LOADED=1

# Bash apenas
[ -z "$BASH_VERSION" ] && return

# Non-interactive shell: sai imediatamente
[[ $- != *i* ]] && return

# -----------------------------------------------------------------------------
# Deteccao de ambiente
# -----------------------------------------------------------------------------
IS_CONTAINER=false
IS_WSL2=false
HOST_OS="Unknown"

if grep -qa docker /proc/1/cgroup 2>/dev/null || [ -f /.dockerenv ]; then
    IS_CONTAINER=true
fi

if grep -qi microsoft /proc/version 2>/dev/null; then
    IS_WSL2=true
    HOST_OS="WSL2"
elif $IS_CONTAINER; then
    HOST_OS="Container"
else
    HOST_OS="Linux"
fi

# -----------------------------------------------------------------------------
# Environment Variables
# -----------------------------------------------------------------------------
export EDITOR=vim
export VISUAL=vim
export PAGER=less
export HISTSIZE=10000
export HISTFILESIZE=20000
export HISTCONTROL=ignoreboth:erasedups
export HISTTIMEFORMAT='%F %T '

# Prompt colors (for later use)
export COLOR_RESET='\[\e[0m\]'
export COLOR_USER='\[\e[36m\]'
export COLOR_HOST='\[\e[36m\]'
export COLOR_PATH='\[\e[33m\]'
export COLOR_GIT='\[\e[35m\]'
export COLOR_PROMPT='\[\e[32m\]'

# -----------------------------------------------------------------------------
# Aliases - System
# -----------------------------------------------------------------------------
alias ll='ls -lah --color=auto'
alias la='ls -A --color=auto'
alias l='ls -CF --color=auto'
alias ls='ls --color=auto'

alias grep='grep --color=auto'
alias fgrep='fgrep --color=auto'
alias egrep='egrep --color=auto'

alias df='df -h'
alias du='du -h'
alias free='free -h'

alias ..='cd ..'
alias ...='cd ../..'
alias ....='cd ../../..'

# Modern CLI tools (se disponiveis)
command -v bat >/dev/null 2>&1 && alias cat='bat --style=plain'
command -v fd >/dev/null 2>&1 && alias find='fd'
command -v rg >/dev/null 2>&1 && alias grep='rg'

# -----------------------------------------------------------------------------
# Aliases - Git
# -----------------------------------------------------------------------------
alias gs='git status -sb'
alias ga='git add'
alias gaa='git add --all'
alias gc='git commit'
alias gcm='git commit -m'
alias gco='git checkout'
alias gcb='git checkout -b'
alias gb='git branch'
alias gba='git branch -a'
alias gbd='git branch -d'
alias gl='git log --oneline --graph --decorate'
alias gll='git log --graph --pretty=format:"%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset" --abbrev-commit'
alias gp='git push'
alias gpl='git pull'
alias gd='git diff'
alias gds='git diff --staged'
alias gst='git stash'
alias gstl='git stash list'
alias gstp='git stash pop'

# -----------------------------------------------------------------------------
# Aliases - npm
# -----------------------------------------------------------------------------
alias ni='npm install'
alias nci='npm ci'
alias nr='npm run'
alias nrd='npm run dev'
alias nrt='npm run test'
alias nrb='npm run build'
alias nrs='npm run start'
alias nls='npm list --depth=0'

# -----------------------------------------------------------------------------
# Aliases - Docker (se container com acesso ao Docker host)
# -----------------------------------------------------------------------------
alias d='docker'
alias dc='docker compose'
alias dps='docker ps'
alias dpsa='docker ps -a'
alias di='docker images'
alias dex='docker exec -it'
alias dlogs='docker logs -f'
alias dstop='docker stop'
alias drm='docker rm'
alias drmi='docker rmi'
alias dprune='docker system prune -af'

# -----------------------------------------------------------------------------
# Funcoes Git
# -----------------------------------------------------------------------------
parse_git_branch() {
    command -v git >/dev/null 2>&1 || return
    git symbolic-ref --short HEAD 2>/dev/null
}

parse_git_dirty() {
    command -v git >/dev/null 2>&1 || return
    git diff --quiet --ignore-submodules HEAD 2>/dev/null || echo '*'
}

# -----------------------------------------------------------------------------
# Funcoes Uteis
# -----------------------------------------------------------------------------

# mkdir + cd
mkcd() {
    mkdir -p "$1" && cd "$1"
}

# Extract archives
extract() {
    if [ -f "$1" ]; then
        case "$1" in
            *.tar.bz2)   tar xjf "$1"    ;;
            *.tar.gz)    tar xzf "$1"    ;;
            *.bz2)       bunzip2 "$1"    ;;
            *.rar)       unrar x "$1"    ;;
            *.gz)        gunzip "$1"     ;;
            *.tar)       tar xf "$1"     ;;
            *.tbz2)      tar xjf "$1"    ;;
            *.tgz)       tar xzf "$1"    ;;
            *.zip)       unzip "$1"      ;;
            *.Z)         uncompress "$1" ;;
            *.7z)        7z x "$1"       ;;
            *)           echo "'$1' cannot be extracted via extract()" ;;
        esac
    else
        echo "'$1' is not a valid file"
    fi
}

# Find process by name
psgrep() {
    ps aux | grep -v grep | grep -i -e VSZ -e "$1"
}

# Show container info (se estiver em container)
devinfo() {
    echo "=== DevContainer Info ==="
    echo "Hostname: $(hostname)"
    echo "User: $(whoami)"
    echo "Node.js: $(node --version 2>/dev/null || echo 'not found')"
    echo "npm: $(npm --version 2>/dev/null || echo 'not found')"
    echo "Git: $(git --version 2>/dev/null || echo 'not found')"
    echo "PWD: $PWD"
    echo "Host OS: $HOST_OS"
    
    if [ -f /home/node/.image-info ]; then
        echo ""
        echo "=== Image Info ==="
        cat /home/node/.image-info
    fi
    
    if command -v chromium >/dev/null 2>&1; then
        echo ""
        echo "Chromium: $(chromium --version 2>/dev/null || echo 'not accessible')"
    fi
    
    echo "========================="
}

# -----------------------------------------------------------------------------
# Prompt
# -----------------------------------------------------------------------------
# Indicador de OS (emoji)
if [ "$HOST_OS" = "WSL2" ]; then
    OS_INDICATOR="🪟"
elif $IS_CONTAINER; then
    OS_INDICATOR="🐳"
else
    OS_INDICATOR="🐧"
fi

# Construir prompt com Git
if command -v git >/dev/null 2>&1; then
    PS1="${COLOR_USER}\u${COLOR_RESET}@${COLOR_HOST}${OS_INDICATOR}$(hostname)${COLOR_RESET}:${COLOR_PATH}\w${COLOR_RESET} ${COLOR_GIT}\$(parse_git_branch)\$(parse_git_dirty)${COLOR_RESET}\n${COLOR_PROMPT}\$${COLOR_RESET} "
else
    PS1="${COLOR_USER}\u${COLOR_RESET}@${COLOR_HOST}${OS_INDICATOR}$(hostname)${COLOR_RESET}:${COLOR_PATH}\w${COLOR_RESET}\n${COLOR_PROMPT}\$${COLOR_RESET} "
fi

# -----------------------------------------------------------------------------
# Shell Options
# -----------------------------------------------------------------------------
shopt -s checkwinsize  # Update LINES and COLUMNS after each command
shopt -s histappend    # Append to history file, don't overwrite
shopt -s cdspell       # Autocorrect typos in path names when using cd
shopt -s nocaseglob    # Case-insensitive globbing

# -----------------------------------------------------------------------------
# Completion
# -----------------------------------------------------------------------------
if [ -f /usr/share/bash-completion/bash_completion ]; then
    . /usr/share/bash-completion/bash_completion
elif [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
fi

# Git completion (se disponivel)
if [ -f /usr/share/bash-completion/completions/git ]; then
    . /usr/share/bash-completion/completions/git
fi

# npm completion (se disponivel)
if command -v npm >/dev/null 2>&1; then
    eval "$(npm completion 2>/dev/null)" || true
fi

# -----------------------------------------------------------------------------
# Chrome Remoto (validacao automatica, nao-bloqueante)
# -----------------------------------------------------------------------------
if [[ -n "${CHROME_REMOTE_HOST:-}" && -n "${CHROME_REMOTE_PORT:-}" ]]; then
    if command -v curl >/dev/null 2>&1; then
        if curl -s --connect-timeout 2 "http://${CHROME_REMOTE_HOST}:${CHROME_REMOTE_PORT}/json/version" >/dev/null 2>&1; then
            echo "🌐 Chrome remoto acessivel (${CHROME_REMOTE_HOST}:${CHROME_REMOTE_PORT})"
        else
            echo "⚠️  Chrome remoto NAO acessivel (${CHROME_REMOTE_HOST}:${CHROME_REMOTE_PORT})"
            echo "   Inicie: chrome.exe --remote-debugging-port=${CHROME_REMOTE_PORT}"
        fi
    fi
fi

# -----------------------------------------------------------------------------
# Welcome Message (apenas em container)
# -----------------------------------------------------------------------------
if $IS_CONTAINER && [[ -z "${DEVCONTAINER_QUIET:-}" ]]; then
    echo ""
    echo "╔════════════════════════════════════════╗"
    echo "║   ChatGPT Docker Puppeteer v3.1       ║"
    echo "╚════════════════════════════════════════╝"
    echo ""
    echo "📦 Container: $(hostname)"
    echo "🐳 Node.js: $(node --version 2>/dev/null || echo 'not found')"
    echo "📂 Workspace: /workspaces/chatgpt-docker-puppeteer"
    echo ""
    echo "💡 Comandos uteis:"
    echo "   devinfo    - Info completa do container"
    echo "   gs         - Git status"
    echo "   ll         - Lista detalhada"
    echo ""
fi

# -----------------------------------------------------------------------------
# Cleanup
# -----------------------------------------------------------------------------
unset IS_CONTAINER IS_WSL2 HOST_OS OS_INDICATOR
unset COLOR_RESET COLOR_USER COLOR_HOST COLOR_PATH COLOR_GIT COLOR_PROMPT
