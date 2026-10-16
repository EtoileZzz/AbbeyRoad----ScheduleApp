param(
    [string]$OutFile = 'dist\_gh_push_meta.json'
)

# Generate git metadata for tools/gh-api-push.js.
# Why a script: this sandbox blocks node from spawning git (EPERM), so pwsh
# pre-generates the commit info + tracked file list and node only reads it.
# NOTE: keep this file ASCII-only (PowerShell 5.1 misreads BOM-less UTF-8).

$ErrorActionPreference = 'Stop'
$ws = 'C:\Users\Etoile\Documents\ARProject'
Set-Location $ws

Write-Host '== collecting git info =='

$authorLine = git log -1 --pretty=format:'%an%n%ae%n%ad' --date=iso-strict
$parts = $authorLine -split "`n"
$author = $parts[0].Trim()
$email = $parts[1].Trim()
$date = $parts[2].Trim()

$commit = (git rev-parse HEAD).Trim()
$subject = ((git log -1 --pretty=format:'%s') -join " ").Trim()
$message = ((git log -1 --pretty=format:'%B') -join "`n")

Write-Host ("  commit : " + $commit.Substring(0, 8) + "  " + $subject)
Write-Host ("  author : " + $author + " <" + $email + ">  " + $date)

$files = New-Object System.Collections.Generic.List[object]
$treeOut = git ls-tree -r -z --full-tree HEAD
$entries = $treeOut -split "`0" | Where-Object { $_ -ne '' }
foreach ($e in $entries) {
    $m = [regex]::Match($e, '^(\d{6})\s+blob\s+([0-9a-f]{40})\s+(.+)$')
    if (-not $m.Success) { continue }
    $files.Add([pscustomobject]@{
        path = $m.Groups[3].Value
        mode = $m.Groups[1].Value
        sha  = $m.Groups[2].Value
    })
}
Write-Host ("  tracked files: " + $files.Count)

$outDir = Split-Path -Parent $OutFile
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

$meta = [pscustomobject]@{
    commit  = $commit
    subject = $subject
    author  = $author
    email   = $email
    date    = $date
    message = $message.TrimEnd()
    files   = $files
}
$json = $meta | ConvertTo-Json -Depth 6 -Compress
$target = $OutFile
[IO.File]::WriteAllText($target, $json, [Text.UTF8Encoding]::new($false))
$kb = [math]::Round((Get-Item $target).Length / 1KB)
Write-Host ("  wrote " + $target + " (" + $kb + " KB)")
