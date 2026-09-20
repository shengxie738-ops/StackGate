$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$bin = Join-Path $root 'tools/bin/oasdiff-1.32.1'
$metadata = Join-Path $root 'tools/oasdiff'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$release = 'https://github.com/oasdiff/oasdiff/releases/download/v1.32.1'
$archiveName = 'oasdiff_1.32.1_windows_amd64.tar.gz'
$archive = Join-Path $bin $archiveName
$checksums = Join-Path $metadata 'checksums-v1.32.1.txt'
Invoke-WebRequest "$release/checksums.txt" -OutFile $checksums
Invoke-WebRequest "$release/$archiveName" -OutFile $archive
$publishedHash = '4d0758b32d454e6011e59db93884af1ca27ae2b212d990f36738ea5efb5d7f28'
$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumLine = Get-Content -LiteralPath $checksums | Where-Object { $_ -match "  $([regex]::Escape($archiveName))$" }
if ($checksumLine -ne "$publishedHash  $archiveName" -or $archiveHash -ne $publishedHash) {
  throw 'Official checksum or archive digest mismatch; refusing execution'
}
$members = & tar -tzf $archive
if ($LASTEXITCODE -ne 0) { throw 'Archive inspection failed' }
$members | ForEach-Object { if ($_ -match '(^/|(^|[\\/])\.\.([\\/]|$)|:)') { throw 'Unsafe archive member' } }
Write-Output ($members -join "`n")
& tar -xzf $archive -C $bin
if ($LASTEXITCODE -ne 0) { throw 'Archive extraction failed' }
$exe = Join-Path $bin 'oasdiff.exe'
$binaryHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
$version = & $exe --version
if ($LASTEXITCODE -ne 0) { throw 'Version check failed' }
$result = [ordered]@{
  name = 'oasdiff'; version = '1.32.1'; platform = 'win32-x64'; source = "$release/$archiveName";
  checksums_source = "$release/checksums.txt"; archive_sha256 = $archiveHash;
  executable_sha256 = $binaryHash; executable = $exe; observed_version_output = $version;
  prepared_at = [DateTime]::UtcNow.ToString('o'); capability_status = 'UNVERIFIED'
}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $metadata 'installation.json') -Encoding utf8
$result | ConvertTo-Json
