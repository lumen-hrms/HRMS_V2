@echo off
REM One entry point for local dev on Windows. It stands up everything needed
REM for a working app and starts the API + web dev servers.
REM
REM Auth mode is read from apps\api\.env:
REM   * FIREBASE_AUTH_EMULATOR_HOST set  -> local Firebase Auth emulator
REM     (zero external setup; this script creates apps\web\.env, starts the
REM     emulator, and seeds demo tenants automatically).
REM   * that line removed + real FIREBASE_PROJECT_ID / FIREBASE_SERVICE_ACCOUNT_JSON
REM     -> your real Firebase project (this script verifies the config is
REM     filled in and stops with instructions if not).
REM
REM Usage:
REM   scripts\dev.bat          rem stand up infra, migrate, seed, run API+web
REM   scripts\dev.bat up       rem same as above
REM   scripts\dev.bat test     rem migrate against a clean DB, run unit+e2e+lint+build
REM   scripts\dev.bat seed     rem (re)run the seed script only
REM   scripts\dev.bat down     rem stop Postgres+MinIO

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
  echo Creating apps\api\.env from apps\api\.env.example ^(local dev defaults^).
  copy apps\api\.env.example apps\api\.env >nul
)

set USE_EMULATOR=0
findstr /R /C:"^FIREBASE_AUTH_EMULATOR_HOST=" apps\api\.env >nul 2>&1
if not errorlevel 1 set USE_EMULATOR=1

if not exist apps\web\.env call :ensure_web_env

if /I "%ACTION%"=="down" (
  docker compose down
  goto :eof
)

REM ---------------------------------------------------------------------------
REM 2. Real-Firebase preflight (emulator mode needs nothing here)
REM ---------------------------------------------------------------------------
if "%USE_EMULATOR%"=="0" (
  call :check_real_firebase_config
  if errorlevel 1 exit /b 1
)

if /I "%ACTION%"=="seed" (
  if "%USE_EMULATOR%"=="1" call :ensure_firebase_emulator
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

if "%USE_EMULATOR%"=="1" call :ensure_firebase_emulator

REM ---------------------------------------------------------------------------
REM 4a. test: full suite, then stop
REM ---------------------------------------------------------------------------
if /I "%ACTION%"=="test" (
  if "%USE_EMULATOR%"=="0" (
    echo ERROR: the e2e suite needs the Firebase Auth emulator to mint test ID tokens.
    echo Set FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 in apps\api\.env and retry.
    exit /b 1
  )
  call npm run prisma:seed
  echo.
  echo ==^> Backend unit tests
  call npm run test:api
  if errorlevel 1 exit /b 1
  echo.
  echo ==^> Backend e2e tests ^(tenant isolation + auth, against real Postgres^)
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
REM 4b. up: seed (emulator only) + run both dev servers
REM ---------------------------------------------------------------------------
if "%USE_EMULATOR%"=="1" (
  call npm run prisma:seed
) else (
  echo.
  echo Real Firebase mode - not auto-seeding. Create your first tenant at
  echo http://localhost:5173/platform-admin, or run "npm run prisma:seed" to
  echo load the demo tenants into your Firebase project.
)

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

REM --- Ensure the Firebase Auth emulator is up on :9099 (emulator mode only).
REM     Starts it in its own window if not already running. Needs a JRE on PATH.
:ensure_firebase_emulator
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9099 -TimeoutSec 2 | Out-Null;exit 0}catch{exit 1}"
if not errorlevel 1 (
  echo Firebase Auth emulator already running on :9099.
  exit /b 0
)
where java >nul 2>&1
if errorlevel 1 (
  echo WARNING: Java not found on PATH - the Firebase Auth emulator needs a JRE ^(11+^).
  echo Seed and login will fail until it's installed.
  exit /b 0
)
echo Starting Firebase Auth emulator on :9099 in a new window...
start "HRMS Firebase Emulator" cmd /k npx --yes firebase-tools emulators:start --only auth --project hrms-platform-dev
echo Waiting for Firebase Auth emulator...
powershell -NoProfile -Command "for($i=0;$i -lt 120;$i++){try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9099 -TimeoutSec 2 | Out-Null;exit 0}catch{Start-Sleep 1}};exit 1"
if errorlevel 1 echo WARNING: Firebase Auth emulator did not come up on :9099 - seed and login will fail.
exit /b 0

REM --- Create apps\web\.env: working emulator config, or a to-fill-in copy.
:ensure_web_env
if "%USE_EMULATOR%"=="1" (
  echo Creating apps\web\.env for the local Auth emulator.
  >  apps\web\.env echo # Auto-generated by scripts\dev.bat for local emulator dev.
  >> apps\web\.env echo # For real Firebase: put your web app's config here and delete
  >> apps\web\.env echo # the VITE_FIREBASE_AUTH_EMULATOR_HOST line.
  >> apps\web\.env echo VITE_FIREBASE_API_KEY="demo-api-key"
  >> apps\web\.env echo VITE_FIREBASE_AUTH_DOMAIN="hrms-platform-dev.firebaseapp.com"
  >> apps\web\.env echo VITE_FIREBASE_PROJECT_ID="hrms-platform-dev"
  >> apps\web\.env echo VITE_FIREBASE_AUTH_EMULATOR_HOST="localhost:9099"
) else (
  echo Creating apps\web\.env from apps\web\.env.example - FILL IN the VITE_FIREBASE_* values.
  copy apps\web\.env.example apps\web\.env >nul
)
exit /b 0

REM --- Verify real-Firebase config is filled in; print exactly what's missing.
REM     Hard-required: the backend service account (token verification) and the
REM     web apiKey/authDomain (the web app renders blank without them). Uses
REM     findstr so there's no PowerShell/cmd quoting to get wrong. The pattern
REM     "= ... alphanumeric" treats an empty  KEY=  or  KEY=""  as unset.
:check_real_firebase_config
set MISSING=0
findstr /R /C:"^ *FIREBASE_SERVICE_ACCOUNT_JSON=.*[0-9A-Za-z]" apps\api\.env >nul 2>&1 || (
  echo   missing  apps\api\.env : FIREBASE_SERVICE_ACCOUNT_JSON  ^(service-account JSON on one line^)
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
echo Real Firebase mode ^(no FIREBASE_AUTH_EMULATOR_HOST in apps\api\.env^), but the
echo values above are not set. Get them from the Firebase console: Project settings
echo ^> General ^(web app config^) and Project settings ^> Service accounts.
echo Or use the local emulator: add  FIREBASE_AUTH_EMULATOR_HOST=localhost:9099  to apps\api\.env
exit /b 1
