@echo off
REM Cross-platform installation script for Anti-Tampering App Setup Wizard
REM Windows Installation Script

echo ==============================================
echo   Anti-Tampering App Setup Wizard
echo   Windows Installation Script
echo ==============================================
echo.

REM Check for admin rights
net session >nul 2>&1
if %errorLevel% == 0 (
    echo Running with Administrator privileges
) else (
    echo WARNING: Not running as Administrator
    echo Some features may require elevated privileges
    echo.
    echo To run as admin: Right-click this file and select "Run as administrator"
    echo.
    pause
)

echo.
echo Checking Python installation...
python --version >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] Python found
    python --version
) else (
    echo [ERROR] Python not found
    echo.
    echo Please install Python from: https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation
    pause
    exit /b 1
)

echo.
echo Checking pip installation...
pip --version >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] pip found
) else (
    echo [ERROR] pip not found
    echo Installing pip...
    python -m ensurepip --default-pip
)

echo.
echo Installing Python dependencies...
if exist requirements.txt (
    pip install -r requirements.txt
    echo [OK] Dependencies installed
) else (
    echo [WARNING] requirements.txt not found
    echo Installing basic dependencies...
    pip install customtkinter pillow
)

echo.
echo ==============================================
echo   Installation Complete!
echo ==============================================
echo.
echo To run the setup wizard:
echo   python main.py
echo.
echo For elevated privileges (required for some features):
echo   Right-click main.py and select "Run as administrator"
echo   Or use: runas /user:Administrator "python main.py"
echo.
pause
