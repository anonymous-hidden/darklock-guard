@echo off
REM install-service.bat — Install Darklock Guard as a Windows service.
REM Run as Administrator.

SET BINARY_SRC=%~1
IF "%BINARY_SRC%"=="" SET BINARY_SRC=.\target\release\guard-service.exe
SET INSTALL_DIR=C:\Program Files\Darklock Guard
SET DATA_DIR=C:\ProgramData\Darklock

echo === Darklock Guard Windows Service Installer ===

REM 1. Create directories
echo [1/4] Creating directories ...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

REM 2. Copy binary
echo [2/4] Copying binary ...
copy /Y "%BINARY_SRC%" "%INSTALL_DIR%\guard-service.exe"

REM 3. Create Windows service
echo [3/4] Creating Windows service ...
sc create DarklockGuard ^
    binPath= "\"%INSTALL_DIR%\guard-service.exe\" run --data-dir \"%DATA_DIR%\"" ^
    start= auto ^
    DisplayName= "Darklock Guard" ^
    obj= LocalSystem

REM 4. Configure failure recovery
echo [4/4] Configuring failure recovery ...
sc failure DarklockGuard ^
    reset= 86400 ^
    actions= restart/5000/restart/10000/restart/30000

echo.
echo Service installed. Before starting, initialize the vault:
echo   "%INSTALL_DIR%\guard-service.exe" init --data-dir "%DATA_DIR%"
echo.
echo Then start:
echo   sc start DarklockGuard
echo   Get-EventLog -LogName Application -Source DarklockGuard -Newest 20
