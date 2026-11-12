# Step 3: creates the KUN MH PostgreSQL cluster (if it does not exist yet), then the database "kun_mh"
# and the user "kunmh". The cluster is separate from the Billing app's PostgreSQL (port 5432).
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 3 of 8: creating the KUN MH database cluster, the database and the app database user'

# Creates the Windows account that runs the database. Returns its new password (the password is not stored anywhere else).
function Set-PgOwnerAccount {
    $pw = New-RandomPassword 24
    $secure = ConvertTo-SecureString $pw -AsPlainText -Force
    if (Get-LocalUser -Name $PgOwnerUser -ErrorAction SilentlyContinue) {
        Set-LocalUser -Name $PgOwnerUser -Password $secure
    } else {
        New-LocalUser -Name $PgOwnerUser -Password $secure -PasswordNeverExpires -UserMayNotChangePassword `
            -Description 'Runs the KUN MH PostgreSQL service' | Out-Null
    }
    return $pw
}

# Registers the Windows service for the cluster (running as the owner account) and starts it.
function Register-PgService([string]$Bin, [int]$Port, [string]$OwnerPw) {
    $account = "$env:COMPUTERNAME\$PgOwnerUser"
    & (Join-Path $Bin 'pg_ctl.exe') register -N $PgService -D $PgDataDir -S auto -o "-p $Port" -U $account -P $OwnerPw | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "The service $PgService could not be registered (pg_ctl exit code $LASTEXITCODE)." }
    Start-Service -Name $PgService
    for ($i = 0; $i -lt 30 -and -not (Test-Port $Port); $i++) { Start-Sleep -Seconds 1 }
    if (-not (Test-Port $Port)) {
        throw "The service $PgService did not start. If Windows says the account may not log on as a service, grant 'Log on as a service' to $account in secpol.msc (Local Policies > User Rights Assignment), then run this step again."
    }
    Set-Service -Name $PgService -StartupType Automatic
    Write-Ok "Service $PgService is running on port $Port (starts with Windows)"
}

# Creates the cluster files in $PgDataDir as the owner account (initdb does not run as administrator).
function Initialize-PgCluster([string]$Bin, [string]$SuperPw, [string]$OwnerPw) {
    $parent = Split-Path $PgDataDir
    New-Item -ItemType Directory -Force -Path $PgDataDir | Out-Null
    & icacls.exe $PgDataDir /grant "${PgOwnerUser}:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not give $PgOwnerUser access to $PgDataDir." }

    $pwFile = Join-Path $parent 'kun-initdb-pw.tmp'
    [IO.File]::WriteAllText($pwFile, $SuperPw, (New-Object Text.UTF8Encoding $false))
    try {
        & icacls.exe $pwFile /grant "${PgOwnerUser}:R" | Out-Null
        $cred = New-Object Management.Automation.PSCredential ("$env:COMPUTERNAME\$PgOwnerUser", (ConvertTo-SecureString $OwnerPw -AsPlainText -Force))
        $initArgs = @('-D', $PgDataDir, '-U', 'postgres', '-A', 'scram-sha-256', '-E', 'UTF8', "--pwfile=$pwFile")
        Write-Info 'Creating the database files (this takes a minute)...'
        $proc = Start-Process -FilePath (Join-Path $Bin 'initdb.exe') -ArgumentList $initArgs -Credential $cred `
                    -WorkingDirectory $parent -Wait -PassThru -WindowStyle Hidden
        if ($proc.ExitCode -ne 0 -or -not (Test-Path (Join-Path $PgDataDir 'PG_VERSION'))) {
            throw "The database files could not be created (initdb exit code $($proc.ExitCode)). Remove $PgDataDir and run this step again."
        }
    } finally {
        Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
    }
    Write-Ok "KUN MH database files created in $PgDataDir"
}

# Asks for a new password twice (or takes it from KUN_PG_SUPERUSER_PASSWORD).
function Read-NewSuperPassword {
    if ($env:KUN_PG_SUPERUSER_PASSWORD) { return $env:KUN_PG_SUPERUSER_PASSWORD }
    Write-Info 'Choose a password for the PostgreSQL "postgres" user of the KUN MH database. It must be different from the Billing app''s password. Write it down.'
    while ($true) {
        $p1 = Read-Secret 'New password for postgres (KUN MH)'
        $rule = Test-PasswordRule $p1
        if ($rule) { Write-Warn $rule; continue }
        $p2 = Read-Secret 'Type it again'
        if ($p1 -ne $p2) { Write-Warn 'The two passwords do not match. Try again.'; continue }
        return $p1
    }
}

try {
    Assert-Admin
    if (-not (Test-Path (Join-Path $Server 'node_modules\pg'))) { throw 'Run step 2 first (the server packages are not installed).' }
    $dbPort = if ($env:KUN_PG_PORT) { [int]$env:KUN_PG_PORT } else { Get-DbPort }
    Assert-NotReserved $dbPort 'The KUN MH database'
    $bin = Get-PgBin
    if (-not $bin -or -not (Test-Path (Join-Path $bin 'initdb.exe'))) {
        throw 'The PostgreSQL 16 programs were not found (C:\Program Files\PostgreSQL\16\bin). Install PostgreSQL 16 with the Command Line Tools first.'
    }

    # 1. The KUN MH cluster: create it if needed (service postgresql-kun-16 on port 5433)
    $service = Get-Service -Name $PgService -ErrorAction SilentlyContinue
    $hasData = Test-Path (Join-Path $PgDataDir 'PG_VERSION')
    $superPw = $null
    if ($service -and -not (Test-Port $dbPort)) {
        Write-Info "Starting the existing service $PgService..."
        Start-Service -Name $PgService
        for ($i = 0; $i -lt 30 -and -not (Test-Port $dbPort); $i++) { Start-Sleep -Seconds 1 }
    }
    if ($service -and (Test-Port $dbPort)) {
        Write-Ok "The KUN MH database service $PgService is running on port $dbPort"
        $superPw = if ($env:KUN_PG_SUPERUSER_PASSWORD) { $env:KUN_PG_SUPERUSER_PASSWORD } else {
            Write-Info "Type the password of the PostgreSQL ""postgres"" user of the KUN MH database (set in step 3 before)."
            Read-Secret 'postgres password (KUN MH)'
        }
    } elseif (Test-Port $dbPort) {
        throw "Port $dbPort is used by another database on this server. Choose another port for KUN MH (KUN_PG_PORT), never 5432."
    } else {
        Write-Info "Creating the KUN MH database cluster: service $PgService, port $dbPort, data in $PgDataDir"
        $ownerPw = Set-PgOwnerAccount
        if (-not $hasData) {
            $superPw = Read-NewSuperPassword
            Initialize-PgCluster -Bin $bin -SuperPw $superPw -OwnerPw $ownerPw
        } else {
            Write-Info 'The database files already exist. Only the service is registered.'
            & icacls.exe $PgDataDir /grant "${PgOwnerUser}:(OI)(CI)F" | Out-Null
            $superPw = if ($env:KUN_PG_SUPERUSER_PASSWORD) { $env:KUN_PG_SUPERUSER_PASSWORD } else { Read-Secret 'postgres password (KUN MH, existing)' }
        }
        Register-PgService -Bin $bin -Port $dbPort -OwnerPw $ownerPw
    }

    # 2. The app database and user (safe to run again)
    Write-Info 'Type a password for the app database user "kunmh". Write it down; step 4 asks for it again.'
    while ($true) {
        $app = if ($env:KUNMH_PASSWORD) { $env:KUNMH_PASSWORD } else { Read-Secret 'New password for kunmh' }
        $rule = Test-PasswordRule $app
        if ($rule) { Write-Warn $rule; if ($env:KUNMH_PASSWORD) { throw $rule }; continue }
        $again = if ($env:KUNMH_PASSWORD) { $app } else { Read-Secret 'Type it again' }
        if ($again -ne $app) { Write-Warn 'The two passwords do not match. Try again.'; continue }
        break
    }

    $env:PG_SUPERUSER_PASSWORD = $superPw
    $env:KUNMH_PASSWORD = $app
    $env:PG_PORT = [string]$dbPort
    try {
        $code = Invoke-Node @('src/create-database.js')
    } finally {
        Remove-Item Env:PG_SUPERUSER_PASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:KUNMH_PASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:PG_PORT -ErrorAction SilentlyContinue
    }
    if ($code -ne 0) { throw 'The database could not be created. Check the password for "postgres" and the messages above.' }
    Write-Ok 'Database ready. Next: run 4-configure.bat'
} catch {
    Write-Fail $_.Exception.Message
}
Wait-Close
