!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
Var RidgelineDesktopShortcut
Var RidgelineStartMenuShortcut

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Install Ridgeline"
  !define MUI_WELCOMEPAGE_TEXT "Private messaging built by Darklock.$\r$\n$\r$\nThis setup installs Ridgeline and prepares its secure local application environment.$\r$\n$\r$\nPublished by Darklock"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  Page custom RidgelineOptionsCreate RidgelineOptionsLeave
!macroend

Function RidgelineOptionsCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 14u "Installation options"
  Pop $0
  ${NSD_CreateLabel} 0 20u 100% 16u "Choose how Ridgeline is available on this device."
  Pop $0
  ${NSD_CreateCheckbox} 0 44u 100% 12u "Create a desktop shortcut"
  Pop $RidgelineDesktopShortcut
  ${NSD_Check} $RidgelineDesktopShortcut

  ${NSD_CreateCheckbox} 0 66u 100% 12u "Create a Start menu shortcut"
  Pop $RidgelineStartMenuShortcut
  ${NSD_Check} $RidgelineStartMenuShortcut
  nsDialogs::Show
FunctionEnd

Function RidgelineOptionsLeave
FunctionEnd

!macro customInstall
  ${NSD_GetState} $RidgelineDesktopShortcut $0
  ${If} $0 == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\Ridgeline.lnk" "$INSTDIR\Ridgeline.exe"
  ${EndIf}

  ${NSD_GetState} $RidgelineStartMenuShortcut $0
  ${If} $0 == ${BST_CHECKED}
    CreateDirectory "$SMPROGRAMS\Ridgeline"
    CreateShortCut "$SMPROGRAMS\Ridgeline\Ridgeline.lnk" "$INSTDIR\Ridgeline.exe"
  ${EndIf}
!macroend
!endif
