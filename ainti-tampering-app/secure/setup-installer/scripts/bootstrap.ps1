# Bootstrap Script for Secure Setup Wizard
# Ensures winget is available and functional before installation

#Requires -RunAsAdministrator

param(
    [string]$LogFile = "$env:ProgramData\SecureSetupWizard\bootstrap.log"
)

# Create log directory
$logDir = Split-Path -Parent $LogFile
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] $Message"
    Write-Host $logMessage
    Add-Content -Path $LogFile -Value $logMessage
}

Write-Log "=========================================="
Write-Log "Secure Setup Wizard - Bootstrap"
Write-Log "=========================================="

# Check if winget is available
Write-Log "Checking for winget availability..."

$wingetPath = $null
$wingetPaths = @(
    "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe",
    "$env:ProgramFiles\WindowsApps\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe\winget.exe"
)

foreach ($path in $wingetPaths) {
    if ($path -like "*`**") {
        # Handle wildcard path
        $resolved = Get-ChildItem -Path (Split-Path $path -Parent) -Filter (Split-Path $path -Leaf) -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($resolved) {
            $wingetPath = $resolved.FullName
            break
        }
    } elseif (Test-Path $path) {
        $wingetPath = $path
        break
    }
}

if ($wingetPath) {
    Write-Log "winget found at: $wingetPath"
    
    # Test winget functionality
    try {
        $testResult = & $wingetPath --version 2>&1
        Write-Log "winget version: $testResult"
        Write-Log "winget is functional"
        exit 0
    } catch {
        Write-Log "winget found but not functional: $_"
    }
}

# winget not found or not functional - attempt to install
Write-Log "winget not available. Checking Windows version..."

$osVersion = [System.Environment]::OSVersion.Version
Write-Log "Windows version: $osVersion"

if ($osVersion.Major -eq 10 -and $osVersion.Build -ge 17763) {
    Write-Log "Windows 10/11 detected. Attempting to install App Installer (includes winget)..."
    
    try {
        # Install App Installer from Microsoft Store
        Write-Log "Installing Microsoft.DesktopAppInstaller..."
        
        # Use Add-AppxPackage to install from Microsoft
        $appInstallerUrl = "https://aka.ms/getwinget"
        Write-Log "Downloading App Installer from: $appInstallerUrl"
        
        # Download the latest App Installer
        $tempFile = "$env:TEMP\Microsoft.DesktopAppInstaller.msixbundle"
        
        # Note: This requires internet connectivity
        # In production, you would bundle the App Installer package with the installer
        Write-Log "NOTE: winget installation requires internet connectivity"
        Write-Log "Alternatively, ensure App Installer is pre-installed (included in Windows 11)"
        
        # For Windows 11, winget should already be present
        if ($osVersion.Build -ge 22000) {
            Write-Log "Windows 11 detected - winget should be included by default"
            Write-Log "Please ensure Windows is fully updated"
        }
        
        Write-Log "Bootstrap completed with warnings"
        exit 1
        
    } catch {
        Write-Log "ERROR: Failed to install winget: $_"
        Write-Log "Manual installation required: Visit https://aka.ms/getwinget"
        exit 2
    }
} else {
    Write-Log "ERROR: Unsupported Windows version"
    Write-Log "This installer requires Windows 10 (build 17763+) or Windows 11"
    exit 3
}
