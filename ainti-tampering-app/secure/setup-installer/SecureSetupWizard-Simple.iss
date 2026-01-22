; ============================================================================
; DARKLOCK SETUP - Simple Installer that launches Python wizard
; ============================================================================

#define MyAppName "Darklock Security Suite"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "Darklock"
#define MyAppURL "https://darklock.net"
#define MyAppCopyright "© 2026 Darklock"

[Setup]
; App Identity
AppId={{8F4A7D6E-2B9C-4E1F-A3D5-9C7E4B2A1F6D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppCopyright={#MyAppCopyright}
VersionInfoVersion={#MyAppVersion}

; Paths
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}

; Privileges
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog

; Output
OutputDir=output
OutputBaseFilename=DarklockSetup

; Visual Settings
WizardStyle=modern
WizardSizePercent=100,100
WizardImageFile=assets\wizard_image.bmp
WizardSmallImageFile=assets\wizard_small.bmp

; Compression
Compression=lzma2/ultra64
SolidCompression=yes
LZMANumBlockThreads=4

; Behavior - Skip all pages
DisableWelcomePage=yes
DisableReadyPage=yes
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableFinishedPage=no
AllowNoIcons=yes
SetupLogging=yes
ShowLanguageDialog=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
FinishedHeadingLabel=Ready to Configure
FinishedLabelNoIcons=Click Finish to launch the Darklock Setup Wizard.
ClickFinish=Click Finish to continue.

[Files]
; Setup Wizard executable (no Python required!)
Source: "..\setup-wizard\dist\SetupWizard.exe"; DestDir: "{app}"; Flags: ignoreversion

; Privacy policy
Source: "..\setup-wizard\privacy_policy.txt"; DestDir: "{app}"; Flags: ignoreversion

; PowerShell scripts (for the wizard to use)
Source: "..\setup-installer\scripts\*.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion

; Optional: Include Python source files as backup
Source: "..\setup-wizard\*.py"; DestDir: "{app}\wizard-source"; Flags: ignoreversion
Source: "..\setup-wizard\*.txt"; DestDir: "{app}\wizard-source"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\setup-wizard\*.json"; DestDir: "{app}\wizard-source"; Flags: ignoreversion skipifsourcedoesntexist

[Run]
Filename: "{app}\SetupWizard.exe"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent; Description: "Launch Darklock Setup Wizard"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\wizard-source"
Type: filesandordirs; Name: "{app}\scripts"

[Icons]
Name: "{group}\Darklock Setup Wizard"; Filename: "{app}\SetupWizard.exe"; WorkingDir: "{app}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"

[Code]
// No special code needed - SetupWizard.exe is self-contained!
