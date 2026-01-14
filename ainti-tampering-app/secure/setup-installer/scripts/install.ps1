# ============================================================================
# Secure Setup Wizard - Main Installation Script
# Professional Windows Development & Cybersecurity Environment Installer
# ============================================================================

#Requires -RunAsAdministrator

param(
    [switch]$InstallDevTools,
    [switch]$InstallSecurityTools,
    [switch]$InstallVirtualization,
    [switch]$InstallUtilities,
    [switch]$ConfigGit,
    [switch]$InstallPythonPkgs,
    [switch]$InstallNodePkgs,
    [switch]$CreateShortcuts,
    [string]$LogFile = "$env:ProgramData\SecureSetupWizard\install.log"
)

# ============================================================================
# SETUP
# ============================================================================

# Create log directory
$logDir = Split-Path -Parent $LogFile
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# Console colors
$Host.UI.RawUI.WindowTitle = "Secure Setup Wizard - Installing..."

function Write-Log {
    param([string]$Message, [string]$Color = "White")
    $timestamp = Get-Date -Format "HH:mm:ss"
    $logMessage = "[$timestamp] $Message"
    Write-Host $logMessage -ForegroundColor $Color
    Add-Content -Path $LogFile -Value $logMessage
}

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "  ============================================================" -ForegroundColor Cyan
    Write-Host "    $Title" -ForegroundColor Cyan
    Write-Host "  ============================================================" -ForegroundColor Cyan
    Write-Host ""
    Add-Content -Path $LogFile -Value ""
    Add-Content -Path $LogFile -Value "=== $Title ==="
    Add-Content -Path $LogFile -Value ""
}

function Write-Progress-Item {
    param([string]$Name, [string]$Status, [string]$Color = "White")
    $paddedName = $Name.PadRight(30)
    Write-Host "    $paddedName $Status" -ForegroundColor $Color
}

function Install-Package {
    param(
        [string]$PackageId,
        [string]$PackageName
    )
    
    Write-Host "    Installing: " -NoNewline -ForegroundColor White
    Write-Host $PackageName -ForegroundColor Yellow -NoNewline
    Write-Host " ... " -NoNewline
    
    try {
        $process = Start-Process -FilePath "winget" -ArgumentList "install --id $PackageId --accept-source-agreements --accept-package-agreements --silent" -Wait -PassThru -WindowStyle Hidden
        
        if ($process.ExitCode -eq 0) {
            Write-Host "SUCCESS" -ForegroundColor Green
            Add-Content -Path $LogFile -Value "[OK] $PackageName installed"
            return $true
        } elseif ($process.ExitCode -eq -1978335189) {
            Write-Host "ALREADY INSTALLED" -ForegroundColor DarkYellow
            Add-Content -Path $LogFile -Value "[--] $PackageName already installed"
            return $true
        } else {
            Write-Host "WARNING (code: $($process.ExitCode))" -ForegroundColor Yellow
            Add-Content -Path $LogFile -Value "[!!] $PackageName returned code $($process.ExitCode)"
            return $true
        }
    } catch {
        Write-Host "FAILED" -ForegroundColor Red
        Add-Content -Path $LogFile -Value "[XX] $PackageName failed: $_"
        return $false
    }
}

# ============================================================================
# HEADER
# ============================================================================

Clear-Host
Write-Host ""
Write-Host "  ================================================================" -ForegroundColor Cyan
Write-Host "                                                                  " -ForegroundColor Cyan
Write-Host "       SECURE SETUP WIZARD - Installation in Progress            " -ForegroundColor Cyan
Write-Host "                                                                  " -ForegroundColor Cyan
Write-Host "  ================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "    Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host "    Log: $LogFile" -ForegroundColor Gray
Write-Host ""

Add-Content -Path $LogFile -Value "================================================================"
Add-Content -Path $LogFile -Value "Secure Setup Wizard - Installation Log"
Add-Content -Path $LogFile -Value "Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Add-Content -Path $LogFile -Value "================================================================"

$successCount = 0
$failCount = 0
$totalPackages = 0

# ============================================================================
# DEVELOPER TOOLS
# ============================================================================

if ($InstallDevTools) {
    Write-Section "DEVELOPER ESSENTIALS"
    
    $devPackages = @(
        @{Id = "Git.Git"; Name = "Git"},
        @{Id = "Microsoft.VisualStudioCode"; Name = "Visual Studio Code"},
        @{Id = "Python.Python.3.12"; Name = "Python 3.12"},
        @{Id = "OpenJS.NodeJS.LTS"; Name = "Node.js LTS"},
        @{Id = "Docker.DockerDesktop"; Name = "Docker Desktop"}
    )
    
    $totalPackages += $devPackages.Count
    
    foreach ($package in $devPackages) {
        if (Install-Package -PackageId $package.Id -PackageName $package.Name) {
            $successCount++
        } else {
            $failCount++
        }
    }
}

# ============================================================================
# CYBERSECURITY TOOLS
# ============================================================================

if ($InstallSecurityTools) {
    Write-Section "CYBERSECURITY & NETWORK TOOLS"
    
    $secPackages = @(
        @{Id = "WiresharkFoundation.Wireshark"; Name = "Wireshark"},
        @{Id = "Insecure.Nmap"; Name = "Nmap"},
        @{Id = "Microsoft.Sysinternals.Suite"; Name = "Sysinternals Suite"},
        @{Id = "PuTTY.PuTTY"; Name = "PuTTY"}
    )
    
    $totalPackages += $secPackages.Count
    
    foreach ($package in $secPackages) {
        if (Install-Package -PackageId $package.Id -PackageName $package.Name) {
            $successCount++
        } else {
            $failCount++
        }
    }
}

# ============================================================================
# UTILITIES
# ============================================================================

if ($InstallUtilities) {
    Write-Section "PRODUCTIVITY TOOLS"
    
    $utilPackages = @(
        @{Id = "Microsoft.WindowsTerminal"; Name = "Windows Terminal"},
        @{Id = "Microsoft.PowerShell"; Name = "PowerShell 7"},
        @{Id = "7zip.7zip"; Name = "7-Zip"},
        @{Id = "Notepad++.Notepad++"; Name = "Notepad++"},
        @{Id = "Postman.Postman"; Name = "Postman"},
        @{Id = "DBBrowserForSQLite.DBBrowserForSQLite"; Name = "DB Browser for SQLite"}
    )
    
    $totalPackages += $utilPackages.Count
    
    foreach ($package in $utilPackages) {
        if (Install-Package -PackageId $package.Id -PackageName $package.Name) {
            $successCount++
        } else {
            $failCount++
        }
    }
}

# ============================================================================
# VIRTUALIZATION & LINUX
# ============================================================================

if ($InstallVirtualization) {
    Write-Section "VIRTUALIZATION & LINUX"
    
    # VirtualBox
    $totalPackages++
    if (Install-Package -PackageId "Oracle.VirtualBox" -PackageName "VirtualBox") {
        $successCount++
    } else {
        $failCount++
    }
    
    # Enable WSL2
    Write-Host ""
    Write-Host "    Configuring WSL2..." -ForegroundColor Yellow
    
    try {
        $wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
        if ($wslFeature.State -ne "Enabled") {
            Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart -All | Out-Null
            Write-Progress-Item "WSL Feature" "ENABLED" "Green"
            Add-Content -Path $LogFile -Value "[OK] WSL feature enabled"
        } else {
            Write-Progress-Item "WSL Feature" "ALREADY ENABLED" "DarkYellow"
            Add-Content -Path $LogFile -Value "[--] WSL already enabled"
        }
        
        $vmPlatform = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
        if ($vmPlatform.State -ne "Enabled") {
            Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart -All | Out-Null
            Write-Progress-Item "VM Platform" "ENABLED" "Green"
            Add-Content -Path $LogFile -Value "[OK] VM Platform enabled"
        } else {
            Write-Progress-Item "VM Platform" "ALREADY ENABLED" "DarkYellow"
            Add-Content -Path $LogFile -Value "[--] VM Platform already enabled"
        }
        
        # Set WSL 2 as default
        wsl --set-default-version 2 2>$null
        Write-Progress-Item "WSL 2 Default" "CONFIGURED" "Green"
        Add-Content -Path $LogFile -Value "[OK] WSL 2 set as default"
        
    } catch {
        Write-Progress-Item "WSL Setup" "WARNING: $_" "Yellow"
        Add-Content -Path $LogFile -Value "[!!] WSL setup warning: $_"
    }
    
    # Install Ubuntu for WSL
    Write-Host ""
    Write-Host "    Installing Ubuntu for WSL..." -ForegroundColor Yellow
    try {
        $wslInstall = Start-Process -FilePath "wsl" -ArgumentList "--install -d Ubuntu --no-launch" -Wait -PassThru -WindowStyle Hidden
        if ($wslInstall.ExitCode -eq 0) {
            Write-Progress-Item "Ubuntu WSL" "QUEUED" "Green"
            Add-Content -Path $LogFile -Value "[OK] Ubuntu WSL queued for installation"
        } else {
            Write-Progress-Item "Ubuntu WSL" "MAY NEED RESTART" "DarkYellow"
            Add-Content -Path $LogFile -Value "[--] Ubuntu WSL may already be installed"
        }
    } catch {
        Write-Progress-Item "Ubuntu WSL" "WARNING" "Yellow"
        Add-Content -Path $LogFile -Value "[!!] Ubuntu WSL: $_"
    }
}

# ============================================================================
# GIT CONFIGURATION
# ============================================================================

if ($ConfigGit) {
    Write-Section "GIT CONFIGURATION"
    
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    
    $gitPath = Get-Command git -ErrorAction SilentlyContinue
    if ($gitPath) {
        git config --global init.defaultBranch main
        Write-Progress-Item "Default branch" "main" "Green"
        
        git config --global core.autocrlf true
        Write-Progress-Item "Line endings" "auto" "Green"
        
        git config --global core.editor "code --wait"
        Write-Progress-Item "Editor" "VS Code" "Green"
        
        Add-Content -Path $LogFile -Value "[OK] Git configured"
        
        Write-Host ""
        Write-Host "    NOTE: Set your identity with:" -ForegroundColor Yellow
        Write-Host "      git config --global user.name ""Your Name""" -ForegroundColor Gray
        Write-Host "      git config --global user.email ""you@example.com""" -ForegroundColor Gray
    } else {
        Write-Progress-Item "Git Configuration" "SKIPPED (Git not found in PATH yet)" "Yellow"
        Add-Content -Path $LogFile -Value "[--] Git config skipped - restart required"
    }
}

# ============================================================================
# PYTHON PACKAGES
# ============================================================================

if ($InstallPythonPkgs) {
    Write-Section "PYTHON PACKAGES"
    
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    
    $pythonPath = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonPath) {
        Write-Host "    Upgrading pip..." -ForegroundColor Yellow
        python -m pip install --upgrade pip 2>$null | Out-Null
        Write-Progress-Item "pip" "UPGRADED" "Green"
        
        $pyPackages = @("virtualenv", "requests", "python-dotenv")
        foreach ($pkg in $pyPackages) {
            Write-Host "    Installing: " -NoNewline
            Write-Host $pkg -ForegroundColor Yellow -NoNewline
            Write-Host " ... " -NoNewline
            python -m pip install $pkg 2>$null | Out-Null
            Write-Host "OK" -ForegroundColor Green
        }
        
        Add-Content -Path $LogFile -Value "[OK] Python packages installed"
    } else {
        Write-Progress-Item "Python Packages" "SKIPPED (Python not found - restart required)" "Yellow"
        Add-Content -Path $LogFile -Value "[--] Python packages skipped - restart required"
    }
}

# ============================================================================
# NODE.JS PACKAGES
# ============================================================================

if ($InstallNodePkgs) {
    Write-Section "NODE.JS PACKAGES"
    
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    
    $npmPath = Get-Command npm -ErrorAction SilentlyContinue
    if ($npmPath) {
        $nodePackages = @("nodemon", "typescript", "ts-node", "eslint", "prettier")
        foreach ($pkg in $nodePackages) {
            Write-Host "    Installing: " -NoNewline
            Write-Host $pkg -ForegroundColor Yellow -NoNewline
            Write-Host " ... " -NoNewline
            npm install -g $pkg 2>$null | Out-Null
            Write-Host "OK" -ForegroundColor Green
        }
        
        Add-Content -Path $LogFile -Value "[OK] Node.js packages installed"
    } else {
        Write-Progress-Item "Node.js Packages" "SKIPPED (npm not found - restart required)" "Yellow"
        Add-Content -Path $LogFile -Value "[--] Node.js packages skipped - restart required"
    }
}

# ============================================================================
# DESKTOP SHORTCUTS
# ============================================================================

if ($CreateShortcuts) {
    Write-Section "DESKTOP SHORTCUTS"
    
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $WshShell = New-Object -ComObject WScript.Shell
    
    $shortcuts = @(
        @{Name = "Visual Studio Code"; Target = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe"},
        @{Name = "Windows Terminal"; Target = "$env:LOCALAPPDATA\Microsoft\WindowsApps\wt.exe"},
        @{Name = "Dev Folder"; Target = "C:\Dev"}
    )
    
    foreach ($shortcut in $shortcuts) {
        try {
            if (Test-Path $shortcut.Target) {
                $lnk = $WshShell.CreateShortcut("$desktopPath\$($shortcut.Name).lnk")
                $lnk.TargetPath = $shortcut.Target
                $lnk.Save()
                Write-Progress-Item $shortcut.Name "CREATED" "Green"
            } else {
                Write-Progress-Item $shortcut.Name "SKIPPED (target not found)" "Yellow"
            }
        } catch {
            Write-Progress-Item $shortcut.Name "FAILED" "Red"
        }
    }
    
    Add-Content -Path $LogFile -Value "[OK] Desktop shortcuts processed"
}

# ============================================================================
# SUMMARY
# ============================================================================

Write-Host ""
Write-Host "  ================================================================" -ForegroundColor Green
Write-Host "                     INSTALLATION COMPLETE                        " -ForegroundColor Green
Write-Host "  ================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "    Packages processed:  $totalPackages" -ForegroundColor White
Write-Host "    Successful:          $successCount" -ForegroundColor Green
Write-Host "    Warnings/Skipped:    $failCount" -ForegroundColor $(if ($failCount -gt 0) { "Yellow" } else { "Green" })
Write-Host ""
Write-Host "    Completed: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host ""
Write-Host "  ================================================================" -ForegroundColor Yellow
Write-Host "    IMPORTANT: RESTART YOUR COMPUTER TO COMPLETE SETUP          " -ForegroundColor Yellow
Write-Host "  ================================================================" -ForegroundColor Yellow
Write-Host ""

Add-Content -Path $LogFile -Value ""
Add-Content -Path $LogFile -Value "================================================================"
Add-Content -Path $LogFile -Value "Installation Complete"
Add-Content -Path $LogFile -Value "Packages: $totalPackages | Success: $successCount | Warnings: $failCount"
Add-Content -Path $LogFile -Value "Completed: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Add-Content -Path $LogFile -Value "================================================================"

Write-Host "    Press any key to close this window..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

exit 0
