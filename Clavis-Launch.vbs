Option Explicit

' clavis:// launcher (registered by Start-Clavis.bat).
' The browser already has Clavis open (file-protocol-guard.js called us), so
' this only starts the three local servers, hidden, without opening Chrome.
Dim shell, projectRoot
Set shell = CreateObject("WScript.Shell")
projectRoot = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = projectRoot
' Outer quotes are for cmd /c (the path has spaces and "(2)").
shell.Run "cmd.exe /c """"" & projectRoot & "\Start-Clavis.bat"" --no-browser""", 0, False
Set shell = Nothing
