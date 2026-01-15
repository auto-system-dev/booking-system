@echo off
chcp 65001 >nul
echo ========================================
echo Resend 重新安裝腳本
echo ========================================
echo.

echo [1/4] 正在移除舊的 Resend 套件...
call npm uninstall resend
if %errorlevel% neq 0 (
    echo ⚠️  移除失敗，繼續執行...
)
echo.

echo [2/4] 正在清理 npm 快取...
call npm cache clean --force
echo.

echo [3/4] 正在重新安裝 Resend 套件...
call npm install resend@^6.7.0
if %errorlevel% neq 0 (
    echo ❌ 安裝失敗！
    pause
    exit /b 1
)
echo.

echo [4/4] 正在驗證安裝...
call npm list resend
if %errorlevel% neq 0 (
    echo ❌ 驗證失敗！
    pause
    exit /b 1
)
echo.

echo ========================================
echo ✅ Resend 重新安裝完成！
echo ========================================
echo.
echo 請重新啟動伺服器以套用變更。
echo.
pause


