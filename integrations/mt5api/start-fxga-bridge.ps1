$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
$bridge = Join-Path $PSScriptRoot "fxga_mt5api_bridge.py"
$config = Join-Path $PSScriptRoot "config.json"
$mt5SecretPath = Join-Path $root "secrets\mt5api-key.dpapi"
$fxgaSecretPath = Join-Path $root "secrets\fxga-token.dpapi"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Get-DpapiPlain([string]$Path) {
    $secure = Get-Content $Path -Raw | ConvertTo-SecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$env:MT5API_SECRET_KEY = Get-DpapiPlain $mt5SecretPath
$env:FXGA_MT5_TOKEN = Get-DpapiPlain $fxgaSecretPath
$env:FXGA_MT5API_CONFIG = $config

Start-Sleep -Seconds 20
$log = Join-Path $logDir "fxga-mt5api-bridge.log"
"[$(Get-Date -Format o)] starting FXGA dceoy/mt5api bridge" | Add-Content $log
& $python $bridge --config $config *>> $log
exit $LASTEXITCODE
