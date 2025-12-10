@echo off
chcp 65001 >nul
echo ========================================
echo   停止並重新啟動訂房系統伺服器
echo ========================================
echo.

echo [1/2] 停止所有 Node.js 進程...
taskkill /F /IM node.exe >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ 已停止所有 Node.js 進程
) else (
    echo ℹ️  沒有正在運行的 Node.js 進程
)
echo.

echo [2/2] 啟動伺服器...
echo.
echo ========================================
echo   伺服器將在 http://localhost:3000 啟動
echo   按 Ctrl+C 可停止伺服器
echo ========================================
echo.

"C:\Program Files\nodejs\node.exe" server.js

pause

