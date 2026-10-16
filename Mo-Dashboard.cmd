@echo off
REM ============================================================
REM  Ucmas Ads Analytics - mo dashboard noi bo
REM  Duoc goi boi shortcut ngoai Desktop. Chay truc tiep cung duoc.
REM ============================================================

REM UTF-8 de log tieng Viet cua server khong bi loi font
chcp 65001 >nul 2>&1

title Ucmas Ads Analytics - Dashboard (dong cua so nay de tat)

REM Luon chay tai thu muc chua file nay, bat ke shortcut goi tu dau
cd /d "%~dp0"

if not exist "src\server.js" (
  echo.
  echo  [LOI] Khong tim thay src\server.js
  echo  File nay phai nam trong thu muc goc cua du an.
  echo  Thu muc hien tai: %CD%
  echo.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [LOI] Khong tim thay Node.js tren may.
  echo  Tai va cai dat tai: https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo.
  echo  Lan dau chay - dang cai dat thu vien can thiet...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  [LOI] npm install that bai. Kiem tra ket noi mang roi thu lai.
    echo.
    pause
    exit /b 1
  )
)

node launch.js

REM Chi dung lai de doc thong bao khi co loi
if errorlevel 1 (
  echo.
  pause
)
