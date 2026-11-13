# Step 4: writes server\.env and tests the connection to the database.
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 4 of 8: saving the settings and testing the database'
try {
    if (-not (Test-Path (Join-Path $Server 'node_modules\pg'))) { throw 'Run step 2 first (the server packages are not installed).' }

    # Keep the COOKIE_SECURE line of the previous settings (set after HTTPS works, Part 8).
    $cookieLine = $null
    if (Test-Path $EnvFile) {
        $cookieLine = Get-Content $EnvFile | Where-Object { $_ -match '^\s*COOKIE_SECURE\s*=' } | Select-Object -First 1
        Copy-Item $EnvFile "$EnvFile.bak" -Force
        Write-Info 'The previous settings file was saved as server\.env.bak'
    }

    $app = if ($env:KUNMH_PASSWORD) { $env:KUNMH_PASSWORD } else { Read-Secret 'Password for the kunmh user (from step 3)' }
    $rule = Test-PasswordRule $app
    if ($rule) { throw $rule }

    # Defaults: the shared PostgreSQL 18 cluster on 127.0.0.1:5432, database kun_mh, user kunmh.
    $appPort = if ($env:KUN_APP_PORT) { [int]$env:KUN_APP_PORT } else { $DefaultAppPort }
    $dbPort  = if ($env:KUN_PG_PORT)  { [int]$env:KUN_PG_PORT }  else { $DefaultPgPort }
    Assert-NotReserved $appPort 'The app'
    if ($appPort -eq $dbPort) { throw 'The app port and the PostgreSQL port must be different.' }

    $lines = @(
        '# The app listens on this server only. Other computers reach it through IIS (step 7).',
        "PORT=$appPort",
        'HOST=127.0.0.1',
        '',
        '# The shared PostgreSQL 18 cluster (service postgresql-x64-18). Database kun_mh, user kunmh.',
        'DB_HOST=127.0.0.1',
        "DB_PORT=$dbPort",
        "DB_NAME=$PgDatabase",
        "DB_USER=$PgRole",
        "DB_PASSWORD=""$app""",
        '',
        '# Business dates and "today" use this time zone. It is read before any date is made.',
        "TZ=$AppTimezone"
    )
    if ($cookieLine) {
        $lines += @('', '# Kept from the previous settings (set after HTTPS works, Part 8).', $cookieLine)
    }
    [IO.File]::WriteAllLines($EnvFile, $lines, (New-Object Text.UTF8Encoding $false))
    Write-Ok 'Settings saved to server\.env'
    if ($cookieLine) { Write-Info 'COOKIE_SECURE was kept from the previous settings.' }

    Write-Info 'Testing the connection (this also creates the tables the first time)...'
    $code = Invoke-Node @('--env-file-if-exists=.env', 'src/manage.js', 'list')
    if ($code -ne 0) { throw 'Could not connect to the database. Check the kunmh password, that the service postgresql-x64-18 is running, and that pg_hba.conf allows kunmh (step 3 prints the line).' }
    Write-Ok 'Connected to the database. Next: run 5-create-admin.bat'
    Write-Info 'Keep HOST=127.0.0.1 in server\.env. IIS (step 7) is the only door for other computers.'
} catch {
    Write-Fail $_.Exception.Message
}
Wait-Close
