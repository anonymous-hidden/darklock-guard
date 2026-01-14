# PowerShell wrapper for building the Setup Wizard .exe
# This script makes it easier to build from PowerShell

param(
    [switch]$Clean
)

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "  Setup Wizard - EXE Builder" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Clean previous build if requested
if ($Clean) {
    Write-Host "Cleaning previous build..." -ForegroundColor Yellow
    if (Test-Path "build") { Remove-Item -Recurse -Force "build" }
    if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }
    if (Test-Path "*.spec") { Remove-Item -Force "*.spec" }
    Write-Host "  Cleaned build directories" -ForegroundColor Green
    Write-Host ""
}

# Check Python
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Host "ERROR: Python not found in PATH" -ForegroundColor Red
    Write-Host "Please install Python 3.8+ first" -ForegroundColor Yellow
    exit 1
}

Write-Host "Using Python: $($pythonCmd.Source)" -ForegroundColor Gray
Write-Host ""

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Cyan
python -m pip install -r requirements.txt --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "  WARNING: Some dependencies may have failed to install" -ForegroundColor Yellow
}
Write-Host ""

# Run the build script
Write-Host "Starting build process..." -ForegroundColor Cyan
Write-Host ""
python build_exe.py

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "====================================" -ForegroundColor Green
    Write-Host "  BUILD COMPLETE" -ForegroundColor Green
    Write-Host "====================================" -ForegroundColor Green
    Write-Host ""
    
    if (Test-Path "dist\SetupWizard.exe") {
        $exePath = Resolve-Path "dist\SetupWizard.exe"
        Write-Host "Executable: $exePath" -ForegroundColor Cyan
        Write-Host ""
        
        # Ask if user wants to run it
        $response = Read-Host "Would you like to test the .exe now? (y/n)"
        if ($response -eq "y") {
            Write-Host "Launching SetupWizard.exe..." -ForegroundColor Cyan
            Start-Process $exePath
        }
    }
} else {
    Write-Host ""
    Write-Host "BUILD FAILED" -ForegroundColor Red
    Write-Host "Check the errors above" -ForegroundColor Red
    exit 1
}

Write-Host ""
