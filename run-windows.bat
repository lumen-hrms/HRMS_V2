@echo off
rem Windows entry point for local dev: same steps as "scripts/dev.sh up", but
rem uses docker-compose.windows.yml for the MinIO image (see that file).
rem
rem Usage:
rem   run-windows.bat         MinIO + ClamAV up, deps, generate client, run API + web
rem   run-windows.bat down    stop local Docker services (data volumes are kept)

setlocal
cd /d "%~dp0"

set "COMPOSE=docker compose -f docker-compose.yml -f docker-compose.windows.yml"
set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=up"

if /i "%ACTION%"=="up" goto up
if /i "%ACTION%"=="down" goto down
echo Usage: %~nx0 [up^|down]
exit /b 1

:down
%COMPOSE% down
exit /b %errorlevel%

:up
docker info >nul 2>&1
if errorlevel 1 (
  echo Docker isn't accessible. Start Docker Desktop and try again.
  goto fail
)

if not exist apps\api\.env (
  echo Creating apps\api\.env from the example - FILL IN the FIREBASE_* values.
  copy /y apps\api\.env.example apps\api\.env >nul
)
if not exist apps\web\.env (
  echo Creating apps\web\.env from the example - FILL IN the VITE_FIREBASE_* values.
  copy /y apps\web\.env.example apps\web\.env >nul
)

rem The "." in the patterns below stands for the value's opening quote.
set "MISSING="
findstr /R /B /C:"FIREBASE_SERVICE_ACCOUNT_JSON=[^ #]" apps\api\.env >nul || (
  echo   missing  apps\api\.env : FIREBASE_SERVICE_ACCOUNT_JSON
  set "MISSING=1"
)
findstr /R /B /C:"FIREBASE_WEB_API_KEY=.[a-zA-Z0-9]" apps\api\.env >nul || (
  echo   missing  apps\api\.env : FIREBASE_WEB_API_KEY
  set "MISSING=1"
)
findstr /R /B /C:"VITE_FIREBASE_API_KEY=.[a-zA-Z0-9]" apps\web\.env >nul || (
  echo   missing  apps\web\.env : VITE_FIREBASE_API_KEY
  set "MISSING=1"
)
findstr /R /B /C:"VITE_FIREBASE_AUTH_DOMAIN=.[a-zA-Z0-9]" apps\web\.env >nul || (
  echo   missing  apps\web\.env : VITE_FIREBASE_AUTH_DOMAIN
  set "MISSING=1"
)
if defined MISSING (
  echo.
  echo Firebase config is incomplete. Get these from the Firebase console:
  echo Project settings, General tab and Service accounts tab.
  goto fail
)

%COMPOSE% up -d minio clamav
if errorlevel 1 goto fail

call npm run install:all
if errorlevel 1 goto fail
call npm run prisma:generate
if errorlevel 1 goto fail

rem Informational only - never blocks startup.
pushd apps\api
call npx prisma migrate status
if errorlevel 1 echo NOTE: shared DB may have pending migrations - the migration owner applies them.
popd

echo.
echo Starting API (http://localhost:3000/api) and web (http://localhost:5173).
echo Ctrl+C stops both.
start "" /b cmd /c npm run dev:api
call npm run dev:web
exit /b %errorlevel%

:fail
echo.
echo Startup failed - see the message above.
pause
exit /b 1
