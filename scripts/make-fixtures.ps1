#requires -version 5.1
<#
.SYNOPSIS
    Generate test fixtures for the 8 supported containers.

.DESCRIPTION
    Creates short 3-second clips (with audio) in every container the app supports,
    so the 56-combination regression can run without hunting for real samples.

    Requires ffmpeg in PATH.

.EXAMPLE
    pwsh -File scripts\make-fixtures.ps1
    pwsh -File scripts\make-fixtures.ps1 -OutputDir .\fixtures -Duration 3
#>

param(
    [string]$OutputDir = "fixtures",
    [int]$Duration = 3,
    [int]$Width = 640,
    [int]$Height = 480,
    [int]$Fps = 30
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: ffmpeg not found in PATH." -ForegroundColor Red
    Write-Host "       Run: winget install Gyan.FFmpeg   (then open a NEW terminal)" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$OutputDir = (Resolve-Path $OutputDir).Path
$srcArgs = @(
    "-f", "lavfi", "-i", "testsrc2=size=${Width}x${Height}:rate=${Fps}:duration=$Duration",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=$Duration"
)

function Invoke-FFmpeg {
    param(
        [string]$Name,
        [string[]]$ExtraArgs
    )
    $out = Join-Path $OutputDir $Name
    Write-Host ("  -> {0}" -f $Name) -NoNewline

    $ffArgs = @("-hide_banner", "-loglevel", "error", "-y") + $srcArgs + $ExtraArgs + @($out)
    & ffmpeg @ffArgs
    $code = $LASTEXITCODE

    if ($code -ne 0) {
        Write-Host "   FAILED" -ForegroundColor Red
        return $false
    }
    if (-not (Test-Path $out)) {
        Write-Host "   MISSING OUTPUT" -ForegroundColor Red
        return $false
    }
    $size = [math]::Round((Get-Item $out).Length / 1KB, 1)
    Write-Host ("   OK ({0} KB)" -f $size) -ForegroundColor Green
    return $true
}

Write-Host ""
Write-Host "Generating fixtures into: $OutputDir" -ForegroundColor Cyan
Write-Host ("  source: testsrc2 {0}x{1} @{2}fps, {3}s, 440Hz sine" -f $Width, $Height, $Fps, $Duration) -ForegroundColor DarkGray
Write-Host ""

$ok = 0
$fail = 0

# ---- MP4 : H.264 + AAC (the baseline, most common source) ----------------
if (Invoke-FFmpeg "sample.mp4" @(
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart"
    )) { $ok++ } else { $fail++ }

# ---- MKV : H.264 + AAC (remux-friendly, the key "flash convert" case) ----
if (Invoke-FFmpeg "sample.mkv" @(
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k"
    )) { $ok++ } else { $fail++ }

# ---- MOV : H.264 + AAC (iPhone-style source) -----------------------------
if (Invoke-FFmpeg "sample.mov" @(
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k"
    )) { $ok++ } else { $fail++ }

# ---- AVI : MPEG-4 Part 2 + MP3 (legacy source) ---------------------------
if (Invoke-FFmpeg "sample.avi" @(
        "-c:v", "mpeg4", "-b:v", "1200k",
        "-pix_fmt", "yuv420p",
        "-c:a", "libmp3lame", "-b:a", "128k"
    )) { $ok++ } else { $fail++ }

# ---- FLV : H.264 + AAC (Bilibili legacy downloads) -----------------------
if (Invoke-FFmpeg "sample.flv" @(
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k"
    )) { $ok++ } else { $fail++ }

# ---- WMV : WMV2 + WMA2 (the "must transcode" case) -----------------------
if (Invoke-FFmpeg "sample.wmv" @(
        "-c:v", "wmv2", "-b:v", "1200k",
        "-pix_fmt", "yuv420p",
        "-c:a", "wmav2", "-b:a", "128k"
    )) { $ok++ } else { $fail++ }

# ---- WebM : VP9 + Opus (slow encoder, use realtime deadline) -------------
if (Invoke-FFmpeg "sample.webm" @(
        "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "40",
        "-deadline", "realtime", "-cpu-used", "8",
        "-pix_fmt", "yuv420p",
        "-c:a", "libopus", "-b:a", "96k"
    )) { $ok++ } else { $fail++ }

# ---- MPEG : MPEG-2 video + MP2 audio (old DVD-style) ---------------------
if (Invoke-FFmpeg "sample.mpg" @(
        "-c:v", "mpeg2video", "-b:v", "3000k",
        "-pix_fmt", "yuv420p",
        "-c:a", "mp2", "-b:a", "192k",
        "-f", "mpeg"
    )) { $ok++ } else { $fail++ }

# ---- BONUS: audio-only (tests the "no video stream" branch) --------------
if (Invoke-FFmpeg "audio-only.m4a" @(
        "-vn", "-c:a", "aac", "-b:a", "128k", "-f", "mp4"
    )) { $ok++ } else { $fail++ }

# ---- BONUS: a deliberately broken file (tests E_INVALID_INPUT) -----------
$brokenPath = Join-Path $OutputDir "broken.mp4"
"this is not a video file" | Out-File -FilePath $brokenPath -Encoding ASCII
Write-Host "  -> broken.mp4                    OK (intentional fake)" -ForegroundColor Green
$ok++

Write-Host ""
Write-Host "Done. $ok generated, $fail failed." -ForegroundColor Cyan

if ($fail -gt 0) {
    Write-Host ""
    Write-Host "Some fixtures failed. Most likely causes:" -ForegroundColor Yellow
    Write-Host "  1. Your ffmpeg build lacks libvpx-vp9 / wmv2 / libopus  ->  install the FULL build" -ForegroundColor Gray
    Write-Host "  2. Old ffmpeg version  ->  upgrade to 8.x" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Check available encoders with:  ffmpeg -encoders | Select-String 'libx264|libvpx|wmv2|opus'" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "Next: verify them with  ffprobe -v error -show_streams <file>" -ForegroundColor DarkGray
Write-Host ""
exit 0
