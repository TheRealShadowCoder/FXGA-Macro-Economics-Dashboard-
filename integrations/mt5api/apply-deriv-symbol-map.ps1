[CmdletBinding()]
param(
    [string]$InstallRoot = "$env:LOCALAPPDATA\FXGA\MT5API"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-DpapiPlain([string]$Path) {
    $encrypted = (Get-Content $Path -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($encrypted)) { throw "Encrypted DPAPI secret is empty: $Path" }
    $secure = ConvertTo-SecureString -String $encrypted
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Test-Mt5ApiListening {
    return $null -ne (Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

$configPath = Join-Path $InstallRoot 'runtime\config.json'
$secretPath = Join-Path $InstallRoot 'secrets\mt5api-key.dpapi'
$startScript = Join-Path $InstallRoot 'runtime\start-mt5api.ps1'
$stderrLog = Join-Path $InstallRoot 'logs\mt5api.stderr.log'
if (-not (Test-Path $configPath)) { throw "FXGA MT5 config not found: $configPath" }
if (-not (Test-Path $secretPath)) { throw "MT5API secret not found: $secretPath" }
if (-not (Test-Path $startScript)) { throw "MT5API launcher not found: $startScript" }

if (-not (Test-Mt5ApiListening)) {
    Write-Host "`nMT5API is not listening on 127.0.0.1:8000. Starting it now..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$startScript`"") | Out-Null

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Mt5ApiListening) { $ready = $true; break }
    }
    if (-not $ready) {
        Write-Host "MT5API failed to open port 8000." -ForegroundColor Red
        if (Test-Path $stderrLog) {
            Write-Host "`nLast MT5API stderr lines:" -ForegroundColor Yellow
            Get-Content $stderrLog -Tail 80
        }
        throw "Unable to start local dceoy/mt5api service. Keep MetaTrader 5 open and logged into Deriv, then retry."
    }
    Write-Host "MT5API is listening on 127.0.0.1:8000." -ForegroundColor Green
}

$key = Get-DpapiPlain $secretPath
$headers = @{ 'X-API-Key' = $key }
$response = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/symbols?group=*' -Headers $headers -TimeoutSec 30
$available = @($response.data | ForEach-Object {
    if ($_ -is [string]) { $_ }
    elseif ($null -ne $_.name) { [string]$_.name }
    elseif ($null -ne $_.symbol) { [string]$_.symbol }
} | Where-Object { $_ })

$availableLookup = @{}
foreach ($symbol in $available) { $availableLookup[$symbol.ToUpperInvariant()] = $symbol }

# Current Deriv naming for financial MT5 instruments. These are exact-name candidates only.
$derivCandidates = [ordered]@{
    DXY     = @('DXYUSD')
    SPX     = @('US SP 500','US_500')
    NASDAQ  = @('US Tech 100','US_100')
    DJI     = @('Wall Street 30','US_30')
    VIX     = @('VIXUSD')
    GOLD    = @('XAUUSD')
    WTI     = @('US Oil','WTI_OIL')
    BRENT   = @('UK Brent Oil','CL_BRENT')
    EURUSD  = @('EURUSD')
    GBPUSD  = @('GBPUSD')
    USDJPY  = @('USDJPY')
    USDZAR  = @('USDZAR')
    BTCUSD  = @('BTCUSD')
    ETHUSD  = @('ETHUSD')
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json
if ($null -eq $config.symbol_map) { $config | Add-Member -NotePropertyName symbol_map -NotePropertyValue ([pscustomobject]@{}) }

$verified = [ordered]@{}
$missing = New-Object System.Collections.Generic.List[string]
foreach ($canonical in $derivCandidates.Keys) {
    $match = $null
    foreach ($candidate in $derivCandidates[$canonical]) {
        $keyName = $candidate.ToUpperInvariant()
        if ($availableLookup.ContainsKey($keyName)) { $match = $availableLookup[$keyName]; break }
    }
    if ($match) { $verified[$canonical] = $match }
    else { $missing.Add($canonical) }
}

# Replace only managed Deriv mappings. Treasury yields are intentionally not guessed.
$newMap = [ordered]@{}
foreach ($prop in $config.symbol_map.PSObject.Properties) {
    if (-not $derivCandidates.Contains($prop.Name)) { $newMap[$prop.Name] = [string]$prop.Value }
}
foreach ($canonical in $verified.Keys) { $newMap[$canonical] = $verified[$canonical] }
$config.symbol_map = [pscustomobject]$newMap

$json = $config | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText($configPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

Write-Host "`nDeriv MT5 symbols exposed by terminal: $($available.Count)" -ForegroundColor Cyan
Write-Host "Verified Deriv MT5 mappings:" -ForegroundColor Green
$verified.GetEnumerator() | ForEach-Object { Write-Host ("  {0,-8} -> {1}" -f $_.Key,$_.Value) }
if ($missing.Count) {
    Write-Host "`nNot found on this Deriv MT5 account:" -ForegroundColor Yellow
    $missing | ForEach-Object { Write-Host "  $_" }
}
Write-Host "`nTreasury yields US2Y/US10Y were not guessed. Keep those on the existing secondary data source unless Deriv exposes exact instruments." -ForegroundColor Cyan
Write-Host "Updated: $configPath" -ForegroundColor Green
