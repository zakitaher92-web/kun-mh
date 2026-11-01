# Step 3: creates the database "kun_mh" and the user "kunmh" in PostgreSQL.
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 3 of 7: creating the database and the app database user'
try {
    if (-not (Test-Port 5432)) { throw 'PostgreSQL is not running on port 5432. Run step 1 for help.' }
    if (-not (Test-Path (Join-Path $Server 'node_modules\pg'))) { throw 'Run step 2 first (the server packages are not installed).' }

    Write-Info 'Type the password of the PostgreSQL "postgres" user (the one you set when you installed PostgreSQL).'
    $super = if ($env:KUN_PG_SUPERUSER_PASSWORD) { $env:KUN_PG_SUPERUSER_PASSWORD } else { Read-Secret 'postgres password' }

    Write-Info 'Now choose a password for the app database user "kunmh". Write it down; step 4 asks for it again.'
    while ($true) {
        $app = if ($env:KUNMH_PASSWORD) { $env:KUNMH_PASSWORD } else { Read-Secret 'New password for kunmh' }
        $rule = Test-PasswordRule $app
        if ($rule) { Write-Warn $rule; if ($env:KUNMH_PASSWORD) { throw $rule }; continue }
        $again = if ($env:KUNMH_PASSWORD) { $app } else { Read-Secret 'Type it again' }
        if ($again -ne $app) { Write-Warn 'The two passwords do not match. Try again.'; continue }
        break
    }

    $env:PG_SUPERUSER_PASSWORD = $super
    $env:KUNMH_PASSWORD = $app
    try {
        $code = Invoke-Node @('src/create-database.js')
    } finally {
        Remove-Item Env:PG_SUPERUSER_PASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:KUNMH_PASSWORD -ErrorAction SilentlyContinue
    }
    if ($code -ne 0) { throw 'The database could not be created. Check the password for "postgres" and the messages above.' }
    Write-Ok 'Database ready. Next: run 4-configure.bat'
} catch {
    Write-Fail $_.Exception.Message
}
Wait-Close
