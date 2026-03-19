@echo off
REM ============================================================================
REM Hunter Patch Setup for Windows MSVC Builds
REM ============================================================================
REM This script applies necessary patches to Hunter v0.25.5 for MSVC compatibility.
REM Run this ONCE before the first C++ build.
REM
REM Prerequisites:
REM   - Hunter must have been initialized (run cmake configure once on any
REM     koinos C++ service to trigger Hunter download)
REM   - LLVM/Clang must be installed (clang-cl.exe)
REM ============================================================================

setlocal enabledelayedexpansion

set "HUNTER_BASE=%USERPROFILE%\.hunter"
set "HUNTER_UNPACKED=%HUNTER_BASE%\_Base\Download\Hunter\0.25.5"

REM Find the Hunter ID directory
for /d %%D in ("%HUNTER_UNPACKED%\*") do set "HUNTER_ID_DIR=%%D"
if not defined HUNTER_ID_DIR (
    echo ERROR: Hunter not found at %HUNTER_UNPACKED%
    echo Run cmake configure on a koinos C++ service first to trigger Hunter download.
    exit /b 1
)
set "HUNTER_SRC=%HUNTER_ID_DIR%\Unpacked"

echo Hunter source: %HUNTER_SRC%

REM --- Patch 1: hunter_setup_msvc.cmake ---
set "MSVC_SETUP=%HUNTER_SRC%\cmake\modules\hunter_setup_msvc.cmake"
if exist "%MSVC_SETUP%" (
    echo Patching hunter_setup_msvc.cmake (MSVC 194x version regex)...
    powershell -command "(Get-Content '%MSVC_SETUP%') -replace '19\[012\]\[0-9\]', '19[0-9][0-9]' | Set-Content '%MSVC_SETUP%'"
    echo   Done.
) else (
    echo SKIP: %MSVC_SETUP% not found
)

REM --- Patch 2: Boost bootstrap.bat.in ---
set "BOOST_BOOTSTRAP=%HUNTER_SRC%\cmake\projects\Boost\scripts\patched_boostrap.bat.in"
if exist "%BOOST_BOOTSTRAP%" (
    echo Patching Boost bootstrap (vswhere PATH, CWD to PATH)...
    REM This patch is complex — check if already applied
    findstr /C:"vswhere" "%BOOST_BOOTSTRAP%" >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo   Adding vswhere PATH...
        powershell -command "$c = Get-Content '%BOOST_BOOTSTRAP%' -Raw; $c = $c -replace '(@echo on)', ('$1' + [Environment]::NewLine + 'set \"PATH=C:\Program Files (x86)\Microsoft Visual Studio\Installer;%%PATH%%\"' + [Environment]::NewLine + 'set \"PATH=%%CD%%;%%PATH%%\"'); Set-Content '%BOOST_BOOTSTRAP%' $c"
    ) else (
        echo   Already patched.
    )
    echo   Done.
) else (
    echo SKIP: %BOOST_BOOTSTRAP% not found
)

REM --- Patch 3: patch_secp256k1.cmake (fizzy + secp256k1 MSVC compat) ---
set "SECP_PATCH=%HUNTER_SRC%\cmake\schemes\patch_secp256k1.cmake"
echo Creating patch_secp256k1.cmake (fizzy + secp256k1 MSVC patches)...

REM This file is too complex for inline patching — copy from our patches dir
set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%\patch_secp256k1.cmake" (
    copy /Y "%SCRIPT_DIR%\patch_secp256k1.cmake" "%SECP_PATCH%" >nul
    echo   Copied from win-patches directory.
) else (
    echo   WARNING: patch_secp256k1.cmake not found in %SCRIPT_DIR%
    echo   You must manually create this file. See README.md for details.
)

echo.
echo ============================================================================
echo Hunter patches applied.
echo.
echo IMPORTANT: You must also configure the Hunter cache.cmake file to use
echo clang-cl for koinos package builds. After running cmake configure once
echo on a C++ service, edit:
echo   %%USERPROFILE%%\.hunter\_Base\^<hunter-id^>\^<toolchain-id^>\^<config-id^>\cache.cmake
echo.
echo Add these lines at the end:
echo   set(HUNTER_PACKAGE_BUILD ON CACHE INTERNAL "")
echo   set(MSVC ON CACHE INTERNAL "")
echo   set(MSVC_VERSION 1944 CACHE INTERNAL "")
echo   set(CMAKE_CXX_COMPILER "C:/Program Files/LLVM/bin/clang-cl.exe" CACHE FILEPATH "")
echo   set(CMAKE_C_COMPILER "C:/Program Files/LLVM/bin/clang-cl.exe" CACHE FILEPATH "")
echo ============================================================================

endlocal
