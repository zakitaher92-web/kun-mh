# Step 8: nightly backup of the KUN MH database (pg_dump -Fc, custom format) into C:\KUN\backups.
#   8-backup.bat -Register   creates the nightly task "KUN-MH Backup" (02:00, as the account kunapp),
#                            and the app task is registered again with the same account password.
#   8-backup.bat             runs one backup now (by hand).
# Each run keeps the new file and deletes kun_mh_*.dump files older than 14 days.
# Restore: see INSTALLATION_GUIDE.md, Part 7.
param([switch]$Register, [switch]$Scheduled)
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 8 of 8: backing up the database'

function Wait-IfInteractive { if (-not $Scheduled) { Wait-Close } }

try {
    if ($Register) {
        Assert-Admin
        if (-not (Test-Path $EnvFile)) { throw 'Run step 4 first (the settings file is missing).' }
        if (-not (Get-Service -Name $PgService -ErrorAction SilentlyContinue)) { throw "The service $PgService was not found." }
        # One new password for the account, used by both tasks. The app task is registered again with it.
        $pw = Set-TaskAccount
        Grant-TaskAccount
        Register-AppTask -Password $pw
        Register-BackupTask -Password $pw
        Write-Ok "Task '$BackupTaskName' runs every night at 02:00 as $TaskAccount, output to logs\backup.log."
        Write-Ok "Task '$TaskName' was registered again with the same account."
        Write-Info 'Run a backup now to test it: 8-backup.bat (without -Register).'
    } else {
        if (-not (Test-Path $EnvFile)) { throw 'Run step 4 first (the settings file is missing).' }
        $pgdump = Get-PgDump
        if (-not $pgdump) {
            throw 'pg_dump.exe was not found (it comes with PostgreSQL 18, Command Line Tools). Use the app instead: Admin > Data > Download backup.'
        }
        Write-Info "Using $pgdump"
        New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
        $file = Join-Path $BackupDir ('kun_mh_' + (Get-Date -Format 'yyyy-MM-dd_HHmm') + '.dump')
        $env:PGPASSWORD = Get-EnvValue 'DB_PASSWORD'
        try {
            & $pgdump -h (Get-EnvValue 'DB_HOST') -p (Get-EnvValue 'DB_PORT') -U (Get-EnvValue 'DB_USER') -d (Get-EnvValue 'DB_NAME') -Fc -f $file
            if ($LASTEXITCODE -ne 0) { throw 'The backup did not finish. Check the messages above.' }
        } finally {
            Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        }
        $kb = [math]::Round((Get-Item $file).Length / 1KB)
        Write-Ok "Backup saved: $file ($kb KB)"

        $old = @(Get-ChildItem $BackupDir -Filter 'kun_mh_*.dump' -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$BackupKeepDays) })
        $old | Remove-Item -Force
        Write-Info "Older backups removed: $($old.Count) (kept: $BackupKeepDays days)."
        Write-Info 'Copy the backup to another drive or computer as well.'
    }
} catch {
    Write-Fail $_.Exception.Message
}
Wait-IfInteractive
