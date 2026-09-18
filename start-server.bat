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
rem Measurements confirmed the D3D11 backend is the slow one (bubble shader
rem variants take tens of seconds to compile there vs single digits on Vulkan
rem and GL), and plain Chrome on this machine picks D3D11 when no flag is
rem passed. So the default now forces Vulkan -- that's the "just works, don't
rem think about it" path. Pass an explicit backend to override for testing.
rem
rem Re-measured 2026-09-19 on the RTX 5070 Ti / 4K@150% box, from the home page
rem rather than the shader matrix: every card hovered cold, timed from hover to
rem the preview's first frame, fresh Chrome profile per backend.
rem
rem                                            D3D11        Vulkan
rem   Sakura / Energy Ring / Aurora (2D)       ~0.6s        ~0.6s
rem   Shatter                                   1.1s         1.1s
rem   Jelly / Melt / Weave / Capillary    11.5-29.9s    2.6-3.0s
rem   Formation / Morph / Installing     never loaded   4.2-12.1s
rem   ---------------------------------------------------------------
rem   the ten Three.js cards, total          over 258s        41.7s
rem
rem Three of them never finished at all on D3D11 (60s cap). The cost is FXC
rem compiling the raymarch fragment shader -- single-threaded CPU work, so a
rem faster GPU buys nothing. The same page on an M4 MacBook never stalls
rem because ANGLE there targets Metal.
rem
rem Vulkan is not a free win, though: it does NOT expose
rem KHR_parallel_shader_compile, so three.js compileAsync falls back to a
rem synchronous link. The failure mode changes rather than disappearing -- on
rem D3D11 the page stays at 60fps but the preview never arrives, on Vulkan the
rem preview arrives but the page freezes 3-6s on the worst three modes.
rem
rem chrome://flags/#use-angle no longer offers Vulkan (the dropdown is down to
rem Default / D3D11 / D3D11 WARP), so this launcher's flag is the only way in.
rem It is not silently ignored -- GL_RENDERER confirms
rem "ANGLE (NVIDIA, Vulkan 1.4.341 (... RTX 5070 Ti), NVIDIA)".
rem
rem   start-server.bat            --use-angle=vulkan (default)
rem   start-server.bat d3d11      --use-angle=d3d11
rem   start-server.bat vulkan     --use-angle=vulkan
rem   start-server.bat gl         --use-angle=gl
rem   start-server.bat none       plain Chrome, no ANGLE flag
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
if "%BACKEND%"=="" set "BACKEND=vulkan"

rem One statement per line on purpose: `if ... set A & set B` would run `set B`
rem unconditionally, because the `if` only guards the first command in the chain.
set "KNOWN="
set "ANGLE_FLAG="
if /i "%BACKEND%"=="none" set "KNOWN=1"
if /i "%BACKEND%"=="d3d11" set "KNOWN=1"
if /i "%BACKEND%"=="vulkan" set "KNOWN=1"
if /i "%BACKEND%"=="gl" set "KNOWN=1"
if /i "%BACKEND%"=="d3d11" set "ANGLE_FLAG=--use-angle=d3d11"
if /i "%BACKEND%"=="vulkan" set "ANGLE_FLAG=--use-angle=vulkan"
if /i "%BACKEND%"=="gl" set "ANGLE_FLAG=--use-angle=gl"

if not defined KNOWN (
    echo.
    echo [ERROR] Unknown backend "%BACKEND%".
    echo Usage: start-server.bat [none^|d3d11^|vulkan^|gl]
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
