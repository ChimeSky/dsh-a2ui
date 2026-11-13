<#
.SYNOPSIS
  Install, uninstall, or verify dsh-a2ui in a DSH profile.

.DESCRIPTION
  Uses DSH's own `dsh plugin` pnpm bridge with the frozen vendor tarball so the
  installed bytes match what was tested. Quit DSH fully before installing or
  uninstalling; the profile reloads on the next launch.

.EXAMPLE
  pwsh -File .\tools\install.ps1

.EXAMPLE
  pwsh -File .\tools\install.ps1 -Profile web -DshHome C:\temp\dsh-home

.EXAMPLE
  pwsh -File .\tools\install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }),
  [string]$Profile = $(if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }),
  [string]$Tarball,
  [string]$DshCmd,
  [switch]$Uninstall,
  [switch]$VerifyOnly,
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# Resolve the home once, to an absolute path, so the manifest lookup, the child
# process environment and the verification all address the same location even
# when the caller passes a relative path or the inherited DSH_HOME differs.
if (-not [System.IO.Path]::IsPathRooted($DshHome)) {
  $DshHome = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $DshHome))
}
$DshHome = [System.IO.Path]::GetFullPath($DshHome)
$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$manifestPath = Join-Path $profileDir 'package.json'

function Resolve-DshCmd {
  param([string]$Explicit)
  if ($Explicit) {
    if (-not (Test-Path -LiteralPath $Explicit)) { throw "dsh command not found: $Explicit" }
    return (Resolve-Path -LiteralPath $Explicit).Path
  }
  $onPath = Get-Command dsh -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $candidates = @(
    'D:\Apps\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd',
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw 'Could not find dsh.cmd; pass -DshCmd <path>.'
}

function Invoke-Verify {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Warning 'node is not on PATH; skipped byte-level verification.'
    return
  }
  & $node.Source (Join-Path $PSScriptRoot 'verify-install.mjs') --dsh-home $DshHome --profile $Profile
  if ($LASTEXITCODE -ne 0) { throw 'Install verification failed.' }
}

function Invoke-DshPlugin {
  <#
    Run `dsh plugin` against the resolved DSH home.

    The child process must use the path this script was given, not whatever
    DSH_HOME it inherited, so the variable is set for the call and restored in a
    finally block even when the command fails.
  #>
  param([string[]]$PluginArguments)
  $previous = $env:DSH_HOME
  try {
    $env:DSH_HOME = $DshHome
    & $dsh plugin --profile $Profile @PluginArguments
    if ($LASTEXITCODE -ne 0) {
      throw "dsh plugin $($PluginArguments -join ' ') failed with exit $LASTEXITCODE"
    }
  } finally {
    if ($null -eq $previous) {
      Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue
    } else {
      $env:DSH_HOME = $previous
    }
  }
}

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Profile manifest not found: $manifestPath. Launch DSH once to initialize this profile."
}

if ($VerifyOnly) {
  Invoke-Verify
  exit 0
}

$dsh = Resolve-DshCmd -Explicit $DshCmd
$running = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
if ($running) {
  Write-Warning 'DeepSeek Harness is running. Quit it fully before relying on the installed plugin; a running Host will not reload a replaced package generation.'
}

if ($Uninstall) {
  Write-Host "Removing dsh-a2ui from profile '$Profile'..."
  Invoke-DshPlugin -PluginArguments @('remove', 'dsh-a2ui')

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $bundles = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-a2ui' })
  $manifest.dsh.profile.bundles = $bundles
  $manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
  Write-Host 'Removed the bundle entry. Restart DSH to return to native behavior.'
  exit 0
}

if (-not $Tarball) {
  $vendor = Join-Path $root 'vendor'
  $Tarball = Get-ChildItem -LiteralPath $vendor -Filter '*.tgz' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Tarball -or -not (Test-Path -LiteralPath $Tarball)) {
  throw "No vendor tarball found. Run 'npm run pack:vendor' first, or pass -Tarball."
}

Write-Host "DSH home : $DshHome"
Write-Host "Profile  : $Profile"
Write-Host "Tarball  : $Tarball"
Write-Host "Installing..."
Invoke-DshPlugin -PluginArguments @('add', $Tarball)

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if (-not ($manifest.dsh.profile.bundles -contains 'dsh-a2ui')) {
  $manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles) + 'dsh-a2ui'
  $manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
  Write-Host 'Added dsh-a2ui to dsh.profile.bundles.'
} else {
  Write-Host 'Bundle already present in dsh.profile.bundles.'
}

if (-not $SkipVerify) { Invoke-Verify }
Write-Host 'Done. Restart DSH Desktop to load the new generation.'
