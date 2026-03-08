# CHECKLIST: Iniciar Chrome real (Windows) para validar o Chrome Proxy Service

Objetivo

- Iniciar o Google Chrome no Windows com `--remote-debugging-port` para permitir que o
  proxy/container se conecte ao DevTools.
- NÃO usar `chromium`; usar o Chrome oficial.

Pré-requisitos

- A máquina alvo é Windows (usuário confirmou).
- Google Chrome instalado (caminho padrão: `C:\Program Files\Google\Chrome\Application\chrome.exe`
  ou `C:\Users\<user>\AppData\Local\Google\Chrome\Application\chrome.exe`).
- Porta do Chrome host (DevTools): `9225` (padrão). Ajuste se necessário.
  - Proxy (container-facing) padrão: `9224`.
- Firewall: permita acesso TCP na porta `9225` (Chrome host) se o proxy estiver em outro
  host/container.

1. Verificar instalação do Chrome (PowerShell)

```powershell
$paths = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)
$chrome = $paths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Error "Chrome não encontrado"; exit 1 }
Write-Output "Chrome encontrado em: $chrome"
```

2. Comando para iniciar (PowerShell recomendado)

```powershell
# exemplo (rodar no Windows onde o Chrome está instalado)
Start-Process $chrome -ArgumentList '--remote-debugging-port=9225','--no-first-run','--no-default-browser-check','--disable-gpu' -PassThru
```

Comando direto (cmd.exe):

```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9225 --no-first-run --no-default-browser-check --disable-gpu
```

Observações sobre flags -- `--remote-debugging-port=9225`: essencial.

- `--no-first-run` e `--no-default-browser-check`: minimizam prompts.
- Evite `--no-sandbox` no Windows a menos que seja estritamente necessário.
- `--headless=new` é opcional se desejar headless; para debugging visual, não use headless.

3. Capturar saída / logs

- Windows não redireciona facilmente com `Start-Process`; para depuração imediata, execute o binário
  diretamente em `cmd` para redirecionar:

```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9225 ... > C:\temp\chrome.log 2>&1
```

4. Verificar endpoints DevTools (no Windows ou a partir do host que deve se conectar)

PowerShell:

```powershell
Invoke-RestMethod -Uri http://localhost:9225/json/version
Invoke-RestMethod -Uri http://localhost:9225/json/list
```

Linux / WSL / container (curl):

```bash
curl -sS http:// < WINDOWS_HOST_IP > :9225/json/version | jq .
curl -sS http:// < WINDOWS_HOST_IP > :9225/json/list | jq .
```

5. Iniciar o Chrome Proxy Service (exemplo rodando no container Linux/servidor)

- Ajuste `CHROME_HOST` para o IP acessível do Windows a partir do container

```bash
# rodar no host/container que executa o proxy
# CHROME_PORT refere-se à porta do Chrome no host (9225); CHROME_PROXY_PORT é o endpoint público/container-facing (9224)
CHROME_HOST= CHROME_PROXY_PORT=9224 PUBLIC_IP= < WINDOWS_HOST_IP > CHROME_PORT=9225 < IP_ACESSIVEL_PELA_REDE > node scripts/chrome-proxy-service.js
```

6. Validar através do proxy

```bash
curl -sS http:// < PROXY_HOST > :9224/json/version | jq .
curl -sS http:// < PROXY_HOST > :9224/json/list | jq .
# verifique que webSocketDebuggerUrl aponta para ws://<PROXY_HOST>:9224/...
```

7. Parar o Chrome (Windows)

```powershell
Get-Process chrome* | Stop-Process -Force
```

ou em cmd:

```cmd
taskkill /IM chrome.exe /F
```

8. Segurança e limpeza

- Feche a porta `9224` quando terminar (firewall ou encerrar processo).
- Não deixe `--remote-debugging-port` exposto publicamente sem proteção.

9. Próximos passos sugeridos

- Após iniciar o Chrome no Windows e confirmar `http://<WINDOWS_HOST_IP>:9225/json/version`
  respondendo, envie `Pronto` aqui e eu:
  - rodarei verificações do proxy a partir do container,
  - executarei os testes de integração/e2e apontando para o Chrome real (MOCK_CHROME=0).

---

Arquivo gerado automaticamente por solicitação. Não farei commit/push sem sua autorização.
