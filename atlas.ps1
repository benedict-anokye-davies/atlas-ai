# Atlas Desktop Launcher
# Run with: .\atlas.ps1
# Or right-click and "Run with PowerShell"

$env:NODE_OPTIONS = "--max-old-space-size=8192"
Set-Location $PSScriptRoot
npm run dev
