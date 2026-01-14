#Requires -RunAsAdministrator
# ============================================================================
# Windows Development & Cybersecurity Environment Setup Script
# Generated: January 2026
# Run this script in an elevated PowerShell session (Administrator)
# ============================================================================

Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force

# ============================================================================
# SECTION 1: CREATE PROFESSIONAL DEV FOLDER STRUCTURE
# ============================================================================

$devFolders = @(
    "C:\Dev",
    "C:\Dev\projects",
    "C:\Dev\bots",
    "C:\Dev\security",
    "C:\Dev\labs",
    "C:\Dev\scripts",
    "C:\Dev\notes"
)

Write-Host "`n[SETUP] Creating development folder structure..." -ForegroundColor Cyan
foreach ($folder in $devFolders) {
    if (-not (Test-Path $folder)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
        Write-Host "  Created: $folder" -ForegroundColor Green
    } else {
        Write-Host "  Exists:  $folder" -ForegroundColor Yellow
    }
}

# ============================================================================
# SECTION 2: ENABLE WSL2 AND VIRTUAL MACHINE PLATFORM
# ============================================================================

Write-Host "`n[SETUP] Enabling Windows Subsystem for Linux (WSL2)..." -ForegroundColor Cyan

$wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
if ($wslFeature.State -ne "Enabled") {
    Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart -All
    Write-Host "  WSL feature enabled" -ForegroundColor Green
} else {
    Write-Host "  WSL feature already enabled" -ForegroundColor Yellow
}

$vmPlatform = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
if ($vmPlatform.State -ne "Enabled") {
    Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart -All
    Write-Host "  Virtual Machine Platform enabled" -ForegroundColor Green
} else {
    Write-Host "  Virtual Machine Platform already enabled" -ForegroundColor Yellow
}

# Set WSL 2 as default version
wsl --set-default-version 2 2>$null

# ============================================================================
# SECTION 3: INSTALL APPLICATIONS VIA WINGET
# ============================================================================

Write-Host "`n[SETUP] Installing applications via winget..." -ForegroundColor Cyan
Write-Host "  This may take several minutes. Please wait.`n" -ForegroundColor Gray

$wingetPackages = @(
    # Terminal and Shell
    @{id = "Microsoft.WindowsTerminal"; name = "Windows Terminal"},
    @{id = "Microsoft.PowerShell"; name = "PowerShell 7"},
    
    # Development Tools
    @{id = "Git.Git"; name = "Git"},
    @{id = "Microsoft.VisualStudioCode"; name = "Visual Studio Code"},
    @{id = "Python.Python.3.12"; name = "Python 3.12"},
    @{id = "OpenJS.NodeJS.LTS"; name = "Node.js LTS"},
    @{id = "Docker.DockerDesktop"; name = "Docker Desktop"},
    
    # Utilities
    @{id = "7zip.7zip"; name = "7-Zip"},
    @{id = "Notepad++.Notepad++"; name = "Notepad++"},
    
    # Virtualization
    @{id = "Oracle.VirtualBox"; name = "VirtualBox"},
    
    # Network and Security Tools
    @{id = "WiresharkFoundation.Wireshark"; name = "Wireshark"},
    @{id = "Insecure.Nmap"; name = "Nmap"},
    @{id = "Microsoft.Sysinternals.Suite"; name = "Sysinternals Suite"},
    @{id = "PuTTY.PuTTY"; name = "PuTTY"},
    
    # API and Database Tools
    @{id = "Postman.Postman"; name = "Postman"},
    @{id = "DBBrowserForSQLite.DBBrowserForSQLite"; name = "DB Browser for SQLite"}
)

foreach ($package in $wingetPackages) {
    Write-Host "  Installing $($package.name)..." -ForegroundColor White
    winget install --id $package.id --accept-source-agreements --accept-package-agreements --silent 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "    Success: $($package.name)" -ForegroundColor Green
    } elseif ($LASTEXITCODE -eq -1978335189) {
        Write-Host "    Already installed: $($package.name)" -ForegroundColor Yellow
    } else {
        Write-Host "    Note: $($package.name) may require manual installation or already exists" -ForegroundColor Yellow
    }
}

# ============================================================================
# SECTION 4: INSTALL UBUNTU FOR WSL
# ============================================================================

Write-Host "`n[SETUP] Installing Ubuntu for WSL..." -ForegroundColor Cyan
wsl --install -d Ubuntu --no-launch 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Ubuntu WSL distribution queued for installation" -ForegroundColor Green
} else {
    Write-Host "  Ubuntu may already be installed or will install after reboot" -ForegroundColor Yellow
}

# ============================================================================
# SECTION 5: CONFIGURE GIT (GLOBAL SETTINGS TEMPLATE)
# ============================================================================

Write-Host "`n[SETUP] Configuring Git defaults..." -ForegroundColor Cyan
git config --global init.defaultBranch main
git config --global core.autocrlf true
git config --global core.editor "code --wait"
Write-Host "  Git configured with sensible defaults" -ForegroundColor Green
Write-Host "  NOTE: Run the following to set your identity:" -ForegroundColor Yellow
Write-Host "    git config --global user.name `"Your Name`"" -ForegroundColor Gray
Write-Host "    git config --global user.email `"your.email@example.com`"" -ForegroundColor Gray

# ============================================================================
# SECTION 6: REFRESH ENVIRONMENT PATH
# ============================================================================

Write-Host "`n[SETUP] Refreshing environment variables..." -ForegroundColor Cyan
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
Write-Host "  Environment PATH refreshed for current session" -ForegroundColor Green

# ============================================================================
# SECTION 7: INSTALL ESSENTIAL PYTHON PACKAGES
# ============================================================================

Write-Host "`n[SETUP] Installing essential Python packages..." -ForegroundColor Cyan
$pythonPath = (Get-Command python -ErrorAction SilentlyContinue).Source
if ($pythonPath) {
    python -m pip install --upgrade pip 2>$null
    python -m pip install virtualenv requests discord.py python-dotenv 2>$null
    Write-Host "  Python packages installed (pip, virtualenv, requests, discord.py, python-dotenv)" -ForegroundColor Green
} else {
    Write-Host "  Python not found in PATH. Packages will install after reboot." -ForegroundColor Yellow
}

# ============================================================================
# SECTION 8: INSTALL ESSENTIAL NODE.JS PACKAGES
# ============================================================================

Write-Host "`n[SETUP] Installing essential Node.js packages..." -ForegroundColor Cyan
$npmPath = (Get-Command npm -ErrorAction SilentlyContinue).Source
if ($npmPath) {
    npm install -g npm@latest 2>$null
    npm install -g nodemon typescript ts-node eslint prettier 2>$null
    Write-Host "  Node.js packages installed (nodemon, typescript, ts-node, eslint, prettier)" -ForegroundColor Green
} else {
    Write-Host "  npm not found in PATH. Packages will install after reboot." -ForegroundColor Yellow
}

# ============================================================================
# SECTION 9: CREATE README IN DEV FOLDER
# ============================================================================

$readmeContent = @"
# Development Environment

This folder structure was created by the Windows setup script.

## Folder Structure

- **projects/** - General development projects
- **bots/** - Discord bots and automation scripts
- **security/** - Cybersecurity tools and configurations
- **labs/** - Virtual machine configs and lab environments
- **scripts/** - Utility scripts and automation
- **notes/** - Documentation and learning notes

## Installed Tools

- Windows Terminal & PowerShell 7
- Git, VS Code, Python 3, Node.js LTS
- Docker Desktop, VirtualBox
- Wireshark, Nmap, Sysinternals Suite
- Postman, DB Browser for SQLite, PuTTY
- WSL2 with Ubuntu

## Security Reminder

Always conduct security testing in isolated virtual machines.
Never test on systems you do not own or have explicit permission to test.

Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
"@

$readmeContent | Out-File -FilePath "C:\Dev\README.md" -Encoding UTF8 -Force
Write-Host "`n[SETUP] Created README.md in C:\Dev\" -ForegroundColor Green

# ============================================================================
# SECTION 10: FINAL SUMMARY
# ============================================================================

Write-Host "`n" -NoNewline
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "                    SETUP COMPLETE                                         " -ForegroundColor Cyan
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "`nInstalled Components:" -ForegroundColor White
Write-Host "  - Windows Terminal, PowerShell 7" -ForegroundColor Gray
Write-Host "  - Git, Visual Studio Code" -ForegroundColor Gray
Write-Host "  - Python 3.12, Node.js LTS" -ForegroundColor Gray
Write-Host "  - Docker Desktop, VirtualBox" -ForegroundColor Gray
Write-Host "  - Wireshark, Nmap, Sysinternals Suite" -ForegroundColor Gray
Write-Host "  - Postman, DB Browser for SQLite, PuTTY" -ForegroundColor Gray
Write-Host "  - 7-Zip, Notepad++" -ForegroundColor Gray
Write-Host "  - WSL2 with Ubuntu" -ForegroundColor Gray

Write-Host "`nDev Folder Structure: C:\Dev\" -ForegroundColor White
Write-Host "  projects, bots, security, labs, scripts, notes" -ForegroundColor Gray

Write-Host "`nPost-Install Actions Required:" -ForegroundColor Yellow
Write-Host "  1. Configure Git identity (user.name and user.email)" -ForegroundColor Gray
Write-Host "  2. Launch Docker Desktop and complete setup" -ForegroundColor Gray
Write-Host "  3. Launch Ubuntu from Start Menu to complete WSL setup" -ForegroundColor Gray
Write-Host "  4. Sign into VS Code and sync settings (optional)" -ForegroundColor Gray

Write-Host "`n============================================================================" -ForegroundColor Red
Write-Host "  IMPORTANT: YOU MUST REBOOT YOUR COMPUTER TO COMPLETE INSTALLATION        " -ForegroundColor Red
Write-Host "  Some features (WSL2, Docker, VirtualBox) require a restart.              " -ForegroundColor Red
Write-Host "============================================================================" -ForegroundColor Red
Write-Host "`n"
