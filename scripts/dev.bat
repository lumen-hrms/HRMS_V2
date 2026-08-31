@echo off
REM One entry point for local dev on Windows: brings up Postgres+MinIO,
REM installs deps, runs migrations/seed, and either starts both dev servers
REM ("up", default) or runs the full test suite ("test").
REM
REM Usage:
REM   scripts\dev.bat          rem start Postgres+MinIO, migrate, seed, run API+web
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

if not exist apps\api\.env (
  echo No apps\api\.env found — copying apps\api\.env.example ^(local dev defaults, matches docker-compose.yml^).
  copy apps\api\.env.example apps\api\.env >nul
)

if /I "%ACTION%"=="down" (
  docker compose down
  goto :eof
)

if /I "%ACTION%"=="seed" (
  call npm run prisma:seed
  goto :eof
)

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
if errorlevel 1 exit /b 1

if /I "%ACTION%"=="test" (
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

call npm run prisma:seed

echo.
echo Starting API and web in separate windows.
echo API:  http://localhost:3000/api
echo Web:  http://localhost:5173
start "HRMS API" cmd /k npm run dev:api
start "HRMS Web" cmd /k npm run dev:web

endlocal
