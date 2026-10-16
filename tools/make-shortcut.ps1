# ============================================================
#  Tao shortcut "Ucmas Ads Analytics" ngoai Desktop.
#
#  Chay lai bat cu luc nao - vi du sau khi di chuyen thu muc du an sang o dia khac,
#  hoac tren mot may moi. Shortcut cu se bi ghi de.
#
#  Cach chay:   npm run shortcut
#  Hoac:        powershell -ExecutionPolicy Bypass -File tools\make-shortcut.ps1
# ============================================================

$ErrorActionPreference = 'Stop'

# Thu muc goc du an = thu muc cha cua tools\
$proj = Split-Path -Parent $PSScriptRoot
$target = Join-Path $proj 'Mo-Dashboard.cmd'
$icon = Join-Path $proj 'assets\dashboard.ico'

if (-not (Test-Path $target)) {
  Write-Error "Khong tim thay $target - file nay phai nam o thu muc goc du an."
  exit 1
}

# Icon duoc sinh boi tools\make-icon.js. Neu chua co thi tao luon.
if (-not (Test-Path $icon)) {
  Write-Host "Chua co icon, dang tao..."
  Push-Location $proj
  try { & node 'tools\make-icon.js' } finally { Pop-Location }
}

$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Ucmas Ads Analytics.lnk'

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath       = $target
$s.WorkingDirectory = $proj
$s.Description      = 'Mo dashboard phan tich Meta Ads - BM Ucmas Viet Nam'
$s.WindowStyle      = 1
if (Test-Path $icon) { $s.IconLocation = "$icon,0" }
$s.Save()

Write-Host ''
Write-Host '  Da tao shortcut ngoai Desktop:' -ForegroundColor Green
Write-Host "    $lnk"
Write-Host "    -> $target"
Write-Host ''
Write-Host '  Double-click shortcut de mo dashboard.'
Write-Host '  Dong cua so console de tat dashboard.'
Write-Host ''
