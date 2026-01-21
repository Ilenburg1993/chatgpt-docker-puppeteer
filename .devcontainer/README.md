# Dev Container Documentation

**Version:** 2.0
**Last Updated:** January 21, 2026
**Project:** chatgpt-docker-puppeteer

## 📋 Overview

This Dev Container provides a **fully configured development environment** for the chatgpt-docker-puppeteer project. Everything is set up automatically, so you can start coding immediately after opening the container.

## 🎯 What's Included

### Base Image
- **Node.js 20** (LTS) on Debian Bullseye
- Pre-configured with npm, git, and common utilities

### Features (Auto-Installed)

| Feature              | Purpose                           | Version |
| -------------------- | --------------------------------- | ------- |
| **common-utils**     | Bash, git, curl, wget, zsh        | Latest  |
| **docker-in-docker** | Docker support inside container   | Latest  |
| **git**              | Advanced Git with LFS support     | Latest  |
| **github-cli**       | `gh` command for GitHub workflows | Latest  |
| **node**             | nvm for multiple Node versions    | 20      |

### Ports Forwarded

| Port     | Service                        | Protocol  | Auto-Open |
| -------- | ------------------------------ | --------- | --------- |
| **2998** | Dashboard (Express API)        | HTTP      | Notify    |
| **3008** | Socket.io Server               | HTTP      | Notify    |
| **9229** | Node.js Debugger (Primary)     | Inspector | Silent    |
| **9230** | Node.js Debugger (Alternative) | Inspector | Silent    |

### VS Code Extensions (Auto-Installed)

**Core Essentials:**
- `dbaeumer.vscode-eslint` - ESLint linting
- `esbenp.prettier-vscode` - Code formatting
- `ms-azuretools.vscode-docker` - Docker support

**AI & Productivity:**
- `GitHub.copilot` - AI coding assistant
- `GitHub.copilot-chat` - AI chat interface
- `usernamehw.errorlens` - Inline error messages

**Build & Tools:**
- `ms-vscode.makefile-tools` - Makefile support
- `christian-kohler.npm-intellisense` - npm imports autocomplete
- `christian-kohler.path-intellisense` - Path autocomplete

**Git:**
- `eamodio.gitlens` - Git supercharged (blame, history, compare)

See [extensions.json](../.vscode/extensions.json) for the complete list (23 extensions).

### Volumes & Mounts

| Type       | Source                      | Target                    | Purpose                     |
| ---------- | --------------------------- | ------------------------- | --------------------------- |
| **bind**   | `.git/`                     | `${workspaceFolder}/.git` | Fast Git operations         |
| **volume** | `devcontainer-node_modules` | `node_modules/`           | Better performance          |
| **volume** | `devcontainer-profile`      | `profile/`                | Persistent browser profiles |
| **volume** | `devcontainer-logs`         | `logs/`                   | Don't pollute workspace     |

### Environment Variables

```bash
NODE_ENV=development
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
FORCE_COLOR=1
LOG_LEVEL=debug
TZ=America/Sao_Paulo
LANG=pt_BR.UTF-8
```

## 🚀 Getting Started

### First Time Setup

1. **Open in Container:**
   - Open project in VS Code
   - Click "Reopen in Container" notification (or Ctrl+Shift+P → "Dev Containers: Reopen in Container")
   - Wait 5-8 minutes for initial build

2. **Automatic Setup:**
   - `npm ci` installs dependencies (clean install)
   - `setup-devcontainer.sh` configures environment:
     - Installs PM2 globally
     - Installs Chromium dependencies (~200MB)
     - Configures Git defaults
     - Creates directories (fila/, respostas/, logs/, etc)
     - Sets permissions
   - `make info && make health` shows system status

3. **Configure Git (Important!):**
   ```bash
   git config --global user.name "Your Name"
   git config --global user.email "your@email.com"
   ```

4. **Start Coding:**
   ```bash
   make help    # See all commands
   make start   # Start PM2 agent + dashboard
   make health  # Check system health
   ```

### Daily Workflow

**Morning Routine:**
```bash
make info           # Check configuration
make health         # Verify system health
make start          # Start services
make logs-follow    # Monitor logs
```

**Development:**
```bash
make dev            # Start in dev mode (nodemon)
make test-all       # Run all tests
make lint-fix       # Fix lint issues
F5                  # Start debugging (VS Code)
```

**Evening Routine:**
```bash
make stop           # Stop all services
git add .           # Stage changes
git commit -m "..."  # Commit
make git-push-safe  # Lint + test + push
```

See [DEVELOPER_WORKFLOW.md](../DEVELOPER_WORKFLOW.md) for complete guide.

## 🔄 Lifecycle Hooks

The Dev Container runs commands automatically at different stages:

| Hook                  | Command                              | When                     | Purpose                    |
| --------------------- | ------------------------------------ | ------------------------ | -------------------------- |
| **onCreateCommand**   | `npm ci`                             | Once (container created) | Clean install dependencies |
| **postCreateCommand** | `bash scripts/setup-devcontainer.sh` | Once (after create)      | Setup environment          |
| **postStartCommand**  | `make info && make health \|\| true` | Every start              | Show status                |
| **postAttachCommand** | `echo '✅ DevContainer ready! ...'`   | Every attach             | Welcome message            |

## 🛠️ Advanced Usage

### Rebuild Container

When you update `devcontainer.json`:
1. Ctrl+Shift+P → "Dev Containers: Rebuild Container"
2. Wait 5-8 minutes for rebuild
3. Container restarts with new configuration

### Access Host Docker

If Docker-in-Docker fails, you can use the host's Docker:

1. Edit `devcontainer.json`:
   ```json
   // Comment out docker-in-docker feature
   // "ghcr.io/devcontainers/features/docker-in-docker:2": { ... }

   // Add mount for Docker socket
   "mounts": [
     "source=/var/run/docker.sock,target=/var/run/docker.sock,type=bind"
   ]
   ```

2. Rebuild container

### Run as Root (Not Recommended)

For debugging only:
```json
"remoteUser": "root",
"containerUser": "root"
```

### Adjust Resources

If your machine is limited:
```json
"hostRequirements": {
  "cpus": 2,      // Reduce from 4
  "memory": "2gb", // Reduce from 4gb
  "storage": "16gb" // Reduce from 32gb
}
```

Minimum recommended: 2 CPUs, 2GB RAM

## 🐛 Troubleshooting

### Issue: Container Build Fails

**Symptoms:** Error during "Creating Dev Container"

**Solutions:**
1. Check Docker Desktop is running
2. Ensure enough disk space (>10GB)
3. Try: Docker Desktop → Settings → Resources → Increase limits
4. Clean Docker: `docker system prune -a`
5. Rebuild: Ctrl+Shift+P → "Dev Containers: Rebuild Without Cache"

### Issue: Ports Not Forwarding

**Symptoms:** Can't access localhost:2998 or localhost:3008

**Solutions:**
1. Check port forwarding: View → Ports panel
2. Manually forward: Right-click port → Forward Port
3. Check firewall settings on host
4. Verify service is running: `make health`

### Issue: Extensions Not Installing

**Symptoms:** Recommended extensions not installed

**Solutions:**
1. Check internet connection
2. Manually install: Extensions panel (Ctrl+Shift+X) → Search → Install
3. Reload window: Ctrl+Shift+P → "Developer: Reload Window"
4. Check extensions.json is valid

### Issue: Permission Denied Errors

**Symptoms:** Can't write to files, mkdir fails

**Solutions:**
1. Verify `remoteUser: node` in devcontainer.json
2. Verify `updateRemoteUserUID: true` is set
3. Check directory ownership: `ls -la`
4. Fix permissions: `sudo chown -R node:node /workspaces/chatgpt-docker-puppeteer`

### Issue: Chromium/Puppeteer Fails

**Symptoms:** `Error: Could not find browser`

**Solutions:**
1. Verify Chromium installed: `which chromium`
2. Re-run setup: `bash scripts/setup-devcontainer.sh`
3. Install manually: `sudo apt-get install chromium chromium-sandbox`
4. Check env: `echo $PUPPETEER_EXECUTABLE_PATH` (should be `/usr/bin/chromium`)

### Issue: Docker-in-Docker Not Working

**Symptoms:** `docker: command not found` or `Cannot connect to Docker daemon`

**Solutions:**
1. Check Docker service: `docker ps`
2. Restart Docker: `sudo service docker restart`
3. Use host Docker instead (see "Access Host Docker" section)
4. Check privileged mode (some hosts require it):
   ```json
   "privileged": true  // Not recommended, security risk
   ```

### Issue: Slow Performance

**Symptoms:** Container feels sluggish, high CPU/RAM usage

**Solutions:**
1. **node_modules volume**: Already optimized (in volume, not bind mount)
2. **Reduce watchers**: Check `files.watcherExclude` in settings
3. **Adjust resources**: Increase CPUs/RAM in hostRequirements
4. **Disable GitLens**: If slow, disable "Current Line Blame"
5. **Clean logs**: `make clean` to remove old logs
6. **Docker Desktop**: Settings → Resources → Increase limits

### Issue: Git Issues

**Symptoms:** Git commands fail, "fatal: not a git repository"

**Solutions:**
1. Verify .git mount: `ls -la .git`
2. Check bind mount in devcontainer.json
3. Rebuild container
4. Clone repository again in container

## 📚 Resources

### Official Documentation
- [Dev Containers Specification](https://containers.dev/)
- [VS Code Dev Containers](https://code.visualstudio.com/docs/devcontainers/containers)
- [devcontainer.json Reference](https://containers.dev/implementors/json_reference/)

### Project Documentation
- [README.md](../README.md) - Project overview
- [DEVELOPER_WORKFLOW.md](../DEVELOPER_WORKFLOW.md) - Development guide
- [ARCHITECTURE.md](../DOCUMENTAÇÃO/ARCHITECTURE.md) - System architecture
- [Makefile](../Makefile) - All make commands (49 targets)

### Getting Help
1. Check this README first
2. Run `make help` for command list
3. Run `make diagnose` for system diagnostics
4. Check logs: `make logs-follow`
5. Open issue on GitHub

## 🔐 Security

### Best Practices Implemented

✅ **Non-root user** (`remoteUser: node`)
✅ **UID matching** (`updateRemoteUserUID: true`)
✅ **Unprivileged container** (`privileged: false`)
✅ **Isolated volumes** (node_modules, profile, logs)
✅ **Read-only mounts** (where applicable)

### Security Considerations

⚠️ **Docker-in-Docker**: Requires elevated permissions. If concerned, use host Docker instead.
⚠️ **Port forwarding**: Only localhost by default. Don't expose externally without firewall.
⚠️ **Secrets**: Never commit secrets. Use environment variables or .env files (gitignored).

## 📊 Performance Tips

### Optimize Build Time
- First build: 5-8 minutes (downloads features)
- Subsequent builds: 1-2 minutes (uses cache)
- Rebuild without cache: 5-8 minutes

### Optimize Runtime Performance
- ✅ node_modules in volume (not bind mount) - **Fast**
- ✅ .git in bind mount with `consistency=cached` - **Fast**
- ✅ File watcher exclusions configured - **Fast**
- ✅ Search exclusions configured - **Fast**

### Disk Space Usage
- Base image: ~1GB
- Features: ~500MB
- node_modules: ~400MB
- Chromium dependencies: ~200MB
- **Total**: ~2.1GB

### Memory Usage
- Idle: ~500MB
- Development: ~1-2GB
- Running agent: ~2-3GB
- **Recommended**: 4GB RAM allocated

## 🎓 Tips & Tricks

### Quick Commands
```bash
# Makefile shortcuts
make s     # Short for make start
make h     # Short for make health
make l     # Short for make logs-follow
make t     # Short for make test-all

# Git shortcuts
make g     # Short for make git-changed (show changes)
make v     # Short for make vscode-info

# Quick operations
make quick CMD=pause   # Pause queue
make quick CMD=resume  # Resume queue
```

### Debugging
```bash
# Use launch.json configurations (F5)
# See .vscode/launch.json for 22 debug configs

# Compound configs (debug multiple processes)
- Full System Debug (Agent + Dashboard)
- Complete Test Suite (P1-P5 + Driver Integration)

# Attach to running PM2
- Attach to PM2 Process (port 9229)
- Attach to PM2 Process (Alternative Port 9230)
```

### Productivity
- **Error Lens**: See errors inline (no need to check Problems panel)
- **GitLens**: Hover over line to see Git blame
- **Path Intellisense**: Autocomplete paths as you type
- **TODO Tree**: View → Open View → TODO Tree

### Keyboard Shortcuts
- `Ctrl+Shift+P`: Command Palette
- `Ctrl+``: Toggle Terminal
- `Ctrl+Shift+E`: Explorer
- `Ctrl+Shift+F`: Search
- `Ctrl+Shift+G`: Source Control
- `F5`: Start Debugging
- `Ctrl+F5`: Run Without Debugging

---

**Last Updated:** January 21, 2026
**Maintained By:** Project Team
**Feedback:** Open an issue on GitHub
