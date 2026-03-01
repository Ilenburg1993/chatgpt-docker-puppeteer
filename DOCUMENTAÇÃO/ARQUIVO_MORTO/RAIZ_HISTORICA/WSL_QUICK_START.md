# 🚀 GUIA RÁPIDO - WSL Edition

**Arquitetura**: WSL ↔ Windows Host **Objetivo**: Setup ultra-rápido em 3 comandos

---

## ⚡ Quick Start (3 Passos)

### 1️⃣ Windows Host - Inicie Chrome

**Arquivo**: `START-CHROME-SIMPLE.bat` (no Windows)

```bat
REM Abra CMD ou PowerShell no Windows
REM Navegue até: D:\Área de Trabalho\
START-CHROME-SIMPLE.bat
```

**Deixe rodando** (não feche a janela)

---

### 2️⃣ WSL - Valide Tudo

```bash
# No WSL
cd /workspaces/chatgpt-docker-puppeteer

# Executar validação completa
bash wsl-chrome-integration.sh all
```

**Resultado esperado**: ✅ ALL VALIDATIONS PASSED

---

### 3️⃣ WSL - Execute Testes

```bash
# Se validação passou, execute testes
bash wsl-chrome-integration.sh test
```

---

## 📋 Comandos Úteis

```bash
# Validar apenas Chrome
bash wsl-chrome-integration.sh validate

# Iniciar proxy (Terminal separado)
bash wsl-chrome-integration.sh proxy

# Ver ajuda
bash wsl-chrome-integration.sh help
```

---

## 🔍 Troubleshooting Rápido

### Chrome não acessível

```bash
# Verificar networking WSL
cat /etc/resolv.conf
ping $(grep nameserver /etc/resolv.conf | awk '{print $2}')

# Testar Chrome manualmente
curl http://localhost:9225/json/version
```

### Firewall bloqueando

```powershell
# PowerShell como Admin (Windows)
New-NetFirewallRule -DisplayName "Chrome for WSL" `
    -Direction Inbound -LocalPort 9225 -Protocol TCP -Action Allow
```

---

## ✅ Status

- [x] Scripts criados
- [x] Permissões configuradas
- [ ] **VOCÊ**: Execute validação no WSL
- [ ] **VOCÊ**: Reporte resultado

---

**Próximo passo**: Execute `bash wsl-chrome-integration.sh all` e reporte output
