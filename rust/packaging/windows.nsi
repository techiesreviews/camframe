; Unsigned per-user test installer. CamFrame 0.9.0 and both settings folders are preserved.
Unicode true
Name "CamFrame Rust (test)"
OutFile "${OUT_DIR}\CamFrame-Rust-Setup-0.1.0-Windows-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\CamFrame Rust"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "CamFrame Rust"
  SetOutPath "$INSTDIR"
  File /oname=camframe-rust.exe "${BINARY}"
  File /oname=LICENSE.txt "..\..\LICENSE"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\CamFrame Rust.lnk" "$INSTDIR\camframe-rust.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CamFrameRust" "DisplayName" "CamFrame Rust (test)"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CamFrameRust" "DisplayVersion" "0.1.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CamFrameRust" "UninstallString" '$"$INSTDIR\Uninstall.exe$"'
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\CamFrame Rust.lnk"
  Delete "$INSTDIR\camframe-rust.exe"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CamFrameRust"
SectionEnd
