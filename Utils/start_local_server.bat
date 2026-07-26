@echo off
cd /d "%~dp0.."
echo Starting Physics QBank local server...
echo Press Ctrl+C in this window to stop the server.
echo.
start http://localhost:8000
python -m http.server 8000
pause
