$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
$bridge = Join-Path $PSScriptRoot "fxga_mt5api_bridge.py"
$config = Join-Path $PSScriptRoot "config.json"
$mt5SecretPath = Join-Path $root "secrets\mt5api-key.dpapi"
$fxgaSecretPath = Join-Path $root "secrets\fxga-token.dpapi"

function Get-DpapiPlain([string]$Path) {
    $secure = Get-Content $Path -Raw | ConvertTo-SecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$env:MT5API_SECRET_KEY = Get-DpapiPlain $mt5SecretPath
$env:FXGA_MT5_TOKEN = Get-DpapiPlain $fxgaSecretPath

Write-Host "`n==> Health check" -ForegroundColor Cyan
& $python $bridge --config $config --doctor
if ($LASTEXITCODE -ne 0) { throw "Health check failed." }

Write-Host "`n==> Broker symbol discovery" -ForegroundColor Cyan
& $python $bridge --config $config --discover
if ($LASTEXITCODE -ne 0) { throw "Symbol discovery failed." }

Write-Host "`n==> Read-only dry-run synchronization" -ForegroundColor Cyan
& $python $bridge --config $config --once --dry-run
if ($LASTEXITCODE -ne 0) { throw "Dry-run synchronization reported failures." }

Write-Host "`nThe bridge is healthy. To send one real synchronization cycle, run:" -ForegroundColor Green
Write-Host "  & `"$python`" `"$bridge`" --config `"$config`" --once" -ForegroundColor White
