param(
  [Parameter(Mandatory=$false)]
  [string]$Secret
)

$ErrorActionPreference = "Stop"
$terminalRoot = Join-Path $env:APPDATA "MetaQuotes\Terminal"

if (-not (Test-Path $terminalRoot)) {
  throw "MetaTrader terminal folder was not found at $terminalRoot"
}

if ([string]::IsNullOrWhiteSpace($Secret)) {
  $secure = Read-Host "Paste FXGA_MT5_REPORT_SECRET" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $Secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

$Secret = $Secret.Trim()
if ($Secret.Length -lt 16) {
  throw "The bridge secret is missing or too short."
}

$terminals = Get-ChildItem $terminalRoot -Directory | Where-Object {
  Test-Path (Join-Path $_.FullName "MQL5")
}

if (-not $terminals) {
  throw "No MetaTrader 5 MQL5 terminal data folders were found."
}

$preferred = @($terminals | Where-Object {
  (Test-Path (Join-Path $_.FullName "MQL5\Experts\EA Bridge.ex5")) -or
  (Test-Path (Join-Path $_.FullName "MQL5\Experts\EA Bridge.mq5"))
})

$targets = if ($preferred.Count -gt 0) { $preferred } else { @($terminals) }

foreach ($terminal in $targets) {
  $reportDir = Join-Path $terminal.FullName "MQL5\Files\Elliot Wave Indicator Report"
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null

  $secretFile = Join-Path $reportDir "EA_Bridge.secret"
  [IO.File]::WriteAllText($secretFile, $Secret, [Text.Encoding]::ASCII)

  Write-Host "Configured EA Bridge secret file:"
  Write-Host "  $secretFile"
}

Write-Host ""
Write-Host "EA Bridge production API is already built into v13.22:"
Write-Host "  https://fxga-macro-dashboard-kbjj66blka-uc.a.run.app"
Write-Host ""
Write-Host "MT5 must still allow this URL under:"
Write-Host "  Tools > Options > Expert Advisors > Allow WebRequest for listed URL"
Write-Host ""
Write-Host "After compiling/reloading EA Bridge v13.22, look for:"
Write-Host "  EA Bridge CONNECTED + AUTHENTICATED"
