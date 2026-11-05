[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$PremierePid
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$process = Get-Process -Id $PremierePid -ErrorAction Stop
if ($process.ProcessName -ne 'Adobe Premiere Pro') {
  throw 'PREMIERE_PROCESS_MISMATCH'
}
$executablePath = $process.MainModule.FileName
if (-not $executablePath.EndsWith('Adobe Premiere Pro.exe', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'PREMIERE_EXECUTABLE_MISMATCH'
}
$version = [Diagnostics.FileVersionInfo]::GetVersionInfo($executablePath)
if ($version.FileMajorPart -ne 26 -or $version.FileMinorPart -ne 3) {
  throw 'PREMIERE_VERSION_UNVERIFIED'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class PremiereClipSpeedReadOnlyProbe {
    public delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr window);
    [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr menu, int position);
    [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr menu, int position);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetMenuString(IntPtr menu, uint item, StringBuilder text, int max, uint flags);
}
'@

$windows = [Collections.ArrayList]::new()
$callback = [PremiereClipSpeedReadOnlyProbe+EnumWindowsProc]{
  param([IntPtr]$window, [IntPtr]$parameter)
  $owner = [uint32]0
  [void][PremiereClipSpeedReadOnlyProbe]::GetWindowThreadProcessId($window, [ref]$owner)
  if ($owner -eq [uint32]$PremierePid -and [PremiereClipSpeedReadOnlyProbe]::GetMenu($window) -ne [IntPtr]::Zero) {
    [void]$windows.Add([IntPtr]$window)
  }
  return $true
}
[void][PremiereClipSpeedReadOnlyProbe]::EnumWindows($callback, [IntPtr]::Zero)

$candidates = [Collections.ArrayList]::new()
function Find-SpeedCommand([IntPtr]$Menu, [string]$Parent, [int]$Depth) {
  if ($Depth -gt 8) { return }
  $count = [PremiereClipSpeedReadOnlyProbe]::GetMenuItemCount($Menu)
  for ($position = 0; $position -lt $count; $position += 1) {
    $text = [Text.StringBuilder]::new(1024)
    [void][PremiereClipSpeedReadOnlyProbe]::GetMenuString($Menu, [uint32]$position, $text, $text.Capacity, [uint32]0x0400)
    $label = $text.ToString()
    $path = if ($Parent) { "$Parent > $label" } else { $label }
    if ($label -match '(?i)(speed.*duration|duration.*speed|\uC18D\uB3C4.*\uC9C0\uC18D|\uC9C0\uC18D.*\uC18D\uB3C4)') {
      $commandId = [PremiereClipSpeedReadOnlyProbe]::GetMenuItemID($Menu, $position)
      if ($commandId -ne [uint32]::MaxValue) {
        [void]$candidates.Add([pscustomobject]@{ commandId = [uint32]$commandId; path = $path })
      }
    }
    $submenu = [PremiereClipSpeedReadOnlyProbe]::GetSubMenu($Menu, $position)
    if ($submenu -ne [IntPtr]::Zero) {
      Find-SpeedCommand -Menu $submenu -Parent $path -Depth ($Depth + 1)
    }
  }
}

foreach ($window in $windows) {
  Find-SpeedCommand -Menu ([PremiereClipSpeedReadOnlyProbe]::GetMenu($window)) -Parent '' -Depth 0
}

[pscustomobject]@{
  status = 'pass'
  route = 'premiere_win32_read_only_menu_probe'
  premierePid = $PremierePid
  premiereVersion = $version.FileVersion
  candidates = @($candidates | Sort-Object commandId, path -Unique)
  errors = @()
} | ConvertTo-Json -Depth 5 -Compress
