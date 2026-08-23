[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('Deriv','XM','Exness','HFM')]
    [string]$Broker,
    [string]$AccountType = '',
    [string]$InstallRoot = "$env:LOCALAPPDATA\FXGA\MT5API",
    [string]$OutputPath = ''
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

function Test-LocalMt5Api {
    return $null -ne (Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)
}

function Ensure-LocalMt5Api([string]$Root) {
    if (Test-LocalMt5Api) { return }
    $launcher = Join-Path $Root 'runtime\start-mt5api.ps1'
    if (-not (Test-Path $launcher)) { throw "MT5API launcher not found: $launcher" }
    Write-Host 'MT5API is not listening on 127.0.0.1:8000. Starting it now...' -ForegroundColor Yellow
    Start-Process powershell.exe -WindowStyle Minimized -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',("`"{0}`"" -f $launcher) | Out-Null
    for ($i=0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        if (Test-LocalMt5Api) {
            Write-Host 'MT5API is listening on 127.0.0.1:8000.' -ForegroundColor Green
            return
        }
    }
    $stderr = Join-Path $Root 'logs\mt5api.stderr.log'
    if (Test-Path $stderr) {
        Write-Host "`n=== MT5API STDERR ===" -ForegroundColor Red
        Get-Content $stderr -Tail 80
    }
    throw 'MT5API did not become ready on port 8000 within 30 seconds.'
}

function Add-Unique([System.Collections.Generic.List[string]]$List,[string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return }
    if (-not $List.Contains($Value)) { $List.Add($Value) }
}

$runtimeDir = Join-Path $InstallRoot 'runtime'
$configPath = Join-Path $runtimeDir 'config.json'
$secretPath = Join-Path $InstallRoot 'secrets\mt5api-key.dpapi'
$profilePath = Join-Path $PSScriptRoot 'broker-symbol-profiles.json'
if (-not (Test-Path $configPath)) { throw "FXGA MT5 config not found: $configPath" }
if (-not (Test-Path $secretPath)) { throw "MT5API secret not found: $secretPath" }
if (-not (Test-Path $profilePath)) { throw "Broker symbol profiles not found: $profilePath" }

Ensure-LocalMt5Api $InstallRoot

$profiles = Get-Content $profilePath -Raw | ConvertFrom-Json
$profileProperty = $profiles.brokers.PSObject.Properties[$Broker]
if ($null -eq $profileProperty) { throw "Unknown broker profile: $Broker" }
$profile = $profileProperty.Value

$accountTypes = @($profile.accountTypes.PSObject.Properties.Name)
if ($AccountType) {
    if ($accountTypes -notcontains $AccountType) {
        throw "Unknown account type '$AccountType' for $Broker. Valid values: $($accountTypes -join ', ')"
    }
    $suffixes = @($profile.accountTypes.$AccountType.suffixes)
} else {
    $suffixes = @($profile.accountTypes.PSObject.Properties | ForEach-Object { $_.Value.suffixes } | ForEach-Object { $_ } | Select-Object -Unique)
}

$key = Get-DpapiPlain $secretPath
$headers = @{ 'X-API-Key' = $key }
$response = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/symbols?group=*' -Headers $headers -TimeoutSec 30
$rows = @($response.data)
$available = @($rows | ForEach-Object {
    if ($_ -is [string]) { $_ }
    elseif ($_.PSObject.Properties.Name -contains 'name' -and $null -ne $_.name) { [string]$_.name }
    elseif ($_.PSObject.Properties.Name -contains 'symbol' -and $null -ne $_.symbol) { [string]$_.symbol }
} | Where-Object { $_ })
$availableLookup = @{}
foreach ($symbol in $available) { $availableLookup[$symbol.ToUpperInvariant()] = $symbol }

$cryptoPrefixesProperty = $profile.PSObject.Properties['cryptoPrefixes']
$cryptoPrefixes = if ($null -ne $cryptoPrefixesProperty) { @($cryptoPrefixesProperty.Value) } else { @('') }
if (-not $cryptoPrefixes.Count) { $cryptoPrefixes = @('') }
$cryptoCanonicals = @('BTCUSD','ETHUSD')
$verified = [ordered]@{}
$missing = New-Object System.Collections.Generic.List[string]
$ambiguous = [ordered]@{}
$candidateAudit = [ordered]@{}

foreach ($prop in $profile.symbols.PSObject.Properties) {
    $canonical = [string]$prop.Name
    $bases = @($prop.Value)
    $candidateAudit[$canonical] = New-Object System.Collections.Generic.List[string]
    $selected = $null
    $ambiguousForCanonical = New-Object System.Collections.Generic.List[string]

    foreach ($base in $bases) {
        $matchesForPriority = New-Object System.Collections.Generic.List[string]
        $prefixes = if ($cryptoCanonicals -contains $canonical) { $cryptoPrefixes } else { @('') }
        foreach ($prefix in $prefixes) {
            foreach ($suffix in $suffixes) {
                $candidate = "${prefix}${base}${suffix}"
                Add-Unique $candidateAudit[$canonical] $candidate
                $lookupKey = $candidate.ToUpperInvariant()
                if ($availableLookup.ContainsKey($lookupKey)) {
                    Add-Unique $matchesForPriority $availableLookup[$lookupKey]
                }
            }
        }
        if ($matchesForPriority.Count -eq 1) {
            $selected = $matchesForPriority[0]
            break
        }
        if ($matchesForPriority.Count -gt 1) {
            foreach ($match in $matchesForPriority) { Add-Unique $ambiguousForCanonical $match }
            break
        }
    }

    if ($selected) {
        $verified[$canonical] = $selected
    } elseif ($ambiguousForCanonical.Count -gt 0) {
        $ambiguous[$canonical] = @($ambiguousForCanonical)
    } else {
        $missing.Add($canonical)
    }
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json
if (-not ($config.PSObject.Properties.Name -contains 'symbol_map') -or $null -eq $config.symbol_map) {
    if ($config.PSObject.Properties.Name -contains 'symbol_map') { $config.symbol_map = [pscustomobject]@{} }
    else { $config | Add-Member -NotePropertyName symbol_map -NotePropertyValue ([pscustomobject]@{}) }
}

# Remove stale mappings for every canonical asset managed by this profile, then add only exact verified matches.
$managed = @($profile.symbols.PSObject.Properties.Name)
$newMap = [ordered]@{}
foreach ($prop in $config.symbol_map.PSObject.Properties) {
    if ($managed -notcontains $prop.Name) { $newMap[$prop.Name] = [string]$prop.Value }
}
foreach ($canonical in $verified.Keys) { $newMap[$canonical] = $verified[$canonical] }
$config.symbol_map = [pscustomobject]$newMap

# Replace generic fallback candidates with this broker/account's exact generated names.
# This prevents the bridge from interpreting unrelated prefix matches such as SPXS.US or US10YR.F as canonical assets.
$scopedCandidates = [ordered]@{}
foreach ($canonical in $managed) { $scopedCandidates[$canonical] = @($candidateAudit[$canonical]) }
if ($config.PSObject.Properties.Name -contains 'symbol_candidates') { $config.symbol_candidates = [pscustomobject]$scopedCandidates }
else { $config | Add-Member -NotePropertyName symbol_candidates -NotePropertyValue ([pscustomobject]$scopedCandidates) }

if ($config.PSObject.Properties.Name -contains 'broker_profile') { $config.broker_profile = $Broker }
else { $config | Add-Member -NotePropertyName broker_profile -NotePropertyValue $Broker }
$accountLabel = if ($AccountType) { $AccountType } else { 'auto-from-terminal-exact-symbols' }
if ($config.PSObject.Properties.Name -contains 'broker_account_type') { $config.broker_account_type = $accountLabel }
else { $config | Add-Member -NotePropertyName broker_account_type -NotePropertyValue $accountLabel }

$json = $config | ConvertTo-Json -Depth 30
[IO.File]::WriteAllText($configPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("FXGA MT5 BROKER SYMBOL MAP")
$lines.Add("Generated: $(Get-Date -Format o)")
$lines.Add("Broker: $Broker")
$lines.Add("Requested account type: $accountLabel")
$lines.Add("Terminal symbols exposed: $($available.Count)")
$lines.Add('')
$lines.Add('Verified exact mappings:')
foreach ($canonical in $verified.Keys) { $lines.Add(("  {0,-8} -> {1}" -f $canonical,$verified[$canonical])) }
if ($ambiguous.Count) {
    $lines.Add('')
    $lines.Add('Ambiguous - NOT mapped:')
    foreach ($canonical in $ambiguous.Keys) { $lines.Add("  $canonical -> $($ambiguous[$canonical] -join ', ')") }
}
if ($missing.Count) {
    $lines.Add('')
    $lines.Add('Not found/unsupported on this terminal:')
    foreach ($canonical in $missing) { $lines.Add("  $canonical") }
}
$semanticWarningsProperty = $profile.PSObject.Properties['semanticWarnings']
if ($null -ne $semanticWarningsProperty -and $null -ne $semanticWarningsProperty.Value) {
    $lines.Add('')
    $lines.Add('Semantic notes:')
    foreach ($warning in $semanticWarningsProperty.Value.PSObject.Properties) {
        if ($verified.Contains($warning.Name)) { $lines.Add("  $($warning.Name): $($warning.Value)") }
    }
}
$lines.Add('')
$lines.Add('Policy: exact terminal symbol matches only; ambiguous matches are rejected; no cross-asset fuzzy matching.')
$lines.Add('US2Y/US10Y are not mapped to bond futures because Treasury note/future price is not the Treasury yield series.')
$lines.Add("Updated config: $configPath")

$lines | ForEach-Object { Write-Output $_ }
if ($OutputPath) {
    $parent = Split-Path -Parent $OutputPath
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    [IO.File]::WriteAllLines($OutputPath, $lines, [Text.UTF8Encoding]::new($false))
    Write-Output "Saved report: $OutputPath"
}
