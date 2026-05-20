@echo off
title AI Voice-Over Sync System Orchestrator
echo ========================================================
echo       AI Voice-Over Sync System - Local Startup
echo ========================================================
echo.

cd /d "%~dp0"

:: 1. Setup Virtual Environment
if not exist .venv (
    echo [System] Virtual environment not found. Creating .venv...
    python -m venv .venv
    if errorlevel 1 (
        echo [Error] Failed to create virtual environment. Ensure Python is installed.
        pause
        exit /b 1
    )
)

echo [System] Activating virtual environment and verifying dependencies...
call .venv\Scripts\activate
pip install -r requirements.txt
if errorlevel 1 (
    echo [Warning] Some dependencies failed to install. Please check requirements.txt.
)

echo [System] Initializing directories...
if not exist storage ( mkdir storage )
if not exist storage\raw_videos ( mkdir storage\raw_videos )
if not exist storage\scripts ( mkdir storage\scripts )
if not exist storage\audio ( mkdir storage\audio )
if not exist storage\synced_videos ( mkdir storage\synced_videos )
if not exist storage\output ( mkdir storage\output )

echo [System] Starting FastAPI Backend Services...

:: 2. Launch Services in separate titled command prompt windows
echo Launching Upload Service on port 8000...
start "Upload Service [Port 8000]" cmd /k "call .venv\Scripts\activate && python services\upload\main.py"

echo Launching TTS Service on port 8001...
start "TTS Service [Port 8001]" cmd /k "call .venv\Scripts\activate && python services\tts\main.py"

echo Launching Lip-Sync Service on port 8002...
start "Sync Service [Port 8002]" cmd /k "call .venv\Scripts\activate && python services\lipsync\main.py"

echo Launching Render Service on port 8003...
start "Render Service [Port 8003]" cmd /k "call .venv\Scripts\activate && python services\render\main.py"

:: 3. Launch Frontend
echo Starting React Vite Dev Server on port 5173...
start "Frontend Web Panel [Port 5173]" cmd /k "cd services\frontend && npm run dev"

:: 4. Auto-launch default browser
echo Opening Frontend Dashboard in browser...
timeout /t 3 >nul
start http://localhost:5173

echo.
echo ========================================================
echo All services have been launched in separate windows!
echo - Upload Service API: http://localhost:8000
echo - Frontend Dashboard: http://localhost:5173
echo ========================================================
echo.
pause
