; Clavis onedir installer. Build installer/build-clavis-bundle.ps1 first.
#define AppName "Clavis"
#define AppVersion "1.0.0"
#define AppExeName "Start-Clavis.bat"

[Setup]
AppId={{8C1C10A4-65A1-4C69-9B8E-202609060001}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\Clavis
DefaultGroupName=Clavis
OutputDir=..\release
OutputBaseFilename=Clavis-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
ArchitecturesAllowed=x64
PrivilegesRequired=lowest
WizardStyle=modern

[Files]
Source: "..\dist\Clavis\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\Clavis"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"
Name: "{group}\Clavis"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch Clavis"; Flags: nowait postinstall skipifsilent
