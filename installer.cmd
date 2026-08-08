@echo off
setlocal

set "SOURCE=%~dp0"
set "TARGET=%LOCALAPPDATA%\AIAccountManager"
set "AIAM_INSTALL_TARGET=%TARGET%"
set "AIAM_INSTALL_APP=%TARGET%\AI系统多账号管理器-授权版.exe"

if not exist "%TARGET%" mkdir "%TARGET%"
robocopy "%SOURCE%." "%TARGET%" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
if errorlevel 8 (
  echo Installation failed. Please close the old software and try again.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$target=$env:AIAM_INSTALL_TARGET; $app=$env:AIAM_INSTALL_APP; $desktop=[Environment]::GetFolderPath('Desktop'); $shortcut=Join-Path $desktop 'AIAccountManager.lnk'; $shell=New-Object -ComObject WScript.Shell; $link=$shell.CreateShortcut($shortcut); $link.TargetPath=$app; $link.WorkingDirectory=$target; $link.IconLocation=$app; $link.Description='AI系统多账号管理器'; $link.Save(); Start-Process -FilePath $app -WorkingDirectory $target"
if errorlevel 1 (
  echo The software was installed, but the desktop shortcut could not be created.
  pause
  exit /b 1
)

exit /b 0
