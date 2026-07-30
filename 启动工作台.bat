@echo off
chcp 65001 >nul
title 极简业务工作台
cd /d "%~dp0"

set NODE_EXE=

where node >nul 2>&1
if %errorlevel%==0 set NODE_EXE=node

if "%NODE_EXE%"=="" (
  if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\node.exe" (
    set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\node.exe"
  )
)

if "%NODE_EXE%"=="" (
  echo.
  echo   [错误] 未检测到 Node.js
  echo   请到 https://nodejs.org 下载安装 LTS 版本后重新双击本文件
  echo.
  pause
  exit /b
)

"%NODE_EXE%" server-local.js
pause
