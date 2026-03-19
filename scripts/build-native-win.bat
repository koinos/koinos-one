@echo off
REM ============================================================================
REM Knodel Native Windows Build Script
REM ============================================================================
REM Builds all 11 Koinos microservices natively on Windows 10/11.
REM
REM Prerequisites:
REM   - Visual Studio Build Tools 2022 (MSVC 19.44+)
REM   - CMake 3.28.x (NOT 4.x — Hunter 0.25.5 incompatible)
REM   - Ninja (bundled with VS Build Tools)
REM   - LLVM/Clang 22+ (clang-cl used for Hunter package builds)
REM   - Go 1.22+ (for Go services)
REM   - Node.js 20+ and Yarn (for koinos-rest)
REM   - MinGW GCC (for Go CGO — badger/RocksDB native deps)
REM   - Strawberry Perl (for OpenSSL build in Hunter)
REM
REM Usage:
REM   build-native-win.bat [all|go|cpp|rest]
REM   build-native-win.bat              — builds everything
REM   build-native-win.bat go           — builds Go services only
REM   build-native-win.bat cpp          — builds C++ services only
REM   build-native-win.bat rest         — builds koinos-rest only
REM ============================================================================

setlocal enabledelayedexpansion

set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=all"

REM --- Resolve paths ---
set "KNODEL_ROOT=%~dp0.."
set "VENDOR=%KNODEL_ROOT%\vendor\koinos"
set "SCRIPTS=%KNODEL_ROOT%\scripts"

REM --- Setup MSVC environment ---
set "PATH=C:\Program Files (x86)\Microsoft Visual Studio\Installer;%PATH%"
for /f "usebackq tokens=*" %%i in (`"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS_PATH=%%i"
if not defined VS_PATH (
    echo ERROR: Visual Studio Build Tools not found
    exit /b 1
)
call "%VS_PATH%\VC\Auxiliary\Build\vcvarsall.bat" x64

REM --- Setup tool paths ---
REM Adjust these paths to your local installation
where cmake >nul 2>&1 || (
    echo ERROR: cmake not found in PATH
    exit /b 1
)
where ninja >nul 2>&1 || (
    set "PATH=%VS_PATH%\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\;%PATH%"
)
where go >nul 2>&1 || (
    echo ERROR: go not found in PATH
    exit /b 1
)

echo ============================================================================
echo Knodel Native Windows Build
echo Target: %TARGET%
echo Vendor: %VENDOR%
echo ============================================================================

REM ============================================================================
REM Go Services
REM ============================================================================
if "%TARGET%"=="all" goto :build_go
if "%TARGET%"=="go" goto :build_go
goto :skip_go

:build_go
echo.
echo === Building Go Services ===
set "GOFLAGS=-v"
set "CGO_ENABLED=1"

for %%S in (koinos-block-store koinos-p2p koinos-jsonrpc koinos-transaction-store koinos-contract-meta-store) do (
    echo.
    echo --- Building %%S ---
    if exist "%VENDOR%\%%S" (
        pushd "%VENDOR%\%%S"

        REM Determine the cmd directory
        set "CMD_DIR="
        if exist "cmd\%%S" set "CMD_DIR=cmd\%%S"
        if exist "cmd" for /d %%D in (cmd\*) do set "CMD_DIR=%%D"

        if defined CMD_DIR (
            go build -o "%%S.exe" ".\!CMD_DIR!" 2>&1
        ) else (
            go build -o "%%S.exe" . 2>&1
        )

        if !ERRORLEVEL! equ 0 (
            echo OK: %%S.exe built
        ) else (
            echo FAILED: %%S
        )
        popd
    ) else (
        echo SKIP: %VENDOR%\%%S not found
    )
)
:skip_go

REM ============================================================================
REM REST Service (koinos-rest)
REM ============================================================================
if "%TARGET%"=="all" goto :build_rest
if "%TARGET%"=="rest" goto :build_rest
goto :skip_rest

:build_rest
echo.
echo === Building koinos-rest ===
if exist "%VENDOR%\koinos-rest" (
    pushd "%VENDOR%\koinos-rest"
    call yarn install --frozen-lockfile 2>&1
    call yarn build 2>&1
    if !ERRORLEVEL! equ 0 (
        echo OK: koinos-rest built
    ) else (
        echo FAILED: koinos-rest
    )
    popd
) else (
    echo SKIP: koinos-rest not found
)
:skip_rest

REM ============================================================================
REM C++ Services
REM ============================================================================
if "%TARGET%"=="all" goto :build_cpp
if "%TARGET%"=="cpp" goto :build_cpp
goto :skip_cpp

:build_cpp
echo.
echo === Building C++ Services ===
echo NOTE: First build will take a long time (Hunter downloads + compiles all dependencies).
echo       Subsequent builds use cached packages and are much faster.
echo.

for %%S in (koinos-chain koinos-mempool koinos-grpc koinos-block-producer koinos-account-history) do (
    echo.
    echo --- Building %%S ---
    if exist "%VENDOR%\%%S" (
        call :build_cpp_service %%S
    ) else (
        echo SKIP: %VENDOR%\%%S not found
    )
)
goto :skip_cpp

:build_cpp_service
set "SVC=%~1"
set "SVC_DIR=%VENDOR%\%SVC%"
set "BUILD_DIR=%SVC_DIR%\build-win"

REM Step 1: Configure (triggers Hunter FetchContent download of koinos_cmake)
echo   [1/4] Configuring...
cmake -S "%SVC_DIR%" -B "%BUILD_DIR%" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_JOB_POOLS="compile=1;link=1" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo FAILED: %SVC% cmake configure
    exit /b 1
)

REM Step 2: Patch KoinosCompilerOptions.cmake for MSVC
echo   [2/4] Patching KoinosCompilerOptions.cmake...
copy /Y "%SCRIPTS%\win-patches\KoinosCompilerOptions.cmake" "%BUILD_DIR%\_deps\koinos_cmake-src\KoinosCompilerOptions.cmake" >nul
copy /Y "%SCRIPTS%\win-patches\msvc_compat.h" "%BUILD_DIR%\msvc_compat.h" >nul

REM Step 3: Reconfigure with patches
echo   [3/4] Reconfiguring with patches...
cmake -S "%SVC_DIR%" -B "%BUILD_DIR%" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_JOB_POOLS="compile=1;link=1" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo FAILED: %SVC% cmake reconfigure
    exit /b 1
)

REM Step 4: Build (-j1 for RAM safety on 8GB machines)
echo   [4/4] Building (single-threaded for RAM safety)...
cmake --build "%BUILD_DIR%" --config Release -j 1 2>&1
if %ERRORLEVEL% equ 0 (
    echo OK: %SVC% built
    dir /b /s "%BUILD_DIR%\src\*.exe" 2>nul
) else (
    echo FAILED: %SVC% build
)
exit /b %ERRORLEVEL%

:skip_cpp

REM ============================================================================
REM Summary
REM ============================================================================
echo.
echo ============================================================================
echo Build Summary
echo ============================================================================

set "PASS=0"
set "FAIL=0"

REM Check Go binaries
for %%S in (koinos-block-store koinos-p2p koinos-jsonrpc koinos-transaction-store koinos-contract-meta-store) do (
    if exist "%VENDOR%\%%S\%%S.exe" (
        set /a PASS+=1
        echo   OK:   %%S.exe
    ) else (
        set /a FAIL+=1
        echo   MISS: %%S.exe
    )
)

REM Check C++ binaries
for %%S in (koinos-chain koinos-mempool koinos-grpc koinos-block-producer koinos-account-history) do (
    set "FOUND="
    for /f "delims=" %%F in ('dir /b /s "%VENDOR%\%%S\build-win\src\*.exe" 2^>nul') do set "FOUND=%%F"
    if defined FOUND (
        set /a PASS+=1
        echo   OK:   !FOUND!
    ) else (
        set /a FAIL+=1
        echo   MISS: %%S (no .exe in build-win\src\)
    )
)

REM Check REST
if exist "%VENDOR%\koinos-rest\.next" (
    set /a PASS+=1
    echo   OK:   koinos-rest (.next build output)
) else (
    set /a FAIL+=1
    echo   MISS: koinos-rest
)

echo.
echo   Total: !PASS! passed, !FAIL! failed
echo ============================================================================

endlocal
