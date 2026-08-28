' _watchdog.vbs - run watchdog.cmd with no visible window
'
' Usage (set as the TIM-SportsWatchdog action):
'   wscript.exe C:\TIM\Claude\<repo>\_watchdog.vbs
'
' Window style 0 = hidden, third argument True = wait, so Task Scheduler
' records the real duration and exit code.
'
' The repo folder name is Korean, and a .vbs is read in the ANSI code page by
' default, so a Korean path written literally in here would be mangled the
' same way it is inside a .cmd. Instead the script asks where it is standing
' and builds the path from that -- this file stays pure ASCII.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
rc = sh.Run("""" & here & "\watchdog.cmd""", 0, True)
WScript.Quit rc
