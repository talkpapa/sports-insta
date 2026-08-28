@echo off
REM watchdog.cmd : make sure @sportsnewsstation actually posts today.
REM
REM Run hourly from Task Scheduler (TIM-SportsWatchdog), through _watchdog.vbs
REM so no console window appears.
REM
REM Why this exists:
REM   the reels pipeline lives on GitHub Actions, and GitHub's cron is a
REM   best-effort promise, not a guarantee. Observed:
REM     2026-08-27  no workflow ran at all that day    -> 0 posts
REM     2026-08-28  one of the three slots was skipped -> 2 posts
REM   Every workflow was "active" and manual dispatch worked instantly, so it
REM   was GitHub's scheduler, not the config. This PC's Task Scheduler has not
REM   missed a day.
REM
REM Safe to run often. The watchdog only asks "is today's quota still
REM unfilled?" and pokes the workflow; the server still enforces the daily
REM limit, the minimum gap between posts, and the pre-publish checks.
REM
REM ── why this file lives in the repo, not next to the other .cmd files ──
REM   The repo folder name is Korean. cmd.exe reads a batch file byte by byte
REM   in the console code page, so a Korean path written literally inside a
REM   .cmd is mangled and the cd fails silently. auto-deploy.cmd hit exactly
REM   this in August and was rewritten to be pure ASCII for the same reason.
REM   Keeping the file inside the repo lets %~dp0 supply the path at run time,
REM   so no Korean ever appears in the file.
REM
REM Log: _watchdog_log.txt (next to this file)

cd /d "%~dp0" || exit /b 1

set LOG=%~dp0_watchdog_log.txt
set NODE="C:\Program Files\nodejs\node.exe"

REM 65001 so Korean output lands in the log readable instead of as mojibake.
chcp 65001 > nul

echo. >> "%LOG%"
echo ==== [%date% %time%] WATCHDOG ==== >> "%LOG%"
%NODE% scripts\watchdog.js >> "%LOG%" 2>&1
exit /b %errorlevel%
