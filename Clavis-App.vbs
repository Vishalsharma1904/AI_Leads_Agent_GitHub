Option Explicit

' Quiet desktop entry point for Rudra24 AI.
' The batch file still owns startup/readiness logic; this wrapper only hides
' the console window so Rudra24 AI behaves like a regular desktop application.
Dim shell, projectRoot, command, fileSystem, shortcutFile
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
projectRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
shortcutFile = shell.SpecialFolders("Desktop") & "\Rudra24 AI.lnk"
If Not fileSystem.FileExists(shortcutFile) And fileSystem.FileExists(projectRoot & "\Install_Shortcut.ps1") Then
  shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & projectRoot & "\Install_Shortcut.ps1""", 0, False
End If
command = "cmd.exe /c """ & projectRoot & "\Start-Clavis.bat"""
shell.CurrentDirectory = projectRoot
shell.Run command, 0, False
Set shell = Nothing
