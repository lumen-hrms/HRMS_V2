@echo off
REM One entry point for local dev on Windows. It stands up everything needed
REM for a working app and starts the API + web dev servers.
REM
REM Auth is real Firebase everywhere - there is no local Auth emulator. You
REM need a Firebase project's service-account JSON + web API key in
REM apps\api\.env and the web config in apps\web\.env (see the .env.example
REM files). This script verifies the config is filled in and stops with
REM instructions if not.
REM
REM Usage:
REM   scripts\dev.bat          rem stand up infra, migrate, seed, run API+web
REM   scripts\dev.bat up       rem same as above
REM   scripts\dev.bat test     rem migrate, run unit+e2e+lint+build
REM   scripts\dev.bat seed     rem (re)run the seed script only
REM   scripts\dev.bat down     rem stop Postgres+MinIO (data volume is kept)

setlocal enabledelayedexpansion
cd /d "%~dp0.."

set ACTION=%1
if "%ACTION%"=="" set ACTION=up

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker isn't accessible. Make sure Docker Desktop is installed and running.
  exit /b 1
)

REM ---------------------------------------------------------------------------
REM 1. Env files
REM ---------------------------------------------------------------------------
if not exist apps\api\.env (
  echo Creating apps\api\.env from apps\api\.env.example - FILL IN the FIREBASE_* values.
  copy apps\api\.env.example apps\api\.env >nul
)
if not exist apps\web\.env (
  echo Creating apps\web\.env from apps\web\.env.example - FILL IN the VITE_FIREBASE_* values.
  copy apps\web\.env.example apps\web\.env >nul
)

if /I "%ACTION%"=="down" (
  REM No -v: the hrms_pg_data / hrms_minio_data volumes are kept.
  docker compose down
  goto :eof
)

REM ---------------------------------------------------------------------------
REM 2. Firebase config preflight
REM ---------------------------------------------------------------------------
call :check_firebase_config
if errorlevel 1 exit /b 1

if /I "%ACTION%"=="seed" (
  call npm run prisma:seed
  goto :eof
)

REM ---------------------------------------------------------------------------
REM 3. Infra + schema
REM ---------------------------------------------------------------------------
docker compose up -d

echo Waiting for Postgres to be ready...
set READY=0
for /L %%i in (1,1,30) do (
  docker compose exec -T postgres pg_isready -U hrms_superuser -d hrms >nul 2>&1
  if not errorlevel 1 (
    set READY=1
    goto :ready
  )
  timeout /t 1 /nobreak >nul
)
:ready
if "!READY!"=="0" (
  echo Postgres didn't become ready in time. Check: docker compose logs postgres
  exit /b 1
)
echo Postgres is ready.

call npm run install:all
if errorlevel 1 exit /b 1
call npm run prisma:generate
if errorlevel 1 exit /b 1
call npm run prisma:migrate
if errorlevel 1 (
  echo.
  echo prisma migrate deploy failed. If it reports a FAILED migration ^(P3009^),
  echo reset the local DB with:  cd apps\api ^&^& npx prisma migrate reset
  exit /b 1
)

REM ---------------------------------------------------------------------------
REM 4a. test: full suite, then stop
REM ---------------------------------------------------------------------------
if /I "%ACTION%"=="test" (
  echo.
  echo ==^> Backend unit tests
  call npm run test:api
  if errorlevel 1 exit /b 1
  echo.
  echo ==^> Backend e2e tests ^(tenant isolation + auth + identity ^& access,
  echo     against real Postgres + real Firebase^)
  call npm run test:api:e2e
  if errorlevel 1 exit /b 1
  echo.
  echo ==^> Lint + build ^(api + web^)
  call npm run lint
  if errorlevel 1 exit /b 1
  call npm run build
  if errorlevel 1 exit /b 1
  echo.
  echo All checks passed.
  goto :eof
)

REM ---------------------------------------------------------------------------
REM 4b. up: seed + run both dev servers
REM ---------------------------------------------------------------------------
call npm run prisma:seed

echo.
echo Starting API and web in separate windows.
echo API:  http://localhost:3000/api
echo Web:  http://localhost:5173
start "HRMS API" cmd /k npm run dev:api
start "HRMS Web" cmd /k npm run dev:web

endlocal
goto :eof


REM ===========================================================================
REM Subroutines
REM ===========================================================================

REM --- Verify Firebase config is filled in; print exactly what's missing.
REM     Hard-required: the backend service account (token verification + user
REM     management), the web API key (hosted password-reset email), and the
REM     web apiKey/authDomain (the SPA renders blank without them). Uses
REM     findstr so there's no PowerShell/cmd quoting to get wrong.
:check_firebase_config
set MISSING=0
findstr /R /C:"^ *FIREBASE_SERVICE_ACCOUNT_JSON=.*[0-9A-Za-z]" apps\api\.env >nul 2>&1 || (
  echo   missing  apps\api\.env : FIREBASE_SERVICE_ACCOUNT_JSON  ^(service-account JSON on one line^)
  set MISSING=1
)
findstr /R /C:"^ *FIREBASE_WEB_API_KEY=.*[0-9A-Za-z]" apps\api\.env >nul 2>&1 || (
  echo   missing  apps\api\.env : FIREBASE_WEB_API_KEY  ^(Project settings ^> General ^> Web API Key^)
  set MISSING=1
)
findstr /R /C:"^ *VITE_FIREBASE_API_KEY=.*[0-9A-Za-z]" apps\web\.env >nul 2>&1 || (
  echo   missing  apps\web\.env : VITE_FIREBASE_API_KEY
  set MISSING=1
)
findstr /R /C:"^ *VITE_FIREBASE_AUTH_DOMAIN=.*[0-9A-Za-z]" apps\web\.env >nul 2>&1 || (
  echo   missing  apps\web\.env : VITE_FIREBASE_AUTH_DOMAIN  ^(^<project-id^>.firebaseapp.com^)
  set MISSING=1
)
if "%MISSING%"=="0" exit /b 0
echo.
echo Firebase config is incomplete ^(values above are not set^). Get them from the
echo Firebase console: Project settings ^> General ^(web app config + Web API Key^)
echo and Project settings ^> Service accounts ^(Generate new private key^).
exit /b 1
