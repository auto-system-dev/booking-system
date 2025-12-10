@echo off
chcp 65001 >nul
echo ========================================
echo   訂房系統快速啟動
echo ========================================
echo.

echo [1/3] 檢查 Node.js 安裝...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 未找到 Node.js，請先安裝 Node.js
    echo    下載網址：https://nodejs.org/
    pause
    exit /b 1
)

node --version
echo ✅ Node.js 已安裝
echo.

echo [2/3] 檢查依賴套件...
if not exist "node_modules" (
    echo 📦 正在安裝依賴套件...
    "C:\Program Files\nodejs\npm.cmd" install
    if %errorlevel% neq 0 (
        echo ❌ 依賴安裝失敗
        pause
        exit /b 1
    )
) else (
    echo ✅ 依賴套件已安裝
)
echo.

echo [3/3] 啟動伺服器...
echo.
echo ========================================
echo   伺服器將在 http://localhost:3000 啟動
echo   按 Ctrl+C 可停止伺服器
echo ========================================
echo.

"C:\Program Files\nodejs\node.exe" server.js

pause

