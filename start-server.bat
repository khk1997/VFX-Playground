@echo off
setlocal

rem ============================================================================
rem VFX Playground local dev server + Chrome launcher.
rem
rem ANGLE backend selection
rem -----------------------
rem Windows Chrome runs WebGL through ANGLE, and ANGLE has several backends
rem (D3D11, Vulkan, OpenGL) with completely different shader compilers. The
rem bubble shader compile hang has to be attributed to a specific backend before
rem anything in the GLSL is touched.
rem
rem This script used to pass --use-angle=vulkan unconditionally, which means
rem every Windows measurement taken with it describes the Vulkan backend only --
rem and Vulkan is the most likely suspect. The default is now NO ANGLE flag at
rem all, i.e. plain Chrome, so "normal Chrome" and "forced backend" are separate
rem measurements.
rem
rem   start-server.bat            plain Chrome, no ANGLE flag (default)
rem   start-server.bat d3d11      --use-angle=d3d11
rem   start-server.bat vulkan     --use-angle=vulkan
rem   start-server.bat gl         --use-angle=gl
rem
rem Each backend gets its own --user-data-dir. Sharing one profile would share
rem one GPU shader disk cache across all three runs, and a warm cache is exactly
rem what makes cold-compile numbers meaningless. (The ?shaderRun= salt already
rem busts the cache per probe; separate profiles remove the variable entirely.)
rem
rem Verify which backend actually took effect in the page itself -- the
rem diagnostics matrix prints GL_RENDERER and the inferred ANGLE backend. Do not
rem trust the flag alone; Chrome falls back silently when a backend is
rem unavailable.
rem ============================================================================

cd /d "%~dp0"
set "PORT=8000"
set "URL=http://localhost:%PORT%/"
set "MATRIX_URL=http://localhost:%PORT%/diagnostics/shader-matrix.html"

set "BACKEND=%~1"
if "%BACKEND%"=="" set "BACKEND=default"

rem One statement per line on purpose: `if ... set A & set B` would run `set B`
rem unconditionally, because the `if` only guards the first command in the chain.
set "KNOWN="
set "ANGLE_FLAG="
if /i "%BACKEND%"=="default" set "KNOWN=1"
if /i "%BACKEND%"=="d3d11" set "KNOWN=1"
if /i "%BACKEND%"=="vulkan" set "KNOWN=1"
if /i "%BACKEND%"=="gl" set "KNOWN=1"
if /i "%BACKEND%"=="d3d11" set "ANGLE_FLAG=--use-angle=d3d11"
if /i "%BACKEND%"=="vulkan" set "ANGLE_FLAG=--use-angle=vulkan"
if /i "%BACKEND%"=="gl" set "ANGLE_FLAG=--use-angle=gl"

if not defined KNOWN (
    echo.
    echo [ERROR] Unknown backend "%BACKEND%".
    echo Usage: start-server.bat [default^|d3d11^|vulkan^|gl]
    pause
    exit /b 1
)

set "PROFILE_DIR=%TEMP%\vfx-playground-chrome-%BACKEND%"

echo Starting VFX Playground server...
echo   ANGLE backend : %BACKEND%
if defined ANGLE_FLAG echo   Chrome flag   : %ANGLE_FLAG%
if not defined ANGLE_FLAG echo   Chrome flag   : none
echo   Chrome profile: %PROFILE_DIR%

where py >nul 2>nul
if %errorlevel%==0 goto start_with_py

where python >nul 2>nul
if %errorlevel%==0 goto start_with_python

echo.
echo [ERROR] Python was not found.
echo Please install Python and enable "Add Python to PATH".
pause
exit /b 1

:start_with_py
start "VFX Playground Server" /D "%~dp0" cmd /k "py serve.py %PORT%"
goto open_browser

:start_with_python
start "VFX Playground Server" /D "%~dp0" cmd /k "python serve.py %PORT%"

:open_browser
timeout /t 2 /nobreak >nul

set "CHROME_EXE="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if not defined CHROME_EXE goto no_chrome

if defined ANGLE_FLAG (
    start "" "%CHROME_EXE%" --user-data-dir="%PROFILE_DIR%" %ANGLE_FLAG% "%URL%"
) else (
    start "" "%CHROME_EXE%" --user-data-dir="%PROFILE_DIR%" "%URL%"
)
echo.
echo Opened %URL% in Chrome [backend=%BACKEND%]
goto done

:no_chrome
start "" "%URL%"
echo.
echo [WARN] Chrome not found; opened %URL% in the default browser.
echo        The ANGLE backend was NOT forced -- backend=%BACKEND% did not apply.

:done
echo.
echo Shader compile matrix: %MATRIX_URL%
echo Confirm the backend on that page before trusting any number.
endlocal
