$ErrorActionPreference = 'Stop'
try {
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
  # Data is delivered only through stdin, never interpolated into PowerShell source.
  $request = [Console]::In.ReadLine() | ConvertFrom-Json
  Add-Type -Path (Join-Path $PSScriptRoot 'windows-job.cs')
  $environment = New-Object 'System.Collections.Generic.Dictionary[string,string]'
  foreach ($property in $request.environment.PSObject.Properties) { $environment.Add($property.Name, [string]$property.Value) }
  [StackGateJob]::Run([string]$request.executable, [string[]]$request.args, [string]$request.cwd, $environment, [string]$request.status_directory, [string]$request.owner_token, $PSVersionTable.PSVersion.ToString())
  exit 0
} catch {
  [Console]::Error.WriteLine('StackGate owned process broker could not complete.')
  exit 3
}
