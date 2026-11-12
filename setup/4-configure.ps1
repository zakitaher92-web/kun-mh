# Step 4: writes server\.env and tests the connection to the database.
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 4 of 8: saving the settings and testing the database'
try {
    if (-not (Test-Path (Join-Path $Server 'node_modules\pg'))) { throw 'Run step 2 first (the server packages are not installed).' }
    if (Test-Path $EnvFile) {
        Copy-Item $EnvFile "$EnvFile.bak" -Force
        Write-Info 'An existing settings file was saved as server\.env.bak'
    }

    $app = if ($env:KUNMH_PASSWORD) { $env:KUNMH_PASSWORD } else { Read-Secret 'Password for the kunmh user (from step 3)' }
    $rule = Test-PasswordRule $app
    if ($rule) { throw $rule }

    # Ports: an earlier choice in server\.env is kept. Ports used by other applications are refused.
    $appPort = if ($env:KUN_APP_PORT) { [int]$env:KUN_APP_PORT } else { Get-AppPort }
    $dbPort  = if ($env:KUN_PG_PORT)  { [int]$env:KUN_PG_PORT }  else { Get-DbPort }
    Assert-NotReserved $appPort 'The app'
    Assert-NotReserved $dbPort 'The KUN MH database'
    if ($appPort -eq $dbPort) { throw 'The app port and the PostgreSQL port must be different.' }

    $lines = @(
        '# The app listens on this server only. Other computers reach it through IIS (step 7).',
        "PORT=$appPort",
        'HOST=127.0.0.1',
        '',
        'DB_HOST=127.0.0.1',
        "DB_PORT=$dbPort",
        'DB_NAME=kun_mh',
        'DB_USER=kunmh',
        "DB_PASSWORD=""$app"""
    )
    [IO.File]::WriteAllLines($EnvFile, $lines, (New-Object Text.UTF8Encoding $false))
    Write-Ok 'Settings saved to server\.env'

    Write-Info 'Testing the connection (this also creates the tables the first time)...'
    $code = Invoke-Node @('--env-file-if-exists=.env', 'src/manage.js', 'list')
    if ($code -ne 0) { throw 'Could not connect to the database. Check the kunmh password and that PostgreSQL is running.' }
    Write-Ok 'Connected to the database. Next: run 5-create-admin.bat'
    Write-Info 'Keep HOST=127.0.0.1 in server\.env. IIS (step 7) is the only door for other computers.'
} catch {
    Write-Fail $_.Exception.Message
}
Wait-Close
