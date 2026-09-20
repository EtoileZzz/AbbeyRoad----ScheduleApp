$ErrorActionPreference = 'Stop'

# Abbey Road · Android 构建
# 依赖：JDK 17 + Android SDK 34（platform 34 + build-tools 34.0.0）
#
# 路径与签名口令都从环境变量 / 本地私有配置读，仓库里不放任何私人信息：
#   $env:ABBEYROAD_BUILD_ROOT   → 工具链根目录（默认 $HOME\.android-build）
#   $env:ABBEYROAD_KS_PASS      → keystore 口令（默认 abbeyroad-dev，仅用于本地自签名调试）
# 也可以在本目录放一个 build.local.ps1（已在 .gitignore 里）覆盖这两项。

$root      = $PSScriptRoot
$projRoot  = Split-Path $root -Parent
$appDir    = Join-Path $projRoot 'app'
$dist      = Join-Path $projRoot 'dist'
$buildRoot = if ($env:ABBEYROAD_BUILD_ROOT) { $env:ABBEYROAD_BUILD_ROOT } else { Join-Path $HOME '.android-build' }
$ksPass    = if ($env:ABBEYROAD_KS_PASS) { $env:ABBEYROAD_KS_PASS } else { 'abbeyroad-dev' }

$localCfg = Join-Path $root 'build.local.ps1'
if (Test-Path $localCfg) { . $localCfg }   # 本地私有覆盖（不入库）

$jdk       = Join-Path $buildRoot 'jdk-17.0.20+8'
$sdk       = Join-Path $buildRoot 'sdk'
$platform  = Join-Path $sdk 'platforms\android-34\android.jar'
$bt        = Join-Path $sdk 'build-tools\34.0.0'
$version   = '0.3.0'

$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$bt;$env:PATH"

foreach ($p in @($jdk, $platform, $bt)) {
    if (-not (Test-Path $p)) { throw "缺少构建依赖：$p" }
}

$out = Join-Path $root 'build'
$gen = Join-Path $out 'gen'
$obj = Join-Path $out 'obj'
$dexDir = Join-Path $out 'dex'
$toolOut = Join-Path $out 'tools'
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $out, $gen, $obj, $dexDir, $toolOut, $dist | Out-Null

# 1) 把共用网页拷进 assets/web
$assets = Join-Path $root 'assets\web'
Remove-Item -Recurse -Force (Join-Path $root 'assets') -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $assets | Out-Null
Copy-Item -Path (Join-Path $appDir '*') -Destination $assets -Recurse -Force
Write-Host "== assets 已同步：$((Get-ChildItem $assets -Recurse -File).Count) 个文件 =="

# 2) 资源编译与链接
Write-Host '== aapt2 compile =='
& "$bt\aapt2.exe" compile --dir "$root\res" -o "$out\res.zip"
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }

Write-Host '== aapt2 link =='
& "$bt\aapt2.exe" link -o "$out\base.apk" -I $platform --manifest "$root\AndroidManifest.xml" `
    --java $gen --min-sdk-version 26 --target-sdk-version 34 `
    --version-code 21 --version-name $version "$out\res.zip"
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

# 3) Java 编译
Write-Host '== javac =='
$sources = Get-ChildItem "$root\src" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& "$jdk\bin\javac.exe" -encoding UTF-8 -source 1.8 -target 1.8 -bootclasspath $platform `
    -classpath $gen -d $obj $sources
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

# 4) dex
Write-Host '== d8 =='
# 用带时间戳的文件名，避免上一次构建残留的 classes.jar 被占用导致 jar 失败
$classesJar = Join-Path $out ('classes-' + (Get-Date -Format 'HHmmss') + '.jar')
& "$jdk\bin\jar.exe" cf $classesJar -C $obj .
if ($LASTEXITCODE -ne 0) { throw 'jar failed' }
& "$bt\d8.bat" --release --lib $platform --min-api 26 --output $dexDir $classesJar
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

# 5) 重打包（dex + assets）
Write-Host '== repackage =='
& "$jdk\bin\javac.exe" -encoding UTF-8 -d $toolOut "$root\tools\ApkBuilder.java"
if ($LASTEXITCODE -ne 0) { throw 'ApkBuilder compile failed' }
& "$jdk\bin\java.exe" -cp $toolOut ApkBuilder "$out\base.apk" "$out\rebuilt.apk" (Join-Path $dexDir 'classes.dex') (Join-Path $root 'assets')
if ($LASTEXITCODE -ne 0) { throw 'ApkBuilder failed' }

# 6) 对齐 + 签名
Write-Host '== zipalign =='
& "$bt\zipalign.exe" -f 4 "$out\rebuilt.apk" "$out\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

Write-Host '== sign =='
$ks = Join-Path $buildRoot 'abbeyroad.keystore'
if (-not (Test-Path $ks)) {
    & "$jdk\bin\keytool.exe" -genkeypair -v -keystore $ks -alias abbeyroad -keyalg RSA -keysize 2048 `
        -validity 10000 -storepass $ksPass -keypass $ksPass `
        -dname "CN=Abbey Road, OU=Dev, O=Abbey Road, C=CN"
    if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
}
$apk = Join-Path $dist "AbbeyRoad-v$version.apk"
& "$bt\apksigner.bat" sign --ks $ks --ks-pass "pass:$ksPass" --key-pass "pass:$ksPass" `
    --out $apk "$out\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }

Write-Host ''
Write-Host "DONE -> $apk"
Get-Item $apk | Select-Object FullName, Length, LastWriteTime | Format-List
