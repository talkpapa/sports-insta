' _remote_control.vbs - run remote-control.cmd with no visible window
'
' Usage (set as the TIM-SportsRemote action):
'   wscript.exe <repo>\_remote_control.vbs
'
' Window style 0 = hidden. Third argument False = do not wait: remote control
' is meant to keep running, so the launcher returns immediately and Task
' Scheduler does not sit on it. Same shape as _deploy_daemon.vbs.
'
' The folder name is Korean and a .vbs is read in the ANSI code page, so the
' path is derived from where this file stands instead of being written out.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run """" & here & "\remote-control.cmd""", 0, False
