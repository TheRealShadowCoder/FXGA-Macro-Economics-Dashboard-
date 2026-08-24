$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectId = 'fxglobalavengerstradingacademy'
$Region = 'us-central1'
$Service = 'fxga-macro-dashboard'
$RuntimeServiceAccount = 'fxga-collector-runtime@fxglobalavengerstradingacademy.iam.gserviceaccount.com'
$SecretName = 'gemini-api-key'

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required but was not found in PATH."
    }
}

function SecureToPlain([Security.SecureString]$Secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Assert-Command 'gcloud'

Write-Host "==> Selecting Google Cloud project $ProjectId" -ForegroundColor Cyan
gcloud config set project $ProjectId | Out-Host

$active = (gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>$null | Select-Object -First 1)
if (-not $active) {
    throw 'No active gcloud account. Run: gcloud auth login'
}
Write-Host "Active Google account: $active" -ForegroundColor Green

Write-Host '==> Enabling Secret Manager API' -ForegroundColor Cyan
gcloud services enable secretmanager.googleapis.com --project $ProjectId --quiet | Out-Host

$secure = Read-Host 'Paste the NEW ROTATED Gemini Auth/API key' -AsSecureString
$key = SecureToPlain $secure
if ([string]::IsNullOrWhiteSpace($key) -or $key.Length -lt 20) {
    throw 'Gemini key appears empty or invalid.'
}

$temp = Join-Path $env:TEMP ("fxga-gemini-{0}.secret" -f ([guid]::NewGuid().ToString('N')))
try {
    [IO.File]::WriteAllText($temp, $key, [Text.UTF8Encoding]::new($false))
    $key = $null

    $exists = $false
    gcloud secrets describe $SecretName --project $ProjectId --format='value(name)' *> $null
    if ($LASTEXITCODE -eq 0) { $exists = $true }

    if (-not $exists) {
        Write-Host "==> Creating Secret Manager secret $SecretName" -ForegroundColor Cyan
        gcloud secrets create $SecretName --project $ProjectId --replication-policy='automatic' --quiet | Out-Host
    }

    Write-Host '==> Adding a new secret version' -ForegroundColor Cyan
    gcloud secrets versions add $SecretName --project $ProjectId --data-file=$temp --quiet | Out-Host
}
finally {
    if (Test-Path $temp) { Remove-Item -Force $temp }
    $key = $null
    $secure = $null
}

Write-Host '==> Granting Cloud Run runtime identity secretAccessor on Gemini secret only' -ForegroundColor Cyan
gcloud secrets add-iam-policy-binding $SecretName `
    --project $ProjectId `
    --member "serviceAccount:$RuntimeServiceAccount" `
    --role 'roles/secretmanager.secretAccessor' `
    --quiet | Out-Host

Write-Host '==> Confirming Cloud Run service exists' -ForegroundColor Cyan
$serviceUrl = (gcloud run services describe $Service --region $Region --project $ProjectId --platform managed --format='value(status.url)').Trim()
if (-not $serviceUrl) { throw "Cloud Run service $Service was not found." }

Write-Host '==> Waiting briefly for the latest GitHub deployment, then checking Gemini health' -ForegroundColor Cyan
Start-Sleep -Seconds 5
try {
    $health = Invoke-RestMethod -Uri "$serviceUrl/api/gemini/health" -Headers @{ Accept = 'application/json'; 'Cache-Control' = 'no-cache' } -TimeoutSec 20
    $health | ConvertTo-Json -Depth 8 | Out-Host
    if ($health.configured -eq $true) {
        Write-Host 'Gemini is configured and available to FXGA.' -ForegroundColor Green
    }
    else {
        Write-Warning 'The secret is installed, but the currently deployed Cloud Run revision may not contain the Gemini hook yet. Wait for the GitHub deploy workflow to finish and rerun the health check.'
    }
}
catch {
    Write-Warning "Gemini health endpoint is not live yet: $($_.Exception.Message)"
    Write-Host 'The Secret Manager setup itself completed. The GitHub Cloud Run deployment may still be running.' -ForegroundColor Yellow
}

Write-Host "`nSecurity note: the key was stored only as a Secret Manager secret version and was not written to GitHub." -ForegroundColor Green
