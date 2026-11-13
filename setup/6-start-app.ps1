# Step 6: runs the app in the background as a Windows scheduled task.
# The task starts when the server starts (after a restart, too), restarts the app if it stops,
# and needs no open window. It runs as the local account kunapp (not an administrator, not SYSTEM).
# The output goes to logs\server.log (see run-server.cmd for the rotation).
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 6 of 8: running the app in the background'
try {
    Assert-Admin
    if (-not (Test-Path $EnvFile)) { throw 'Run step 4 first (the settings file is missing).' }
    if (-not (Get-NodeExe)) { throw 'Node.js was not found. Install it (INSTALLATION_GUIDE.md, Part 1a) and run this step again.' }
    if (-not (Test-Path (Join-Path $Server 'node_modules\pg'))) { throw 'Run step 2 first (the server packages are not installed).' }

    $port = Get-AppPort

    # The task account: created or given a new password; it gets only the rights it needs.
    $pw = Set-TaskAccount
    Grant-TaskAccount
    Write-Ok "Task account $TaskAccount is ready (not an administrator; it reads the app and writes logs and backups)."

    # Replace any copy that is already running (a window or an earlier task).
    Stop-KunApp -Port $port

    Register-AppTask -Password $pw
    Write-Ok "Task '$TaskName' is registered to run as $TaskAccount. It starts with Windows and restarts the app if it stops."
    Write-Info 'Windows keeps the task password. The step 8 backup task uses the same account (step 8 with -Register).'

    Start-ScheduledTask -TaskName $TaskName
    Write-Info 'Waiting for the server to start...'
    for ($i = 0; $i -lt 60 -and -not (Test-Port $port); $i++) { Start-Sleep -Seconds 1 }

    if (Test-Port $port) {
        Write-Ok "The app is running on this server (port $port, private to this server)."
        Write-Info 'Next: run 7-setup-iis.bat, so that other computers can open the app.'
    } else {
        Write-Fail 'The app did not start yet. The last lines of the server log are shown below. The task keeps retrying every minute.'
        if (Test-Path $LogFile) { Get-Content $LogFile -Tail 15 | ForEach-Object { Write-Info $_ } }
        Write-Info "Full log: $LogFile"
    }
} catch {
    Write-Fail $_.Exception.Message
}
Wait-Close
