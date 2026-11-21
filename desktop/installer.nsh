; Owner/Dev Windows is a per-user application. Do not show the assisted
; install-mode selection page: the silent /S path otherwise waits there
; on the real Windows host before extracting a single file.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; electron-builder normally probes running app processes through the 32-bit
; Windows PowerShell host. On the physical Owner Desktop, one Win32_Process
; CIM query takes ~17 seconds, and the upgrade retry/kill sequence can exceed
; the bounded installer window before file extraction begins. Reuse the
; builder's existing tasklist/taskkill fallback instead of inventing another
; process authority. _CHECK_APP_RUNNING still owns prompts, graceful close,
; retry and force-kill semantics; only its process-enumeration backend changes.
!include "getProcessInfo.nsh"
Var /GLOBAL pid
Var /GLOBAL IsPowerShellAvailable
!macro customCheckAppRunning
  StrCpy $IsPowerShellAvailable "1"
  !insertmacro _CHECK_APP_RUNNING
!macroend

; Instrument only supported electron-builder NSIS extension points. Do not
; override installer transaction, elevation, upgrade, progress or rollback.
; This diagnostic journal contains stages only (no machine names or credentials).
!macro customInit
  ClearErrors
  FileOpen $9 "$TEMP\ordax-desktop-dev-installer-stage.log" a
  IfErrors +3
  FileWrite $9 "init$\r$\n"
  FileClose $9
!macroend

!macro customInstall
  ClearErrors
  FileOpen $9 "$TEMP\ordax-desktop-dev-installer-stage.log" a
  IfErrors +3
  FileWrite $9 "install-files-complete$\r$\n"
  FileClose $9

  ; NSIS has now replaced the ASAR. The previous development delta receipt
  ; describes obsolete bytes and must not block the next canonical delta.
  ; Only the one operational per-user install may retire that receipt:
  ; isolated NSIS smoke installs must never touch the real profile.
  StrCmp "$INSTDIR" "$LOCALAPPDATA\Programs\OrdaX OS Desktop Dev" 0 ordax_nsis_delta_done
  IfFileExists "$INSTDIR\resources\app.asar" 0 ordax_nsis_delta_done
  ; Preserve forensic evidence if a previous delta has an unfinished swap.
  IfFileExists "$INSTDIR\resources\app.asar.delta-rollback" ordax_nsis_delta_done 0
  IfFileExists "$INSTDIR\resources\app.asar.delta-ready" ordax_nsis_delta_done 0
  IfFileExists "$APPDATA\OrdaX OS Desktop Dev\desktop-shell-delta-receipt.json.tmp" ordax_nsis_delta_done 0
  IfFileExists "$APPDATA\OrdaX OS Desktop Dev\desktop-shell-delta-receipt.json" 0 ordax_nsis_delta_done
  ClearErrors
  Delete "$APPDATA\OrdaX OS Desktop Dev\desktop-shell-delta-receipt.json"
  ; Failed deletion leaves the receipt in place and the delta fails closed.
  ClearErrors
ordax_nsis_delta_done:
!macroend

!macro customUnInstall
  ClearErrors
  FileOpen $9 "$TEMP\ordax-desktop-dev-installer-stage.log" a
  IfErrors +3
  FileWrite $9 "previous-version-uninstall-begin$\r$\n"
  FileClose $9
!macroend
