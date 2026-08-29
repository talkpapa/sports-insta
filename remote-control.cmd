@echo off
REM remote-control.cmd : keep this project reachable from the phone.
REM
REM Started at logon by Task Scheduler (TIM-SportsRemote), through
REM _remote_control.vbs so no console window appears -- the other automated
REM sessions on this PC run the same way, with nothing visible on screen.
REM
REM What it does:
REM   `claude remote-control` registers this machine + this folder with the
REM   account, so claude.ai/code and the Claude mobile app can start sessions
REM   here. It is spawn mode: the phone opens NEW sessions in this project,
REM   it does not take over a session already running on the desktop.
REM
REM   --spawn same-dir  : phone sessions use this folder as-is, no per-session
REM       git worktree. Chosen because the work here is reading the real queue
REM       and state files, not parallel feature branches. Passing it explicitly
REM       also skips the first-run prompt, which would hang forever with no
REM       console attached.
REM
REM Stop it: disable the TIM-SportsRemote task, or kill the claude process.
REM
REM Log: _remote_log.txt (next to this file, gitignored)
REM
REM ---- THIS FILE MUST STAY PURE ASCII ----
REM   cmd.exe reads a batch file in the console code page (949 here), not
REM   UTF-8. Korean text inside a parenthesised block gets re-read as garbage
REM   bytes; if any of them lands on a ")" the block closes early and the whole
REM   script dies before its first line of output. That is exactly what
REM   happened on the first version of this file -- it exited instantly and
REM   wrote no log at all, which made it look like the launcher never ran.
REM   auto-deploy.cmd carries the same warning for the same reason.
REM
REM ---- and why it lives in the repo ----
REM   The folder name is Korean, so a path written literally in here would be
REM   mangled the same way. %~dp0 supplies it at run time instead.

cd /d "%~dp0" || exit /b 1

set LOG=%~dp0_remote_log.txt
set CLI=%APPDATA%\Claude\claude-code

REM Use the newest installed build rather than pinning a version -- the app
REM updates itself and a pinned path would quietly stop existing one day.
set EXE=
for /f "delims=" %%v in ('dir /b /ad /o-n "%CLI%" 2^>nul') do (
  if not defined EXE if exist "%CLI%\%%v\claude.exe" set EXE=%CLI%\%%v\claude.exe
)

if not defined EXE (
  echo ==== [%date% %time%] claude.exe not found under %CLI% ==== >> "%LOG%"
  exit /b 1
)

REM Never start a second copy. The logon task and a manual run would otherwise
REM both connect, and the phone would show two identical environments.
set RUNNING=0
for /f %%p in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" ^| Where-Object { $_.CommandLine -match 'remote-control' } ^| Measure-Object).Count" 2^>nul') do set RUNNING=%%p
if not "%RUNNING%"=="0" (
  echo ==== [%date% %time%] already running (%RUNNING%) - nothing to do ==== >> "%LOG%"
  exit /b 0
)

echo. >> "%LOG%"
echo ==== [%date% %time%] REMOTE CONTROL START ==== >> "%LOG%"
echo using %EXE% >> "%LOG%"

"%EXE%" remote-control --spawn same-dir --name "sports-insta" >> "%LOG%" 2>&1
set RC=%errorlevel%

echo ==== [%date% %time%] REMOTE CONTROL EXIT rc=%RC% ==== >> "%LOG%"
exit /b %RC%
