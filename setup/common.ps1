# Shared helpers for the setup steps. Each step script loads this file first.
$ErrorActionPreference = 'Stop'
$SetupDir = $PSScriptRoot
$Root     = Split-Path -Parent $SetupDir          # the kun-mh folder
$Server   = Join-Path $Root 'server'
$EnvFile  = Join-Path $Server '.env'

function Write-Step([string]$Text) { Write-Host ''; Write-Host "=== $Text ===" -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host "[ OK ] $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "[WARN] $Text" -ForegroundColor Yellow }
function Write-Fail([string]$Text) { Write-Host "[FAIL] $Text" -ForegroundColor Red }
function Write-Info([string]$Text) { Write-Host "       $Text" }

function Wait-Close { Write-Host ''; Read-Host 'Press Enter to close this window' | Out-Null }

# Returns the PostgreSQL "bin" folder that holds postgres.exe, or $null.
function Get-PgBin {
    $candidates = @(
        'C:\Program Files\PostgreSQL\16\bin',
        'C:\pgsql\node_modules\@embedded-postgres\windows-x64\native\bin',
        (Join-Path $env:USERPROFILE 'pgsql-local\node_modules\@embedded-postgres\windows-x64\native\bin')
    )
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c 'postgres.exe')) { return $c }
    }
    return $null
}

# Asks for a secret without showing it on screen.
function Read-Secret([string]$Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# Returns $null if the password is acceptable, otherwise the reason it is not.
function Test-PasswordRule([string]$Password) {
    if ($Password.Length -lt 8) { return 'The password must be at least 8 characters.' }
    if ($Password -match '["\r\n]') { return 'The password must not contain double quotes or line breaks.' }
    return $null
}

function Get-EnvValue([string]$Key) {
    if (-not (Test-Path $EnvFile)) { return $null }
    $line = Get-Content $EnvFile | Where-Object { $_ -match "^\s*$Key\s*=" } | Select-Object -First 1
    if ($line) { return ($line -split '=', 2)[1].Trim().Trim('"') }
    return $null
}

function Test-Port([int]$Port) {
    return [bool](Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue)
}

# Runs node in the server folder and returns its exit code.
function Invoke-Node([string[]]$Arguments) {
    Push-Location $Server
    try { & node @Arguments | Out-Host; return [int]$LASTEXITCODE }
    finally { Pop-Location }
}

# Returns the path of pg_dump.exe from any PostgreSQL install under Program Files, or $null.
function Get-PgDump {
    $dumps = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'bin\pg_dump.exe' } |
        Where-Object { Test-Path $_ }
    return ($dumps | Select-Object -First 1)
}
