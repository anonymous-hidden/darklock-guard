# Automated Build Script for Secure Setup Wizard

param(
    [string]$InnoSetupPath = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Secure Setup Wizard - Build Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Inno Setup is installed
if (-not (Test-Path $InnoSetupPath)) {
    Write-Host "ERROR: Inno Setup not found at: $InnoSetupPath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Inno Setup from:" -ForegroundColor Yellow
    Write-Host "  https://jrsoftware.org/isdl.php" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "✓ Inno Setup found" -ForegroundColor Green

# Verify all required files exist
$requiredFiles = @(
    "SecureSetupWizard.iss",
    "privacy_policy.txt",
    "scripts\bootstrap.ps1",
    "scripts\install.ps1",
    "scripts\create-folders.ps1"
)

Write-Host "Checking required files..." -ForegroundColor Cyan
$missingFiles = @()

foreach ($file in $requiredFiles) {
    if (Test-Path $file) {
        Write-Host "  ✓ $file" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $file (missing)" -ForegroundColor Red
        $missingFiles += $file
    }
}

if ($missingFiles.Count -gt 0) {
    Write-Host ""
    Write-Host "ERROR: Missing required files" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Building installer..." -ForegroundColor Cyan
Write-Host ""

# Run Inno Setup compiler
try {
    & $InnoSetupPath "SecureSetupWizard.iss"
    
    if ($LASTEXITCODE -ne 0) {
        throw "Inno Setup compilation failed with exit code: $LASTEXITCODE"
    }
} catch {
    Write-Host ""
    Write-Host "ERROR: Build failed" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Check if output exists
$outputPath = "output\SecureSetupWizard-Setup.exe"

if (Test-Path $outputPath) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  BUILD SUCCESSFUL" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    
    $fileInfo = Get-Item $outputPath
    $fileSizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
    
    Write-Host "Installer created at:" -ForegroundColor White
    Write-Host "  $($fileInfo.FullName)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "File size: $fileSizeMB MB" -ForegroundColor White
    Write-Host "Created: $($fileInfo.LastWriteTime)" -ForegroundColor White
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Test the installer on a clean Windows VM" -ForegroundColor Gray
    Write-Host "  2. Verify all components install correctly" -ForegroundColor Gray
    Write-Host "  3. Review installation log for errors" -ForegroundColor Gray
    Write-Host "  4. (Optional) Code sign the installer for production" -ForegroundColor Gray
    Write-Host ""
    
} else {
    Write-Host ""
    Write-Host "ERROR: Installer not found at expected location" -ForegroundColor Red
    Write-Host "Expected: $outputPath" -ForegroundColor Red
    exit 1
}
