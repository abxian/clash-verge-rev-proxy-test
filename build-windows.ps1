param(
  [ValidateSet("release", "fast")]
  [string]$Mode = "release",
  [string]$Target = "x86_64-pc-windows-msvc",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Name"
  }
}

Set-Location $PSScriptRoot

Require-Command pnpm
Require-Command cargo
Require-Command rustc

if (-not $SkipInstall) {
  pnpm install
}

pnpm exec biome format --write src/pages/home.tsx src/components/setting/setting-clash.tsx
pnpm run web:build

if ($Mode -eq "fast") {
  pnpm tauri build --target $Target -- --profile fast-release
} else {
  pnpm tauri build --target $Target -b nsis
}

Write-Host ""
Write-Host "Build finished."
Write-Host "Installer output:"
$OutputDirs = @("target\$Target\release\bundle\nsis", "target\release\bundle\nsis") |
  Where-Object { Test-Path $_ }

Get-ChildItem -Path $OutputDirs -Filter "*.exe" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 10 FullName, LastWriteTime

$OpenDir = $OutputDirs | Select-Object -First 1
if ($OpenDir) {
  Invoke-Item $OpenDir
}
