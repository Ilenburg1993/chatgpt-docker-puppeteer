param(
    [string]$Ports = "3000,3001,3002,3008,9100,9224"
)

$ports = $Ports -split ','
$fail = $false

$netstat = & netstat -ano -p tcp 2>$null
if (-not $?) {
    $netstat = & netstat -ano 2>$null
}

foreach ($p in $ports) {
    $p = $p.Trim()
    if ([string]::IsNullOrEmpty($p)) { continue }

    $lines = $netstat | Where-Object { $_ -match ":$p\b" }
    if (-not $lines -or $lines.Count -eq 0) {
        Write-Output "[FAIL] Port $p: not listening"
        $fail = $true
        continue
    }

    $localhostOnly = $true
    foreach ($line in $lines) {
        # Attempt to extract local address (netstat formats vary)
        $host = ''
        if ($line -match "^\s*\S+\s+(\S+):$p\b") {
            $host = $matches[1]
        } elseif ($line -match "^\s*\S+\s+\[?([^\]]+)\]?:$p\b") {
            $host = $matches[1]
        }

        if ($host -and ($host -ne '127.0.0.1' -and $host -ne '::1' -and $host -ne 'localhost')) {
            $localhostOnly = $false
            break
        }
    }

    if ($localhostOnly) {
        Write-Output "[FAIL] Port $p: bound only to localhost"
        $fail = $true
    } else {
        Write-Output "[OK] Port $p: binding acceptable"
    }
}

if ($fail) { exit 1 } else { exit 0 }
