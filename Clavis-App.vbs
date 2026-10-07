Option Explicit

' Quiet desktop entry point for Rudra24 AI.
' The batch file still owns startup/readiness logic; this wrapper only hides
' the console window so Rudra24 AI behaves like a regular desktop application.
Dim shell, projectRoot, command
Set shell = CreateObject("WScript.Shell")
projectRoot = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
command = "cmd.exe /c """ & projectRoot & "\Start-Clavis.bat"""
shell.CurrentDirectory = projectRoot
shell.Run command, 0, False
Set shell = Nothing
