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
!macroend

!macro customUnInstall
  ClearErrors
  FileOpen $9 "$TEMP\ordax-desktop-dev-installer-stage.log" a
  IfErrors +3
  FileWrite $9 "previous-version-uninstall-begin$\r$\n"
  FileClose $9
!macroend
