# Step 7: saves a copy of the database to C:\KUN\backups (run it weekly).
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 7 of 7: backing up the database'
try {
    if (-not (Test-Path $EnvFile)) { throw 'Run step 4 first (the settings file is missing).' }
    $pgdump = Get-PgDump
    if (-not $pgdump) {
        throw 'pg_dump.exe was not found (it comes with the PostgreSQL installer, Command Line Tools). Use the app instead: Admin > Data > Download backup.'
    }
    Write-Info "Using $pgdump"
    $dir = 'C:\KUN\backups'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $file = Join-Path $dir ('kun_mh_' + (Get-Date -Format 'yyyy-MM-dd_HHmm') + '.sql')
    $env:PGPASSWORD = Get-EnvValue 'DB_PASSWORD'
    try {
        & $pgdump -h (Get-EnvValue 'DB_HOST') -p (Get-EnvValue 'DB_PORT') -U (Get-EnvValue 'DB_USER') -d (Get-EnvValue 'DB_NAME') -f $file
        if ($LASTEXITCODE -ne 0) { throw 'The backup did not finish. Check the messages above.' }
    } finally {
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
    $kb = [math]::Round((Get-Item $file).Length / 1KB)
    Write-Ok "Backup saved: $file ($kb KB)"
    Write-Info 'Copy the backup to another drive or computer as well.'
} catch {
    Write-Fail $_.Exception.Message
}
Wait-Close
