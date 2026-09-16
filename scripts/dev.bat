@echo off
REM One entry point for local dev on Windows.
REM
REM DATABASE: the team shares ONE Postgres (Supabase) - set the three
REM *_DATABASE_URL vars in apps\api\.env from the team vault. Schema is owned
REM centrally: the migration owner runs "dev.bat migrate"; everyone else just
REM pulls + prisma generate. Local Docker Postgres is used ONLY by the e2e
REM suite ("dev.bat test", via apps\api\.env.test).
REM
REM AUTH: real Firebase everywhere - no local emulator. Needs a Firebase
REM service-account JSON + web API key in apps\api\.env and the web config in
REM apps\web\.env (see the .env.example files).
REM
REM Usage:
REM   scripts\dev.bat          rem MinIO up, deps, generate client, run API+web
REM   scripts\dev.bat up       rem same as above
REM   scripts\dev.bat migrate  rem apply pending migrations to the shared DB (owner)
REM   scripts\dev.bat test     rem local Docker Postgres + unit+e2e+lint+build
REM   scripts\dev.bat seed     rem seed the shared DB (owner - creates demo tenants)
REM   scripts\dev.bat down     rem stop local Docker services (data volume kept)

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
  set /p ANS=Seed the SHARED database ^(creates demo tenants + Firebase users^)? [y/N]
  if /I not "!ANS!"=="y" ( echo Aborted. & goto :eof )
  call npm run prisma:seed
  goto :eof
)

if /I "%ACTION%"=="migrate" (
  echo Applying pending migrations to the shared database...
  call npm run prisma:generate
  if errorlevel 1 exit /b 1
  call npm run prisma:migrate
  if errorlevel 1 exit /b 1
  goto :eof
)

REM ---------------------------------------------------------------------------
REM 3. test: LOCAL Docker Postgres (apps\api\.env.test), full suite
REM ---------------------------------------------------------------------------
if /I "%ACTION%"=="test" (
  docker compose up -d
  echo Waiting for Postgres to be ready...
  set READY=0
  for /L %%i in (1,1,30) do (
    docker compose exec -T postgres pg_isready -U hrms_superuser -d hrms >nul 2>&1
    if not errorlevel 1 ( set READY=1 & goto :ready )
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
  set "DATABASE_URL=postgresql://hrms_superuser:hrms_superuser_pw@localhost:5432/hrms?schema=public"
  call npm run prisma:migrate
  if errorlevel 1 exit /b 1
  set "DATABASE_URL="
  echo.
  echo ==^> Backend unit tests
  call npm run test:api
  if errorlevel 1 exit /b 1
  echo.
  echo ==^> Backend e2e tests ^(tenant isolation + auth + identity ^& access,
  echo     against local Postgres + real Firebase^)
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
REM 4. up: MinIO only (DB is the shared Supabase one), then run dev servers
REM ---------------------------------------------------------------------------
docker compose up -d minio
call npm run install:all
if errorlevel 1 exit /b 1
call npm run prisma:generate
if errorlevel 1 exit /b 1

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
