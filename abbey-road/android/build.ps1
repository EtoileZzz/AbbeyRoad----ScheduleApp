$ErrorActionPreference = 'Stop'

# Abbey Road - Android build
# Requires: JDK 17 + Android SDK 34 (platform 34 + build-tools 34.0.0)
#
# Toolchain paths and the signing password come from environment variables or a
# local private config, so the repository never carries any private data:
#   $env:ABBEYROAD_BUILD_ROOT   -> toolchain root (default $HOME\.android-build)
#   $env:ABBEYROAD_KS_PASS      -> keystore password
#   $ks / $ksPass               -> may also be set by build.local.ps1 in this dir
# build.local.ps1 is gitignored, so it never enters the repo or the source zip.
#
# NOTE FOR MAINTAINERS: keep THIS FILE pure ASCII. Windows PowerShell 5.1 reads
# BOM-less files as ANSI, so non-ASCII text here corrupts the parser. Runtime
# strings that must be Chinese are written with [char]0xXXXX escapes.

$root      = $PSScriptRoot
$projRoot  = Split-Path $root -Parent
$appDir    = Join-Path $projRoot 'app'
$dist      = Join-Path $projRoot 'dist'
$buildRoot = if ($env:ABBEYROAD_BUILD_ROOT) { $env:ABBEYROAD_BUILD_ROOT } else { Join-Path $HOME '.android-build' }
$ksPass    = if ($env:ABBEYROAD_KS_PASS) { $env:ABBEYROAD_KS_PASS } else { 'abbeyroad-dev' }
$ks        = ''

$localCfg = Join-Path $root 'build.local.ps1'
if (Test-Path $localCfg) { . $localCfg }   # local private override (not committed)

$jdk       = Join-Path $buildRoot 'jdk-17.0.20+8'
$sdk       = Join-Path $buildRoot 'sdk'
$platform  = Join-Path $sdk 'platforms\android-34\android.jar'
$bt        = Join-Path $sdk 'build-tools\34.0.0'
$version   = '0.4.1a'

$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$bt;$env:PATH"

foreach ($p in @($jdk, $platform, $bt)) {
    if (-not (Test-Path $p)) { throw "Missing build dependency: $p" }
}

$out = Join-Path $root 'build'
$gen = Join-Path $out 'gen'
$obj = Join-Path $out 'obj'
$dexDir = Join-Path $out 'dex'
$toolOut = Join-Path $out 'tools'
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $out, $gen, $obj, $dexDir, $toolOut, $dist | Out-Null

# 1) copy the shared web UI into assets/web
$assets = Join-Path $root 'assets\web'
Remove-Item -Recurse -Force (Join-Path $root 'assets') -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $assets | Out-Null
Copy-Item -Path (Join-Path $appDir '*') -Destination $assets -Recurse -Force
Write-Host "== assets synced: $((Get-ChildItem $assets -Recurse -File).Count) files =="

# 2) resource compile + link
Write-Host '== aapt2 compile =='
& "$bt\aapt2.exe" compile --dir "$root\res" -o "$out\res.zip"
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }

Write-Host '== aapt2 link =='
& "$bt\aapt2.exe" link -o "$out\base.apk" -I $platform --manifest "$root\AndroidManifest.xml" `
    --java $gen --min-sdk-version 26 --target-sdk-version 34 `
    --version-code 52 --version-name $version "$out\res.zip"
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

# 3) compile Java
Write-Host '== javac =='
$sources = Get-ChildItem "$root\src" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& "$jdk\bin\javac.exe" -encoding UTF-8 -source 1.8 -target 1.8 -bootclasspath $platform `
    -classpath $gen -d $obj $sources
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

# 4) dex
Write-Host '== d8 =='
# timestamped name so a still-locked classes.jar from a previous build cannot break jar.exe
$classesJar = Join-Path $out ('classes-' + (Get-Date -Format 'HHmmss') + '.jar')
& "$jdk\bin\jar.exe" cf $classesJar -C $obj .
if ($LASTEXITCODE -ne 0) { throw 'jar failed' }
& "$bt\d8.bat" --release --lib $platform --min-api 26 --output $dexDir $classesJar
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

# 5) repackage (dex + assets)
Write-Host '== repackage =='
& "$jdk\bin\javac.exe" -encoding UTF-8 -d $toolOut "$root\tools\ApkBuilder.java"
if ($LASTEXITCODE -ne 0) { throw 'ApkBuilder compile failed' }
& "$jdk\bin\java.exe" -cp $toolOut ApkBuilder "$out\base.apk" "$out\rebuilt.apk" (Join-Path $dexDir 'classes.dex') (Join-Path $root 'assets')
if ($LASTEXITCODE -ne 0) { throw 'ApkBuilder failed' }

# 6) align + sign
Write-Host '== zipalign =='
& "$bt\zipalign.exe" -f 4 "$out\rebuilt.apk" "$out\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

Write-Host '== sign =='
# $ks may be set by build.local.ps1 (local private, not committed); only fall
# back to the toolchain default location when it was not overridden.
if (-not $ks) { $ks = Join-Path $buildRoot 'abbeyroad.keystore' }
# NEVER auto-generate a key here: a freshly generated key produces an APK whose
# signature does not match the installed app, so users cannot upgrade in place.
# Fail loudly instead, and let a human provide the correct historical key.
if (-not (Test-Path $ks)) {
    $m = [char]0x7B7E + [char]0x540D + [char]0x94A5 + [char]0x5319 + [char]0x4E0D + [char]0x5B58 + [char]0x5728
    throw "$m : $ks"
}
if (-not $ksPass) {
    $m2 = [char]0x7F3A + [char]0x5C11 + [char]0x7B7E + [char]0x540D + [char]0x53E3 + [char]0x4EE4
    throw "$m2 : set `$env:ABBEYROAD_KS_PASS or `$ksPass in build.local.ps1"
}
$apk = Join-Path $dist "AbbeyRoad-v$version.apk"
& "$bt\apksigner.bat" sign --ks $ks --ks-pass "pass:$ksPass" --key-pass "pass:$ksPass" `
    --out $apk "$out\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }

Write-Host ''
Write-Host "DONE -> $apk"
Get-Item $apk | Select-Object FullName, Length, LastWriteTime | Format-List
