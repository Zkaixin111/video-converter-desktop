#requires -version 5.1
<#
.SYNOPSIS
    Video Converter - Development Environment Check

.DESCRIPTION
    Verifies that the local machine meets the requirements described in
    "开发环境准备清单.md". Run from the project root or anywhere.

.EXAMPLE
    pwsh -File scripts\check-env.ps1
#>

$ErrorActionPreference = "Continue"

$script:FailCount  = 0
$script:WarnCount  = 0
$script:PassCount  = 0

function Write-Result {
    param(
        [string]$Status,
        [string]$Name,
        [string]$Detail
    )
    switch ($Status) {
        "PASS" {
            Write-Host ("  [PASS] ") -ForegroundColor Green -NoNewline
            $script:PassCount++
        }
        "WARN" {
            Write-Host ("  [WARN] ") -ForegroundColor Yellow -NoNewline
            $script:WarnCount++
        }
        "FAIL" {
            Write-Host ("  [FAIL] ") -ForegroundColor Red -NoNewline
            $script:FailCount++
        }
    }
    Write-Host ("{0,-28} {1}" -f $Name, $Detail)
}

function Test-CommandExists {
    param([string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

[Console]::WriteLine()
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  Video Converter - Environment Check" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
[Console]::WriteLine()

# ---------------------------------------------------------------- 1. Node.js
Write-Host "[1/8] Node.js" -ForegroundColor White
if (Test-CommandExists "node") {
    $nodeRaw = (& node -v).Trim()
    $nodeVer = $nodeRaw.TrimStart('v')
    try {
        if ([version]$nodeVer -ge [version]'22.12.0') {
            Write-Result "PASS" "node" "$nodeRaw  (requires >= 22.12.0)"
        } else {
            Write-Result "FAIL" "node" "$nodeRaw  TOO OLD, requires >= 22.12.0"
        }
    } catch {
        Write-Result "WARN" "node" "$nodeRaw  (could not parse version)"
    }
} else {
    Write-Result "FAIL" "node" "not found. Install Node.js 22 LTS or 24 LTS."
}

# ---------------------------------------------------------------- 2. npm
Write-Host "[2/8] npm" -ForegroundColor White
if (Test-CommandExists "npm") {
    $npmVer = (& npm -v).Trim()
    Write-Result "PASS" "npm" $npmVer
} else {
    Write-Result "FAIL" "npm" "not found. It ships with Node.js."
}

# ---------------------------------------------------------------- 3. pnpm
Write-Host "[3/8] pnpm" -ForegroundColor White
if (Test-CommandExists "pnpm") {
    $pnpmVer = (& pnpm -v).Trim()
    Write-Result "PASS" "pnpm" $pnpmVer
} else {
    Write-Result "WARN" "pnpm" "not found. Run: npm install -g pnpm   (npm still works)"
}

# ---------------------------------------------------------------- 4. Git
Write-Host "[4/8] Git" -ForegroundColor White
if (Test-CommandExists "git") {
    $gitVer = (& git --version).Trim()
    Write-Result "PASS" "git" $gitVer
} else {
    Write-Result "FAIL" "git" "not found. Install Git for Windows."
}

# ---------------------------------------------------------------- 5. ffmpeg
Write-Host "[5/8] FFmpeg" -ForegroundColor White
$ffmpegPath = $null
if (Test-CommandExists "ffmpeg") {
    $ffmpegPath = (Get-Command "ffmpeg").Source
    $ffLine = (& ffmpeg -version 2>&1 | Select-Object -First 1)
    Write-Result "PASS" "ffmpeg" $ffLine
} else {
    Write-Result "FAIL" "ffmpeg" "not found. Run: winget install Gyan.FFmpeg"
}

# ---------------------------------------------------------------- 6. ffprobe
Write-Host "[6/8] FFprobe" -ForegroundColor White
$ffprobePath = $null
if (Test-CommandExists "ffprobe") {
    $ffprobePath = (Get-Command "ffprobe").Source
    $fpLine = (& ffprobe -version 2>&1 | Select-Object -First 1)
    Write-Result "PASS" "ffprobe" $fpLine
} else {
    Write-Result "FAIL" "ffprobe" "not found. It ships with FFmpeg."
}

# ---------------------------------------------------------------- 7. Encoders
Write-Host "[7/8] Required encoders (GPL build check)" -ForegroundColor White
if ($ffmpegPath) {
    $encRaw = (& ffmpeg -hide_banner -encoders 2>&1) -join "`n"
    $required = @("libx264", "libx265")
    $recommended = @("libvpx-vp9", "libopus", "aac", "libmp3lame")

    $missing = @()
    foreach ($e in $required) {
        if ($encRaw -notmatch [regex]::Escape($e)) { $missing += $e }
    }

    if ($missing.Count -eq 0) {
        Write-Result "PASS" "libx264 / libx265" "both present (GPL build OK)"
    } else {
        Write-Result "FAIL" "libx264 / libx265" ("MISSING: " + ($missing -join ", ") + "  -> you installed an LGPL build. Reinstall the FULL build.")
    }

    $missing2 = @()
    foreach ($e in $recommended) {
        if ($encRaw -notmatch [regex]::Escape($e)) { $missing2 += $e }
    }
    if ($missing2.Count -eq 0) {
        Write-Result "PASS" "recommended encoders" ($recommended -join ", ")
    } else {
        Write-Result "WARN" "recommended encoders" ("missing: " + ($missing2 -join ", "))
    }

    $hwRaw = (& ffmpeg -hide_banner -hwaccels 2>&1) -join " "
    if ($hwRaw -match "cuda") {
        Write-Result "PASS" "hardware accel" "cuda available (NVENC path possible in P1)"
    } elseif ($hwRaw -match "qsv") {
        Write-Result "PASS" "hardware accel" "qsv available (Intel path possible in P1)"
    } else {
        Write-Result "WARN" "hardware accel" "no cuda/qsv detected, CPU encoding only (fine for MVP)"
    }
} else {
    Write-Result "FAIL" "encoders" "skipped because ffmpeg is missing"
}

# ---------------------------------------------------------------- 8. Bundled binaries
Write-Host "[8/8] Bundled binaries in project" -ForegroundColor White
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$binDir = Join-Path $projectRoot "resources\bin\win32-x64"

if (Test-Path $binDir) {
    $hasFfmpeg  = Test-Path (Join-Path $binDir "ffmpeg.exe")
    $hasFfprobe = Test-Path (Join-Path $binDir "ffprobe.exe")
    if ($hasFfmpeg -and $hasFfprobe) {
        Write-Result "PASS" "resources/bin/win32-x64" "ffmpeg.exe + ffprobe.exe present"
    } else {
        Write-Result "WARN" "resources/bin/win32-x64" "directory exists but binaries are missing"
    }
} else {
    Write-Result "WARN" "resources/bin/win32-x64" "not created yet. Copy ffmpeg.exe + ffprobe.exe here before packaging."
}

# ---------------------------------------------------------------- Summary
[Console]::WriteLine()
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ("  PASS: {0}   WARN: {1}   FAIL: {2}" -f $script:PassCount, $script:WarnCount, $script:FailCount) -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

if ($script:FailCount -eq 0) {
    [Console]::WriteLine()
    Write-Host "  ENV READY - you can start Phase 0." -ForegroundColor Green
    if ($script:WarnCount -gt 0) {
        Write-Host "  (warnings are non-blocking)" -ForegroundColor DarkGray
    }
    [Console]::WriteLine()
    exit 0
} else {
    [Console]::WriteLine()
    Write-Host "  ENV NOT READY - fix the FAIL items above first." -ForegroundColor Red
    Write-Host "  See: 'Development Environment Checklist.md' section 3 (steps) and section 6 (pitfalls)." -ForegroundColor DarkGray
    [Console]::WriteLine()
    exit 1
}
