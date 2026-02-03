﻿<#
.SYNOPSIS
  Inicia o Google Chrome no Windows com `--remote-debugging-port` de forma robusta.
  Versão: 2.0 (2026-02-01) - Otimizado para integração com Chrome Proxy Service

.DESCRIPTION
  Script robusto para localizar `chrome.exe`, opcionalmente encerrar instâncias existentes,
  iniciar Chrome com um diretório de perfil temporário e verificar o endpoint DevTools.

  Arquitetura: Chrome (localhost:9225) ← Proxy (0.0.0.0:9224) ← Container

  Configurações padrão otimizadas para uso com Chrome Proxy Service.

.PARAMETER Port
    Porta para `--remote-debugging-port` (padrão: 9225 - otimizado para proxy).

.PARAMETER Headless
  Inicia em modo headless (opcional).

.PARAMETER ForceKill
  Encerra processos `chrome` existentes antes de iniciar.

.PARAMETER ChromePath
  Caminho explícito para `chrome.exe` (opcional).

.PARAMETER RemoteAddress
  Endereço de bind do DevTools (padrão: 127.0.0.1 - host local apenas).
  Use 0.0.0.0 para expor em todas interfaces (ATENÇÃO: risco de segurança!).

.EXAMPLE
    .\start-chrome-windows.ps1
    # Inicia Chrome na porta 9225 (padrão para proxy)

.EXAMPLE
    .\start-chrome-windows.ps1 -Port 9225 -ForceKill
    # Força reinício do Chrome na porta 9225

.EXAMPLE
    .\start-chrome-windows.ps1 -Port 9225 -Headless
    # Modo headless (sem interface gráfica)

.NOTES
    Após iniciar Chrome, execute:
    1. node scripts\chrome-proxy-service.js (Terminal 2)
    2. npm run daemon:start (Terminal 3)
#>

param(
    [int]$Port = 9225,
    [switch]$Headless,
    [switch]$ForceKill,
    [string]$ChromePath = '',
    [string]$RemoteAddress = '127.0.0.1'
)

Set-StrictMode -Version Latest

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Write-Host "[$ts] [$Level] $Message"
}

function Find-Chrome {
    param([string]$ExplicitPath)
    if ($ExplicitPath -and (Test-Path $ExplicitPath)) { return (Resolve-Path $ExplicitPath).Path }

    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return (Resolve-Path $p).Path }
    }

    # Tentativa via registro (fallback)
    try {
        $reg = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'
        if (Test-Path $reg) {
            $value = (Get-ItemProperty -Path $reg -ErrorAction Stop).'(default)'
            if ($value -and (Test-Path $value)) { return (Resolve-Path $value).Path }
        }
    } catch {
        # ignore
    }

    return $null
}

function Test-PortOpen {
    param(
        [string]$HostName = '127.0.0.1',
        [int]$Port
    )
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect($HostName, $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(250)
        if (-not $ok) { $client.Close(); return $false }
        $client.EndConnect($iar)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

function Wait-For-DevTools {
    param(
        [int]$Port,
        [string]$HostName = '127.0.0.1',
        [int]$Retries = 30,
        [int]$DelaySeconds = 1
    )
    $url = "http://$HostName:$Port/json/version"
    for ($i = 0; $i -lt $Retries; $i++) {
        try {
            $resp = Invoke-RestMethod -Uri $url -ErrorAction Stop
            if ($resp -and $resp.webSocketDebuggerUrl) {
                return $resp
            }
        } catch {
            # ignore and retry
        }
        Start-Sleep -Seconds $DelaySeconds
    }
    return $null
}

# --- Início ---
try {
    Write-Log "Start script: Port=$Port; Headless=$Headless; ForceKill=$ForceKill; RemoteAddress=$RemoteAddress" 'DEBUG'

    $isAdmin = $false
    try {
        $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        # se falhar, não é crítico
    }
    if (-not $isAdmin) { Write-Log "Recomendado executar este script como Administrador (opcional)." 'WARN' }

    if ($ForceKill) {
        Write-Log "Encerrando instâncias chrome existentes (se houver)..."
        try {
            Get-Process -Name chrome -ErrorAction SilentlyContinue | ForEach-Object {
                Write-Log "Parando PID=$($_.Id)" 'DEBUG'
                Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            }
            Start-Sleep -Seconds 1
        } catch {
            Write-Log "Falha ao encerrar processos chrome: $($_.Exception.Message)" 'WARN'
        }
    }

    if (Test-PortOpen -HostName $RemoteAddress -Port $Port) {
        Write-Log "Porta $Port já parece em uso (localhost). Verifique e pare o processo ou escolha outra porta." 'ERROR'
        Write-Log "Se deseja forçar reinício, execute com -ForceKill e tente novamente." 'ERROR'
        exit 4
    }

    $chromeExe = Find-Chrome -ExplicitPath $ChromePath
    if (-not $chromeExe) {
        Write-Log "Chrome não encontrado automaticamente. Use -ChromePath 'C:\\path\\to\\chrome.exe'." 'ERROR'
        exit 1
    }
    Write-Log "Chrome encontrado em: $chromeExe"

    # Criar user-data-dir temporário para evitar conflitos com perfil do usuário
    $userDataDir = Join-Path -Path $env:TEMP -ChildPath ("chrome-profile-$Port")
    if (-not (Test-Path $userDataDir)) { New-Item -ItemType Directory -Path $userDataDir | Out-Null }
    Write-Log "User data dir: $userDataDir"

    $argList = @(
        "--remote-debugging-port=$Port",
        "--remote-debugging-address=$RemoteAddress",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-popup-blocking",
        "--disable-component-update",
        "--user-data-dir=$userDataDir"
    )

    if ($Headless) {
        $argList += "--headless=new"
    }

    # Recomendações de logging; Chrome escreverá logs em chrome_debug.log dentro do user-data-dir quando --enable-logging for usado
    $argList += "--enable-logging"
    $argList += "--v=1"

    Write-Log "Iniciando Chrome..."
    if ($RemoteAddress -ne '127.0.0.1' -and $RemoteAddress -ne 'localhost') {
        Write-Log "AVISO: DevTools será exposto em $RemoteAddress:$Port. Verifique firewall/segurança." 'WARN'
    }
    try {
        $proc = Start-Process -FilePath $chromeExe -ArgumentList $argList -PassThru
    } catch {
        Write-Log "Falha ao iniciar o processo Chrome: $($_.Exception.Message)" 'ERROR'
        exit 3
    }

    Write-Log "Processo iniciado. PID=$($proc.Id)"

    Write-Log "Aguardando endpoint DevTools em http://$RemoteAddress:$Port/json/version ..."
    $resp = Wait-For-DevTools -Port $Port -HostName $RemoteAddress -Retries 30 -DelaySeconds 1
    if ($resp) {
        Write-Log "DevTools OK: $($resp.webSocketDebuggerUrl)"
        Write-Log "PID: $($proc.Id) | user-data-dir: $userDataDir"
        Write-Host ""
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
        Write-Host "  ✅ CHROME INICIADO COM SUCESSO" -ForegroundColor Green
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
        Write-Host ""
        Write-Host "Configuração:"
        Write-Host "  Porta DevTools:    $Port"
        Write-Host "  PID:               $($proc.Id)"
        Write-Host "  Profile:           $userDataDir"
        Write-Host "  WebSocket:         $($resp.webSocketDebuggerUrl)"
        Write-Host ""
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
        Write-Host "  PRÓXIMOS PASSOS" -ForegroundColor Cyan
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "1. Validar Chrome manualmente:"
        Write-Host "   curl http://localhost:$Port/json/version"
        Write-Host ""
        Write-Host "2. Iniciar Chrome Proxy Service (Terminal 2):"
        Write-Host "   node scripts\chrome-proxy-service.js"
        Write-Host ""
        Write-Host "3. Validar Proxy (após iniciar):"
        Write-Host "   curl http://192.168.0.2:9224/health"
        Write-Host ""
        Write-Host "4. Iniciar sistema (após proxy online):"
        Write-Host "   npm run daemon:start"
        Write-Host ""
        Write-Host "5. Validar sistema completo:"
        Write-Host "   make health"
        Write-Host ""
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "{""pid"":$($proc.Id),""devtools"":""$($resp.webSocketDebuggerUrl)""}"
        exit 0
    } else {
        Write-Log "DevTools não respondeu na porta $Port após tentativas." 'ERROR'
        Write-Log "Verifique $userDataDir\chrome_debug.log e o Firewall/antivírus." 'ERROR'
        exit 2
    }
} finally {
    # não remover user-data-dir automaticamente para facilitar debugging; usuário pode limpar manualmente
}
