[CmdletBinding()]
param(
  [ValidateSet('stable', 'beta')]
  [string]$Channel = 'stable',

  [ValidateSet('patch', 'minor', 'major', 'security', 'hotfix')]
  [string]$Classification = 'patch',

  [ValidateSet('recommended', 'required', 'emergency')]
  [string]$Urgency = 'recommended',

  [string]$ReleaseHost = 'cayden@100.101.134.31',

  [string]$CertificateThumbprint = '2CEAF5666F93AA5DD331280EA7D5D83124E86118',

  [string]$PythonPath = 'python',

  [ValidatePattern('^[A-Za-z]:$')]
  [string]$BuildDrive = 'R:'
)

$ErrorActionPreference = 'Stop'

function Invoke-Checked([string]$FilePath, [string[]]$Arguments) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE."
  }
}

$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (Test-Path "$BuildDrive\") {
  throw "$BuildDrive is already in use. Select a free drive with -BuildDrive."
}

$python = Get-Command $PythonPath -ErrorAction SilentlyContinue
if (-not $python) {
  throw 'Python 3 is required to rebuild native Electron modules. Install Python 3.11+ or pass -PythonPath.'
}

Invoke-Checked 'subst.exe' @($BuildDrive, $sourceRoot)
try {
  $repoRoot = "$BuildDrive\"
  $appDirectory = Join-Path $repoRoot 'secure-channel\apps\dl-secure-channel'
  $package = Get-Content (Join-Path $appDirectory 'package.json') -Raw | ConvertFrom-Json
  $version = [string]$package.version

  if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
    throw "Invalid desktop package version: $version"
  }

  $certificate = Get-ChildItem "Cert:\CurrentUser\My\$CertificateThumbprint" -CodeSigningCert -ErrorAction SilentlyContinue
  if (-not $certificate -or $certificate.NotAfter -le (Get-Date)) {
    throw 'A valid Darklock code-signing certificate was not found in Cert:\CurrentUser\My.'
  }

  $env:CSC_NAME = $certificate.Subject -replace '^CN=', ''
  $env:CSC_IDENTITY_AUTO_DISCOVERY = 'true'
  $env:npm_config_python = $python.Source

  Push-Location (Join-Path $repoRoot 'secure-channel')
  try {
    Invoke-Checked 'npm.cmd' @('ci')
    Invoke-Checked 'npm.cmd' @('run', 'test', '--workspace=apps/dl-secure-channel')
    Invoke-Checked 'npm.cmd' @('run', 'typecheck', '--workspace=apps/dl-secure-channel')
    Invoke-Checked 'npm.cmd' @('run', 'package:win', '--workspace=apps/dl-secure-channel', '--', '--x64', '--publish', 'never')
  } finally {
    Pop-Location
  }

  $releaseDirectory = Join-Path $appDirectory 'release'
  $installer = Get-ChildItem $releaseDirectory -Filter "Ridgeline-$version-win-x64.exe" | Select-Object -First 1
  $manifest = Join-Path $releaseDirectory 'latest.yml'
  if (-not $installer -or -not (Test-Path -LiteralPath $manifest)) {
    throw 'The Windows installer or latest.yml manifest was not produced.'
  }

  $signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if (-not $signtool) {
    throw 'Windows SDK signtool.exe is required to sign the release installer.'
  }

  Invoke-Checked $signtool.FullName @(
    'sign', '/sha1', $certificate.Thumbprint, '/fd', 'SHA256',
    '/tr', 'http://timestamp.digicert.com', '/td', 'SHA256', $installer.FullName
  )
  Invoke-Checked $signtool.FullName @('verify', '/pa', $installer.FullName)

  $sha512 = [Convert]::ToBase64String(
    [System.Security.Cryptography.SHA512]::Create().ComputeHash([System.IO.File]::ReadAllBytes($installer.FullName))
  )
  $manifestText = Get-Content $manifest -Raw
  $manifestText = [regex]::Replace($manifestText, '(?m)^    sha512: .+$', "    sha512: $sha512")
  $manifestText = [regex]::Replace($manifestText, '(?m)^    size: .+$', "    size: $($installer.Length)")
  $manifestText = [regex]::Replace($manifestText, '(?m)^sha512: .+$', "sha512: $sha512")
  Set-Content -LiteralPath $manifest -Value $manifestText -NoNewline

  $signature = Get-AuthenticodeSignature $installer.FullName
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=Darklock') {
    throw "Installer signing verification failed: $($signature.Status)"
  }

  $remoteDirectory = "ridgeline-releases/$version"
  Invoke-Checked 'ssh' @($ReleaseHost, "mkdir -p '$remoteDirectory'")
  Invoke-Checked 'scp' @($installer.FullName, $manifest, "${ReleaseHost}:$remoteDirectory/")
  Invoke-Checked 'ssh' @($ReleaseHost, "sudo /usr/local/sbin/ridgeline-publish-release '$version' '$Channel' '$Classification' '$Urgency'")

  Write-Host "Published Ridgeline $version to https://releases.darklock.net/ridgeline" -ForegroundColor Green
} finally {
  & subst.exe $BuildDrive /D 2>$null
}
