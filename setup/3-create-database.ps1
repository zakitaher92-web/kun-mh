# Step 3: creates the KUN MH login role "kunmh" and the database "kun_mh" on the shared PostgreSQL 18 cluster
# (service postgresql-x64-18, port 5432). It does not create a cluster, does not edit postgresql.conf or
# pg_hba.conf, and does not touch any other database. Safe to run again.
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 3 of 8: creating the KUN MH role and database on the PostgreSQL 18 cluster'

# Asks for a new password twice (or takes it from the environment variable named in $Env).
function Read-NewPassword([string]$Prompt, [string]$EnvName) {
    $fromEnv = [Environment]::GetEnvironmentVariable($EnvName)
    if ($fromEnv) { return $fromEnv }
    while ($true) {
        $p1 = Read-Secret $Prompt
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

    # The shared cluster must already be installed and running.
    $service = Get-Service -Name $PgService -ErrorAction SilentlyContinue
    if (-not $service) {
        throw "The PostgreSQL service $PgService was not found. Install PostgreSQL 18 with its default service name (INSTALLATION_GUIDE.md, Part 1b), then run this step again."
    }
    if ($service.Status -ne 'Running') {
        throw "The service $PgService is not running. Start it in services.msc, then run this step again."
    }
    $port = if ($env:KUN_PG_PORT) { [int]$env:KUN_PG_PORT } else { $DefaultPgPort }
    if (-not (Test-Port $port)) { throw "Nothing answers on port $port (127.0.0.1). Check the service $PgService." }
    Write-Ok "PostgreSQL service $PgService is running on port $port"
    Write-Warn "Stopping the service $PgService stops EVERY application that uses this PostgreSQL cluster, including the Billing app."

    Write-Info 'The postgres user is the superuser of the shared cluster. Its password is not stored by this step.'
    $superPw = if ($env:KUN_PG_SUPERUSER_PASSWORD) { $env:KUN_PG_SUPERUSER_PASSWORD } else { Read-Secret 'Password of the PostgreSQL "postgres" user' }

    Write-Info 'Type a password for the app database user "kunmh". Write it down; step 4 asks for it again.'
    $app = Read-NewPassword 'New password for kunmh' 'KUNMH_PASSWORD'
    $rule = Test-PasswordRule $app
    if ($rule) { throw $rule }

    $env:PG_SUPERUSER_PASSWORD = $superPw
    $env:KUNMH_PASSWORD = $app
    $env:PG_PORT = [string]$port
    try {
        $code = Invoke-Node @('src/create-database.js')
    } finally {
        Remove-Item Env:PG_SUPERUSER_PASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:KUNMH_PASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:PG_PORT -ErrorAction SilentlyContinue
    }
    if ($code -ne 0) { throw 'The role or database could not be created. The messages above say why. A pg_hba.conf line, if printed, is only a suggestion: it is not applied.' }
    Write-Ok 'Role kunmh and database kun_mh are ready. Next: run 4-configure.bat'
} catch {
    Write-Fail $_.Exception.Message
}
Wait-Close
