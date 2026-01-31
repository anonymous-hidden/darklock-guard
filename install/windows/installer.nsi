!include "MUI2.nsh"
!define APPNAME "Darklock Guard"
!define APPDIR "$PROGRAMFILES\\Darklock Guard"
!define SRVNAME "DarklockGuardService"

OutFile "DarklockGuard-Setup.exe"
InstallDir "${APPDIR}"
RequestExecutionLevel admin
SetCompress auto

Section "Install"
  SetShellVarContext all
  SetOutPath "${APPDIR}"
  File "..\\src-tauri\\bin\\darklock-guard-gui.exe"
  File "..\\src-tauri\\bin\\darklock-guard-service.exe"

  ; Create service (fail closed on error)
  nsExec::ExecToLog 'sc create ${SRVNAME} binPath= "\"${APPDIR}\\darklock-guard-service.exe\"" start= auto DisplayName= "Darklock Guard Service"'
  Pop $0
  IntCmp $0 0 +3 0 0
    MessageBox MB_ICONSTOP "Failed to create service (code $0)"
    Abort

  nsExec::ExecToLog 'sc description ${SRVNAME} "Darklock Guard background protection service"'

  ; Start service; rollback (delete) on failure
  nsExec::ExecToLog 'sc start ${SRVNAME}'
  Pop $0
  IntCmp $0 0 start_ok start_fail start_fail
start_fail:
  nsExec::ExecToLog 'sc delete ${SRVNAME}'
  MessageBox MB_ICONSTOP "Failed to start service (code $0)"
  Abort
start_ok:

  ; Launch GUI once to run first-run wizard
  Exec '"${APPDIR}\\darklock-guard-gui.exe" --first-run'

  ; Start Menu shortcut
  CreateDirectory "$SMPROGRAMS\\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\\${APPNAME}\\${APPNAME}.lnk" "${APPDIR}\\darklock-guard-gui.exe"
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  nsExec::ExecToLog 'sc stop ${SRVNAME}'
  nsExec::ExecToLog 'sc delete ${SRVNAME}'
  Delete "$SMPROGRAMS\\${APPNAME}\\${APPNAME}.lnk"
  RMDir "$SMPROGRAMS\\${APPNAME}"
  Delete "${APPDIR}\\darklock-guard-gui.exe"
  Delete "${APPDIR}\\darklock-guard-service.exe"
  RMDir "${APPDIR}"
SectionEnd
