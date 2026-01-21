# =============================================================================
# Health Check Script for Windows (PowerShell) - v3.0
# =============================================================================
# Usage: powershell -ExecutionPolicy Bypass -File health-windows.ps1 [PORT] [TIMEOUT]
# Default PORT: 2998, TIMEOUT: 2
# Exit codes: 0 = healthy, 1 = unhealthy
# Version: 3.0 (2026-01-21) - Enhanced error handling, robust status validation
# =============================================================================

param(
    [int]$Port = 2998,
    [int]$TimeoutSec = 2
)

# ASCII fallback (setar NO_UNICODE=1 no ambiente para evitar ✓/✗)
$NO_UNICODE = $env:NO_UNICODE -eq '1' -or $env:CI -eq 'true'
if ($NO_UNICODE) {
    $OK = "[OK]"; $FAIL = "[FAIL]"; $WARN = "[WARN]"
} else {
    $OK = "✓"; $FAIL = "✗"; $WARN = "⚠"
}

# Exit tracking
$exitCode = 0

Write-Host ""

# Helper: try parse JSON response robustly
function Get-Json {
    param($uri)
    try {
        # Invoke-RestMethod returns parsed JSON directly (works in PowerShell & pwsh)
        $obj = Invoke-RestMethod -Uri $uri -TimeoutSec $TimeoutSec -ErrorAction Stop
        return $obj
    } catch {
        return $null
    }
}

# 1) PM2 check (exists and at least one process online)
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Host "  $WARN PM2 not installed"
    $exitCode = 1
} else {
    try {
        $pm2Json = & pm2 jlist 2>$null | ConvertFrom-Json
        if ($pm2Json -and ($pm2Json | Where-Object { $_.pm2_env.status -eq 'online' })) {
            Write-Host "  $OK PM2 processes running"
        } else {
            Write-Host "  $FAIL PM2 processes offline"
            $exitCode = 1
        }
    } catch {
        Write-Host "  $FAIL PM2 not responding"
        $exitCode = 1
    }
}

# 2) Main server health (/api/health)
$base = "http://localhost:$Port/api/health"
$root = Get-Json -uri $base
if ($null -ne $root) {
    # Try inspect common fields if present
    $statusVal = $null
    if ($root.PSObject.Members.Name -contains 'status') { $statusVal = $root.status }
    elseif ($root.ContainsKey('status')) { $statusVal = $root['status'] } # defensive

    if ($statusVal) {
        # consider healthy a few possible values
        if ($statusVal -in @('ok','healthy','online','true')) {
            Write-Host "  $OK Server ($Port)"
        } else {
            Write-Host "  $WARN Server ($Port) — status: $statusVal"
            $exitCode = 1
        }
    } else {
        Write-Host "  $OK Server ($Port) (no explicit status field)"
    }
} else {
    Write-Host "  $FAIL Server not responding ($Port)"
    $exitCode = 1
}

# 3) Endpoints: chrome, pm2, kernel, disk
$endpoints = @('chrome','pm2','kernel','disk')
foreach ($ep in $endpoints) {
    $uri = "$base/$ep"
    $json = Get-Json -uri $uri
    if ($null -ne $json) {
        $s = $null
        if ($json.PSObject.Members.Name -contains 'status') { $s = $json.status } elseif ($json.ContainsKey('status')) { $s = $json['status'] }
        if ($s -in @('ok','healthy','online','true')) {
            Write-Host "  $OK /health/$ep"
        } else {
            Write-Host "  $WARN /health/$ep (status: $s)"
            $exitCode = 1
        }
    } else {
        Write-Host "  $FAIL /health/$ep unreachable"
        $exitCode = 1
    }
}

Write-Host ""
exit $exitCode
