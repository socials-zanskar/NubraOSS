@echo off
cd /d C:\Users\Harsh\Downloads\NubraOSS-main\NubraOSS-main

echo Starting NubraOSS Backend...
start "NubraOSS Backend" cmd /k "cd /d backend && python -m uvicorn app.main:app --port 8000"

timeout /t 3 /nobreak >nul

echo Starting NubraOSS Frontend...
start "NubraOSS Frontend" cmd /k "cd /d frontend && npm run dev"

echo NubraOSS started.
pause