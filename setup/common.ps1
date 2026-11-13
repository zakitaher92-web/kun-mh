# Shared helpers for the setup steps. Each step script loads this file first.
# Written for Windows PowerShell 5.1 (the version on Windows Server 2016). Keep this file ASCII only.
$ErrorActionPreference = 'Stop'
$SetupDir = $PSScriptRoot
$Root     = Split-Path -Parent $SetupDir          # the kun-mh folder
$Server   = Join-Path $Root 'server'
$EnvFile  = Join-Path $Server '.env'
$LogFile  = Join-Path $Root 'logs\server.log'
$TaskName = 'KUN-MH Server'                       # scheduled task that runs the app (step 6)
$SiteName = 'KUN-MH'                              # IIS website that users open (step 7)

# Ports. These must not be the ports used by other applications on the server.
# Ports used on the server by other applications (KUN MH never uses them):
#   3000 (Billing app), 80 and 443 (Billing IIS site), and the IIS site "Default Web Site" (NKERP).
$DefaultAppPort   = 3100    # the KUN Node app, private to this server (127.0.0.1)
$DefaultHttpPort  = 8080    # IIS, office users (HTTP, redirects to HTTPS when a certificate is used)
$DefaultHttpsPort = 8443    # IIS, office users (HTTPS)
# The shared PostgreSQL 18 cluster (service postgresql-x64-18). KUN MH uses its own database and role in it.
# The Billing app uses the same cluster. KUN MH never edits the cluster's configuration.
$DefaultPgPort    = 5432
$PgService        = 'postgresql-x64-18'
$PgSuperUser      = 'postgres'        # superuser of the cluster (asked in step 3, never stored)
$PgRole           = 'kunmh'           # login role of the app
$PgDatabase       = 'kun_mh'          # database of the app
$AppTimezone      = 'Asia/Baghdad'    # time zone for business dates (server, database and settings)
$ReservedPorts    = @(80, 443, 3000)  # never used by KUN MH

$TaskAccount      = 'kunapp'          # local account (not an administrator) that runs the app and backup tasks; not SYSTEM
$LogDir           = Join-Path $Root 'logs'
$BackupTaskName   = 'KUN-MH Backup'   # nightly pg_dump (step 8, -Register)
$BackupDir        = 'C:\KUN\backups'
$BackupKeepDays   = 14                # nightly backups older than this are deleted
$IisAppPool       = 'KUN-MH'          # IIS application pool of the KUN MH website (no .NET)

# Returns a random password of letters and digits that has upper case, lower case and a digit.
function New-RandomPassword([int]$Length = 24) {
    $chars = ([char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789')
    do {
        $bytes = New-Object byte[] $Length
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $pw = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
    } until ($pw -cmatch '[A-Z]' -and $pw -cmatch '[a-z]' -and $pw -match '[0-9]')
    return $pw
}

# Returns $true if a TCP connection to Address:Port succeeds within the timeout (in milliseconds).
function Test-TcpPort([string]$Address, [int]$Port, [int]$TimeoutMs = 2000) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $wait = $client.BeginConnect($Address, $Port, $null, $null)
        if (-not $wait.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return $false }
        $client.EndConnect($wait)
        return $client.Connected
    } catch { return $false }
    finally { $client.Close() }
}

# Throws if a port is one that other applications on this server use.
function Assert-NotReserved([int]$Port, [string]$What) {
    if ($ReservedPorts -contains $Port) { throw "$What cannot use port $Port, because other applications on this server use it. Choose another port." }
}

function Write-Step([string]$Text) { Write-Host ''; Write-Host "=== $Text ===" -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host "[ OK ] $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "[WARN] $Text" -ForegroundColor Yellow }
function Write-Fail([string]$Text) { Write-Host "[FAIL] $Text" -ForegroundColor Red }
function Write-Info([string]$Text) { Write-Host "       $Text" }

function Wait-Close { Write-Host ''; Read-Host 'Press Enter to close this window' | Out-Null }

# Throws unless the script runs as administrator.
function Assert-Admin {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This step must run as administrator. Right-click the .bat file and choose "Run as administrator".'
    }
}

# Returns the path of node.exe, or $null.
function Get-NodeExe {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $default = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path $default) { return $default }
    return $null
}

# Returns the PostgreSQL "bin" folder that holds postgres.exe, or $null.
function Get-PgBin {
    # 1. An explicit folder given by the installer (KUN_PG_BIN), 2. the standard installs, newest version first
    $installed = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Name -replace '\D', '0') } -Descending |
        ForEach-Object { Join-Path $_.FullName 'bin' }
    $candidates = @(
        $env:KUN_PG_BIN,
        'C:\Program Files\PostgreSQL\18\bin'
    ) + @($installed) + @(
        'C:\pgsql\node_modules\@embedded-postgres\windows-x64\native\bin',
        (Join-Path $env:USERPROFILE 'pgsql-local\node_modules\@embedded-postgres\windows-x64\native\bin')
    )
    foreach ($c in @($candidates | Where-Object { $_ })) {
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

# The app port from server\.env (PORT), or the default.
function Get-AppPort {
    $value = Get-EnvValue 'PORT'
    if ($value) { return [int]$value }
    return $DefaultAppPort
}

# The PostgreSQL port from server\.env (DB_PORT), or the default.
function Get-DbPort {
    $value = Get-EnvValue 'DB_PORT'
    if ($value) { return [int]$value }
    return $DefaultPgPort
}

# Returns the HTTP status code for a URL, or 0 if there was no answer at all.
# Redirects are NOT followed: a 301 means the site redirects (for example HTTP to HTTPS), and the caller decides what that means.
function Get-HttpStatus([string]$Url) {
    $request = [Net.HttpWebRequest]::Create($Url)
    $request.AllowAutoRedirect = $false
    $request.Timeout = 15000
    try {
        $response = $request.GetResponse()
        $code = [int]$response.StatusCode
        $response.Close()
        return $code
    } catch [Net.WebException] {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return 0
    }
}

# Returns this server's LAN IPv4 address (for the address other computers type), or $null.
function Get-LanAddress {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -First 1
    if ($ip) { return $ip.IPAddress }
    return $null
}

# Stops the app: first the scheduled task (so Windows does not restart it), then any node process still listening.
function Stop-KunApp([int]$Port = $DefaultAppPort) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    }
    $owners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $owners) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq 'node') {
            Stop-Process -Id $procId -Force
            Write-Info "Stopped the server process $procId"
        }
    }
    for ($i = 0; $i -lt 15 -and (Test-Port $Port); $i++) { Start-Sleep -Seconds 1 }
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

# Creates the local task account if needed and sets a new random password. Returns the password.
# The password is not stored anywhere by this script: Windows keeps it for the scheduled tasks.
function Set-TaskAccount {
    $pw = New-RandomPassword 24
    $secure = ConvertTo-SecureString $pw -AsPlainText -Force
    if (Get-LocalUser -Name $TaskAccount -ErrorAction SilentlyContinue) {
        Set-LocalUser -Name $TaskAccount -Password $secure
    } else {
        New-LocalUser -Name $TaskAccount -Password $secure -PasswordNeverExpires -UserMayNotChangePassword `
            -Description 'Runs the KUN MH app and backup tasks (not an administrator)' | Out-Null
    }
    return $pw
}

# Gives the task account what it needs: read the release, write the logs and the backups, nothing more.
function Grant-TaskAccount {
    New-Item -ItemType Directory -Force -Path $LogDir, $BackupDir | Out-Null
    & icacls.exe $Root /grant "${TaskAccount}:(OI)(CI)RX" | Out-Null
    & icacls.exe $LogDir /grant "${TaskAccount}:(OI)(CI)M" | Out-Null
    & icacls.exe $BackupDir /grant "${TaskAccount}:(OI)(CI)M" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not set the permissions for $TaskAccount." }
}

# Registers the app task (starts with Windows, runs the app as the task account, not as SYSTEM).
function Register-AppTask([string]$Password) {
    $wrapper = Join-Path $SetupDir 'run-server.cmd'
    $action    = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c "' + $wrapper + '"') -WorkingDirectory $Server
    $trigger   = New-ScheduledTaskTrigger -AtStartup
    $trigger.Delay = 'PT60S'                 # give PostgreSQL time to start first
    $settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
                    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
                    -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
        -User "$env:COMPUTERNAME\$TaskAccount" -Password $Password -RunLevel Limited -Force | Out-Null
}

# Registers the nightly backup task (02:00 every day, as the task account, output to logs\backup.log).
function Register-BackupTask([string]$Password) {
    $backupScript = Join-Path $SetupDir '8-backup.ps1'
    $log = Join-Path $LogDir 'backup.log'
    $action    = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c powershell -NoProfile -ExecutionPolicy Bypass -File "' + $backupScript + '" -Scheduled >> "' + $log + '" 2>&1') -WorkingDirectory $Server
    $trigger   = New-ScheduledTaskTrigger -Daily -At '02:00'
    $settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $BackupTaskName -Action $action -Trigger $trigger -Settings $settings `
        -User "$env:COMPUTERNAME\$TaskAccount" -Password $Password -RunLevel Limited -Force | Out-Null
}
