$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
$secretPath = Join-Path $root "secrets\mt5api-key.dpapi"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (-not (Test-Path $python)) { throw "MT5API Python environment not found: $python" }
if (-not (Test-Path $secretPath)) { throw "MT5API encrypted API key not found: $secretPath" }

$secure = Get-Content $secretPath -Raw | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:MT5API_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

$env:MT5API_HOST = "127.0.0.1"
$env:MT5API_PORT = "8000"
$env:MT5API_LOG_LEVEL = "info"
$env:MT5API_ROUTER_PREFIX = ""

$log = Join-Path $logDir "mt5api.log"
"[$(Get-Date -Format o)] starting dceoy/mt5api on 127.0.0.1:8000" | Add-Content $log
& $python -m mt5api *>> $log
exit $LASTEXITCODE
