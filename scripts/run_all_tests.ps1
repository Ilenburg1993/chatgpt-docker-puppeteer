# =============================================================================
# RUN ALL TESTS (PowerShell Edition - Audit Level 5)
# =============================================================================
# Orquestrador de testes E2E para o Agente ChatGPT.
# Funcionalidades: Limpeza de ambiente, execução sequencial, timing e relatório.
# =============================================================================

$ErrorActionPreference = "Stop"

# --- Configuração de Cores ---
$C_RESET = [ConsoleColor]::White
$C_INFO  = [ConsoleColor]::Cyan
$C_OK    = [ConsoleColor]::Green
$C_WARN  = [ConsoleColor]::Yellow
$C_FAIL  = [ConsoleColor]::Red

function Log($color, $msg) {
    Write-Host -ForegroundColor $color $msg
}

# --- Inicialização ---
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Join-Path $scriptDir ".."
Push-Location $scriptDir

Log $C_INFO "`n==== SUÍTE DE TESTES DE INTEGRAÇÃO (NÍVEL 5) ===="
Log $C_INFO "Diretório de Testes: $scriptDir"
Log $C_INFO "Diretório Raiz:    $rootDir"

# --- Validação de Ambiente ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Log $C_FAIL "[FATAL] Node.js não encontrado no PATH."
    exit 1
}

# --- Função de Limpeza de Estado ---
function Clean-Environment {
    param([string]$context)
    # Log $C_WARN "  [Clean] Limpando ambiente ($context)..."

    # 1. Remove Lockfile
    $lockFile = Join-Path $rootDir "RUNNING.lock"
    if (Test-Path $lockFile) {
        Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
    }

    # 2. Limpa Fila de Testes (test-*.json)
    $queueDir = Join-Path $rootDir "fila"
    if (Test-Path $queueDir) {
        Get-ChildItem $queueDir -Filter "test-*.json" | Remove-Item -Force -ErrorAction SilentlyContinue
    }

    # 3. Limpa Logs e Tmp
    $tmpDir = Join-Path $scriptDir "tmp"
    if (-not (Test-Path $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null }
    Get-ChildItem $tmpDir -File | Remove-Item -Force -ErrorAction SilentlyContinue
    
    # 4. (Opcional) Mata processos Node zumbis
    # Get-Process node -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -eq ""} | Stop-Process -Force -ErrorAction SilentlyContinue
}

# --- Lista de Testes ---
# Ordem importa: Lock primeiro (infra), depois lógica de negócio.
$tests = @(
    "tests/test_lock.js",
    "tests/test_schema_validation.js", # Adicionado
    "tests/test_control_pause.js",
    "tests/test_running_recovery.js",
    "tests/test_stall_mitigation.js"
)
$startTimeTotal = Get-Date
$failedCount = 0

# --- Loop de Execução ---
foreach ($testFile in $tests) {
    Log $C_INFO "`n-------------------------------------------------------------"
    Log $C_INFO "EXEC: $testFile"
    Log $C_INFO "-------------------------------------------------------------"

    Clean-Environment -context "pre-$testFile"
    
    $testPath = Join-Path $scriptDir $testFile
    if (-not (Test-Path $testPath)) {
        Log $C_FAIL "[SKIP] Arquivo não encontrado: $testFile"
        $failedCount++
        continue
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    
    # Executa o teste isolado
    try {
        $p = Start-Process -FilePath "node" -ArgumentList $testFile -NoNewWindow -PassThru -Wait
        $sw.Stop()
        
        if ($p.ExitCode -eq 0) {
            Log $C_OK "[PASS] $testFile ($($sw.Elapsed.TotalSeconds.ToString("N2"))s)"
        } else {
            Log $C_FAIL "[FAIL] $testFile falhou com Exit Code $($p.ExitCode)"
            $failedCount++
            # Opcional: Break on first failure
            break
        }
    } catch {
        Log $C_FAIL "[CRITICAL] Erro ao invocar Node.js: $_"
        $failedCount++
        break
    }
}

Clean-Environment -context "post-all"
Pop-Location

# --- Relatório Final ---
$duration = (Get-Date) - $startTimeTotal
Log $C_INFO "`n============================================================="
Log $C_INFO "RELATÓRIO FINAL"
Log $C_INFO "Tempo Total: $($duration.TotalSeconds.ToString("N2"))s"

if ($failedCount -eq 0) {
    Write-Host -ForegroundColor $C_OK -BackgroundColor DarkGreen "  SUCESSO: TODOS OS TESTES PASSARAM.  "
    exit 0
} else {
    Write-Host -ForegroundColor White -BackgroundColor DarkRed "  FALHA: $failedCount TESTE(S) FALHARAM.  "
    Log $C_FAIL "Verifique os logs em ../logs/ e artifacts em tmp/ para detalhes."
    exit 1
}