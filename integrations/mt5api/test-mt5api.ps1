$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
$bridge = Join-Path $PSScriptRoot "fxga_mt5api_bridge.py"
$config = Join-Path $PSScriptRoot "config.json"
$mt5SecretPath = Join-Path $root "secrets\mt5api-key.dpapi"
$fxgaSecretPath = Join-Path $root "secrets\fxga-token.dpapi"

function Get-DpapiPlain([string]$Path) {
    $encrypted = (Get-Content $Path -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($encrypted)) { throw "Encrypted DPAPI secret file is empty: $Path" }
    $secure = ConvertTo-SecureString -String $encrypted
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Quote-NativeArgument([string]$Value) {
    if ($null -eq $Value) { return '""' }
    return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Invoke-BridgePython([string[]]$Arguments) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $python
    $psi.Arguments = (($Arguments | ForEach-Object { Quote-NativeArgument ([string]$_) }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    if (-not $process.Start()) { throw "Unable to start Python bridge process." }

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result

    [pscustomobject]@{
        ExitCode = $process.ExitCode
        StdOut   = $stdout
        StdErr   = $stderr
    }
}

function Show-BridgeResult($Result) {
    if (-not [string]::IsNullOrWhiteSpace($Result.StdOut)) { Write-Output $Result.StdOut.TrimEnd() }
    # dceoy/mt5api and the FXGA Python bridge use stderr for normal logging.
    # Emit it on PowerShell's success stream so Windows PowerShell 5.1 does not
    # convert INFO/WARNING log lines into NativeCommandError records.
    if (-not [string]::IsNullOrWhiteSpace($Result.StdErr)) { Write-Output $Result.StdErr.TrimEnd() }
}

$env:MT5API_SECRET_KEY = Get-DpapiPlain $mt5SecretPath
$env:FXGA_MT5_TOKEN = Get-DpapiPlain $fxgaSecretPath

Write-Host "`n==> Health check" -ForegroundColor Cyan
$result = Invoke-BridgePython @($bridge, '--config', $config, '--doctor')
Show-BridgeResult $result
if ($result.ExitCode -ne 0) { throw "Health check failed with Python exit code $($result.ExitCode)." }

Write-Host "`n==> Broker symbol discovery" -ForegroundColor Cyan
$result = Invoke-BridgePython @($bridge, '--config', $config, '--discover')
Show-BridgeResult $result
if ($result.ExitCode -ne 0) { throw "Symbol discovery failed with Python exit code $($result.ExitCode)." }

Write-Host "`n==> Read-only dry-run synchronization" -ForegroundColor Cyan
$result = Invoke-BridgePython @($bridge, '--config', $config, '--once', '--dry-run')
Show-BridgeResult $result
if ($result.ExitCode -ne 0) { throw "Dry-run synchronization reported failures (Python exit code $($result.ExitCode))." }

Write-Host "`nThe bridge is healthy. To send one real synchronization cycle, run:" -ForegroundColor Green
Write-Host "  & `"$python`" `"$bridge`" --config `"$config`" --once" -ForegroundColor White
