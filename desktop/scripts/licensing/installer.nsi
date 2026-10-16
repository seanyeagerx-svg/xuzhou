; Xuzhou addition, 2026-10-15. Apache-2.0.
; Uses only NSIS built-in commands and stock zlib-licensed plugins.
Unicode true
RequestExecutionLevel user
SetCompressor zlib
Name "续舟测试版"
OutFile "${XUZHOU_INSTALLER}"
InstallDir "$LOCALAPPDATA\Programs\XuzhouBeta"
InstallDirRegKey HKCU "Software\XuzhouBeta" "InstallLocation"
BrandingText "续舟 Beta / Xuzhou Beta"
VIProductVersion "${XUZHOU_FILE_VERSION}"
VIAddVersionKey /LANG=1033 "ProductName" "Xuzhou"
VIAddVersionKey /LANG=1033 "FileDescription" "续舟 Setup"
VIAddVersionKey /LANG=1033 "FileVersion" "${XUZHOU_VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Xuzhou contributors. Based on AionUi; see NOTICE."
!include "MUI2.nsh"
!define MUI_ICON "${XUZHOU_ICON}"
!define MUI_UNICON "${XUZHOU_ICON}"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "Japanese"
!insertmacro MUI_LANGUAGE "TradChinese"
!insertmacro MUI_LANGUAGE "Korean"
!insertmacro MUI_LANGUAGE "Turkish"
!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "Ukrainian"
!insertmacro MUI_LANGUAGE "PortugueseBR"
!insertmacro MUI_LANGUAGE "German"
!insertmacro MUI_LANGUAGE "Spanish"
!insertmacro MUI_LANGUAGE "French"
!insertmacro MUI_LANGUAGE "Farsi"

LangString XuzhouCloseApp ${LANG_ENGLISH} "Please close Xuzhou and try again. No installation files have been changed."
LangString XuzhouCloseApp ${LANG_SIMPCHINESE} "请先退出续舟，再重试。安装文件尚未改动。"
LangString XuzhouCloseApp ${LANG_JAPANESE} "続行するには Xuzhou を終了してください。インストールファイルは変更されていません。"
LangString XuzhouCloseApp ${LANG_TRADCHINESE} "請先退出續舟，再重試。安裝檔案尚未變更。"
LangString XuzhouCloseApp ${LANG_KOREAN} "Xuzhou를 종료한 후 다시 시도하세요. 설치 파일은 변경되지 않았습니다."
LangString XuzhouCloseApp ${LANG_TURKISH} "Lütfen Xuzhou'yu kapatıp tekrar deneyin. Kurulum dosyaları değiştirilmedi."
LangString XuzhouCloseApp ${LANG_RUSSIAN} "Закройте Xuzhou и повторите попытку. Файлы установки не изменены."
LangString XuzhouCloseApp ${LANG_UKRAINIAN} "Закрийте Xuzhou та повторіть спробу. Файли встановлення не змінено."
LangString XuzhouCloseApp ${LANG_PORTUGUESEBR} "Feche o Xuzhou e tente novamente. Nenhum arquivo de instalação foi alterado."
LangString XuzhouCloseApp ${LANG_GERMAN} "Bitte Xuzhou schließen und erneut versuchen. Installationsdateien wurden nicht geändert."
LangString XuzhouCloseApp ${LANG_SPANISH} "Cierre Xuzhou e inténtelo de nuevo. No se ha modificado ningún archivo de instalación."
LangString XuzhouCloseApp ${LANG_FRENCH} "Fermez Xuzhou et réessayez. Aucun fichier d'installation n'a été modifié."
LangString XuzhouCloseApp ${LANG_FARSI} "Please close Xuzhou and try again. No installation files have been changed."

LangString XuzhouSeparateBeta ${LANG_ENGLISH} "Choose a separate Beta installation folder. Existing files were not changed."
LangString XuzhouSeparateBeta ${LANG_SIMPCHINESE} "请选择独立的 Beta 安装目录。现有文件未改动。"
LangString XuzhouSeparateBeta ${LANG_JAPANESE} "Choose a separate Beta installation folder. Existing files were not changed."
LangString XuzhouSeparateBeta ${LANG_TRADCHINESE} "請選擇獨立的 Beta 安裝目錄。現有檔案未變更。"
LangString XuzhouSeparateBeta ${LANG_KOREAN} "Choose a separate Beta installation folder. Existing files were not changed."
LangString XuzhouSeparateBeta ${LANG_TURKISH} "Choose a separate Beta installation folder. Existing files were not changed."
LangString XuzhouSeparateBeta ${LANG_RUSSIAN} "Choose a separate Beta installation folder. Existing files were not changed."
LangString XuzhouSeparateBeta ${LANG_UKRAINIAN} "Choose a separate Beta installation folder. Existing files were not changed."
LangString XuzhouSeparateBeta ${LANG_PORTUGUESEBR} "Choose a separate Beta installation folder. Existing files were not changed."
LangString XuzhouSeparateBeta ${LANG_GERMAN} "Choose a separate Beta installation folder. Existing files were not changed."
LangString XuzhouSeparateBeta ${LANG_SPANISH} "Choose a separate Beta installation folder. Existing files were not changed."
LangString XuzhouSeparateBeta ${LANG_FRENCH} "Choose a separate Beta installation folder. Existing files were not changed."
LangString XuzhouSeparateBeta ${LANG_FARSI} "Choose a separate Beta installation folder. Existing files were not changed."

; Opening the executable for writing fails while Windows maps the running image.
; Check before any payload/registry/shortcut mutation, including silent upgrades.
!macro XUZHOU_CLOSED_CHECK PREFIX
Function ${PREFIX}RequireClosed
  retry:
  IfFileExists "$INSTDIR\Xuzhou.exe" 0 core
  ClearErrors
  FileOpen $0 "$INSTDIR\Xuzhou.exe" a
  IfErrors locked
  FileClose $0
  core:
  IfFileExists "$INSTDIR\resources\bundled-aioncore\win32-x64\aioncore.exe" 0 done
  ClearErrors
  FileOpen $0 "$INSTDIR\resources\bundled-aioncore\win32-x64\aioncore.exe" a
  IfErrors locked
  FileClose $0
  Goto done
  locked:
  IfSilent stop
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(XuzhouCloseApp)" IDRETRY retry
  stop:
  SetErrorLevel 2
  Quit
  done:
FunctionEnd
!macroend
!insertmacro XUZHOU_CLOSED_CHECK ""
!insertmacro XUZHOU_CLOSED_CHECK "un."

; Never replace a stable installation or other existing user files with a beta.
Function RequireBetaDirectory
  IfFileExists "$INSTDIR\resources\branding\compliance\beta-channel.json" done
  ClearErrors
  FindFirst $1 $2 "$INSTDIR\*"
  IfErrors done
  check:
  StrCmp $2 "." next
  StrCmp $2 ".." next
  StrCmp $2 "" empty
  FindClose $1
  IfSilent stop
  MessageBox MB_OK|MB_ICONSTOP "$(XuzhouSeparateBeta)"
  stop:
  SetErrorLevel 4
  Quit
  next:
  ClearErrors
  FindNext $1 $2
  IfErrors empty check
  empty:
  FindClose $1
  done:
FunctionEnd

Section
  Call RequireBetaDirectory
  Call RequireClosed
  ; Fail before writing any payload, registry value or shortcut.
  StrLen $0 "$INSTDIR"
  IntCmp $0 ${XUZHOU_MAX_INSTALL_ROOT} lengthOK lengthOK pathTooLong
  pathTooLong:
  IfSilent pathTooLongStop
  MessageBox MB_OK|MB_ICONSTOP "Please choose a shorter installation folder. / 请选择更短的安装目录。"
  pathTooLongStop:
  SetErrorLevel 3
  Quit
  lengthOK:
  ReadRegDWORD $R0 HKCU "Software\XuzhouBeta" "CreatedDesktopShortcut"
  ReadRegStr $R1 HKCU "Software\XuzhouBeta" "InstallLocation"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${XUZHOU_APP_DIR}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\续舟测试版"
  CreateShortCut "$SMPROGRAMS\续舟测试版\续舟.lnk" "$INSTDIR\Xuzhou.exe"
  CreateShortCut "$SMPROGRAMS\续舟测试版\$(^UninstallCaption).lnk" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "Software\XuzhouBeta" "InstallerLanguage" $LANGUAGE
  WriteRegDWORD HKCU "Software\XuzhouBeta" "CreatedDesktopShortcut" 0
  IfFileExists "$DESKTOP\续舟测试版.lnk" existingDesktop
    CreateShortCut "$DESKTOP\续舟测试版.lnk" "$INSTDIR\Xuzhou.exe"
    WriteRegDWORD HKCU "Software\XuzhouBeta" "CreatedDesktopShortcut" 1
    Goto desktopDone
  existingDesktop:
  StrCmp $R1 "$INSTDIR" 0 desktopDone
  StrCmp $R0 1 0 desktopDone
  WriteRegDWORD HKCU "Software\XuzhouBeta" "CreatedDesktopShortcut" 1
  desktopDone:
  WriteRegStr HKCU "Software\XuzhouBeta" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\XuzhouBeta" "DisplayName" "续舟测试版"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\XuzhouBeta" "DisplayVersion" "${XUZHOU_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\XuzhouBeta" "DisplayIcon" "$INSTDIR\Xuzhou.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\XuzhouBeta" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\XuzhouBeta" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\XuzhouBeta" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\XuzhouBeta" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Call un.RequireClosed
  SetShellVarContext current
  ; Delete only the original payload manifest. User-added files and chat profiles survive.
  !include "${XUZHOU_UNINSTALL_FILES}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\续舟测试版\续舟.lnk"
  Delete "$SMPROGRAMS\续舟测试版\$(^UninstallCaption).lnk"
  RMDir "$SMPROGRAMS\续舟测试版"
  ReadRegDWORD $0 HKCU "Software\XuzhouBeta" "CreatedDesktopShortcut"
  StrCmp $0 1 0 +2
    Delete "$DESKTOP\续舟测试版.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\XuzhouBeta"
  DeleteRegKey HKCU "Software\XuzhouBeta"
SectionEnd

Function un.onInit
  ReadRegDWORD $LANGUAGE HKCU "Software\XuzhouBeta" "InstallerLanguage"
FunctionEnd
