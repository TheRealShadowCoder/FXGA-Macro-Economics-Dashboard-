[CmdletBinding()]
param(
  [string]$ProjectId = 'fxglobalavengerstradingacademy',
  [string]$Region = 'us-central1',
  [string]$Service = 'fxga-macro-dashboard',
  [string]$SecretName = 'gemini-api-key',
  [string]$RuntimeServiceAccount = 'fxga-collector-runtime@fxglobalavengerstradingacademy.iam.gserviceaccount.com'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required but was not found in PATH."
  }
}

Require-Command 'gcloud'

Write-Host '==> Selecting Google Cloud project' -ForegroundColor Cyan
gcloud config set project $ProjectId | Out-Host

Write-Host '==> Enabling Secret Manager API' -ForegroundColor Cyan
gcloud services enable secretmanager.googleapis.com --project $ProjectId --quiet | Out-Host

Write-Host ''
Write-Host 'Paste the Gemini API/auth key into the secure prompt.' -ForegroundColor Yellow
Write-Host 'The value will not be printed, written to this repository, or stored in the PowerShell history.' -ForegroundColor Yellow
$secure = Read-Host 'Gemini API key' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Gemini API key cannot be empty.' }

  $exists = $false
  try {
    gcloud secrets describe $SecretName --project $ProjectId --format='value(name)' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $exists = $true }
  } catch { $exists = $false }

  if (-not $exists) {
    Write-Host "==> Creating Secret Manager secret $SecretName" -ForegroundColor Cyan
    gcloud secrets create $SecretName --project $ProjectId --replication-policy='automatic' --quiet | Out-Host
  }

  Write-Host '==> Adding a new secret version' -ForegroundColor Cyan
  $plain | gcloud secrets versions add $SecretName --project $ProjectId --data-file=- --quiet | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Failed to add Gemini secret version.' }
} finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  $plain = $null
  $secure = $null
}

Write-Host '==> Granting Cloud Run runtime access to Gemini secret' -ForegroundColor Cyan
gcloud secrets add-iam-policy-binding $SecretName `
  --project $ProjectId `
  --member="serviceAccount:$RuntimeServiceAccount" `
  --role='roles/secretmanager.secretAccessor' `
  --quiet | Out-Host

Write-Host '==> Attaching Gemini to the existing Cloud Run service' -ForegroundColor Cyan
gcloud run services update $Service `
  --project $ProjectId `
  --region $Region `
  --platform managed `
  --set-secrets="GEMINI_API_KEY=$SecretName`:latest" `
  --update-env-vars='GEMINI_MODEL=gemini-3.7-flash,GEMINI_FALLBACK_MODEL=gemini-3.5-flash-lite,GEMINI_REQUESTS_PER_HOUR=24' `
  --quiet | Out-Host

$serviceUrl = (gcloud run services describe $Service --project $ProjectId --region $Region --platform managed --format='value(status.url)').Trim()
if ([string]::IsNullOrWhiteSpace($serviceUrl)) { throw 'Cloud Run service URL could not be resolved.' }

Write-Host '==> Verifying Gemini gateway' -ForegroundColor Cyan
$health = Invoke-RestMethod -Method Get -Uri "$serviceUrl/api/gemini/health" -Headers @{ Accept = 'application/json'; 'Cache-Control' = 'no-cache' }
$health | ConvertTo-Json -Depth 8 | Out-Host

if (-not $health.configured) {
  throw 'Gemini gateway is deployed but reports configured=false. Check the Secret Manager binding and Cloud Run revision.'
}

Write-Host ''
Write-Host 'Gemini is configured for FXGA.' -ForegroundColor Green
Write-Host "Cloud Run: $serviceUrl" -ForegroundColor Green
Write-Host 'Supported modes: smc-signal, market-brief, macro-brief, economic-context, event-research, action-report' -ForegroundColor Green
