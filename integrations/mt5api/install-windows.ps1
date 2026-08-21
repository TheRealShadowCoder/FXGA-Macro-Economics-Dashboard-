[CmdletBinding()]
param(
    [string]$InstallRoot = "$env:LOCALAPPDATA\FXGA\MT5API",
    [string]$FxgaIngressUrl = "https://fxga-mt5-signal-ingress-kbjj66blka-uc.a.run.app",
    [string]$UpstreamCommit = "ea2ed8fdf53e2a765a50e24b7f74700e03b3e378",
    [switch]$SkipScheduledTasks
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Ensure-Command([string]$Command, [string]$WingetId) {
    if (Get-Command $Command -ErrorAction SilentlyContinue) { return }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "$Command is required and winget is not available. Install $Command manually, then rerun this script."
    }
    Write-Step "Installing $Command"
    winget install --exact --id $WingetId --accept-package-agreements --accept-source-agreements --silent
    $env:PATH = [Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH", "User")
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "$Command was installed but is not yet on PATH. Open a new PowerShell window and rerun the script."
    }
}

function New-RandomSecret([int]$Bytes = 32) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $buffer = New-Object byte[] $Bytes
        $rng.GetBytes($buffer)
        return ([System.BitConverter]::ToString($buffer)).Replace("-", "").ToLowerInvariant()
    } finally {
        $rng.Dispose()
    }
}

function Save-DpapiSecureString([Security.SecureString]$Secure, [string]$Path) {
    $dir = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $Secure | ConvertFrom-SecureString | Set-Content -Encoding UTF8 $Path
}

if ($env:OS -ne "Windows_NT") {
    throw "dceoy/mt5api requires Windows because the official MetaTrader5 Python package is Windows-only."
}

Write-Step "Checking prerequisites"
Ensure-Command "git" "Git.Git"

$python = $null
foreach ($candidate in @("py", "python")) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
        try {
            if ($candidate -eq "py") {
                & py -3.12 -c "import sys; assert sys.version_info >= (3,11)" 2>$null
                if ($LASTEXITCODE -eq 0) { $python = "py -3.12"; break }
            } else {
                & python -c "import sys; assert sys.version_info >= (3,11)" 2>$null
                if ($LASTEXITCODE -eq 0) { $python = "python"; break }
            }
        } catch {}
    }
}
if (-not $python) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Python 3.11-3.14 is required. Install Python 3.12 and rerun this script."
    }
    Write-Step "Installing Python 3.12"
    winget install --exact --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements --silent
    $python = "py -3.12"
}

$sourceBridge = Join-Path $PSScriptRoot "fxga_mt5api_bridge.py"
$sourceConfig = Join-Path $PSScriptRoot "config.example.json"
if (-not (Test-Path $sourceBridge)) { throw "Bridge source not found: $sourceBridge" }
if (-not (Test-Path $sourceConfig)) { throw "Config template not found: $sourceConfig" }

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$upstream = Join-Path $InstallRoot "upstream\mt5api"
$venv = Join-Path $InstallRoot ".venv"
$runtime = Join-Path $InstallRoot "runtime"
$secrets = Join-Path $InstallRoot "secrets"
$logs = Join-Path $InstallRoot "logs"
New-Item -ItemType Directory -Force -Path $runtime,$secrets,$logs | Out-Null

Write-Step "Cloning pinned dceoy/mt5api upstream"
if (-not (Test-Path (Join-Path $upstream ".git"))) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $upstream) | Out-Null
    git clone https://github.com/dceoy/mt5api.git $upstream
}
Push-Location $upstream
try {
    git fetch --tags --prune origin
    git checkout --detach $UpstreamCommit
    $actual = (git rev-parse HEAD).Trim()
    if ($actual -ne $UpstreamCommit) { throw "Pinned upstream checkout failed: $actual" }
} finally {
    Pop-Location
}

Write-Step "Creating isolated Python environment"
if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) {
    if ($python -eq "py -3.12") {
        & py -3.12 -m venv $venv
    } else {
        & python -m venv $venv
    }
}
$venvPython = Join-Path $venv "Scripts\python.exe"
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install $upstream

Write-Step "Installing FXGA bridge files"
Copy-Item -Force $sourceBridge (Join-Path $runtime "fxga_mt5api_bridge.py")
$configPath = Join-Path $runtime "config.json"
if (-not (Test-Path $configPath)) {
    $cfg = Get-Content $sourceConfig -Raw | ConvertFrom-Json
    $cfg.fxga_ingress_url = $FxgaIngressUrl.TrimEnd("/")
    $cfg | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $configPath
}

$mt5ApiSecretPath = Join-Path $secrets "mt5api-key.dpapi"
if (-not (Test-Path $mt5ApiSecretPath)) {
    $plain = New-RandomSecret 32
    $secure = ConvertTo-SecureString $plain -AsPlainText -Force
    Save-DpapiSecureString $secure $mt5ApiSecretPath
    $plain = $null
}

$fxgaTokenPath = Join-Path $secrets "fxga-token.dpapi"
if (-not (Test-Path $fxgaTokenPath)) {
    Write-Host ""
    Write-Host "FXGA Cloud ingress authentication is required." -ForegroundColor Yellow
    Write-Host "Paste the EXISTING FXGA MT5 webhook token used by your current MQL5 exporter." -ForegroundColor Yellow
    Write-Host "It will be stored only as a Windows DPAPI-encrypted value for this Windows user." -ForegroundColor DarkYellow
    $fxgaSecure = Read-Host "FXGA MT5 token" -AsSecureString
    if ($fxgaSecure.Length -lt 16) { throw "FXGA MT5 token is empty or unexpectedly short." }
    Save-DpapiSecureString $fxgaSecure $fxgaTokenPath
}

Write-Step "Installing launch scripts"
foreach ($name in @("start-mt5api.ps1","start-fxga-bridge.ps1","test-mt5api.ps1")) {
    Copy-Item -Force (Join-Path $PSScriptRoot $name) (Join-Path $runtime $name)
}

if (-not $SkipScheduledTasks) {
    Write-Step "Registering current-user startup tasks"
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $mt5Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runtime\start-mt5api.ps1`""
    $bridgeAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runtime\start-fxga-bridge.ps1`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName "FXGA-dceoy-MT5API" -Action $mt5Action -Trigger $trigger -Settings $settings -Description "Local read-only dceoy/mt5api REST adapter for FXGA" -Force | Out-Null
    Register-ScheduledTask -TaskName "FXGA-dceoy-MT5API-Bridge" -Action $bridgeAction -Trigger $trigger -Settings $settings -Description "Push canonical MT5 M1 data from dceoy/mt5api to FXGA Google Cloud" -Force | Out-Null
}

Write-Step "Installation complete"
Write-Host "Upstream: https://github.com/dceoy/mt5api" -ForegroundColor Green
Write-Host "Pinned commit: $UpstreamCommit" -ForegroundColor Green
Write-Host "Install root: $InstallRoot" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT: Open MetaTrader 5 on this Windows machine and log in to the broker account first." -ForegroundColor Yellow
Write-Host "Then run:" -ForegroundColor Yellow
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$runtime\start-mt5api.ps1`"" -ForegroundColor White
Write-Host "In another PowerShell window run:" -ForegroundColor Yellow
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$runtime\test-mt5api.ps1`"" -ForegroundColor White
