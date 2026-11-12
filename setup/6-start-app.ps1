# Step 6: runs the app in the background as a Windows scheduled task.
# The task starts when the server starts (after a restart, too), restarts the app if it stops,
# and needs no open window. The output goes to logs\server.log.
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 6 of 8: running the app in the background'
try {
    Assert-Admin
    if (-not (Test-Path $EnvFile)) { throw 'Run step 4 first (the settings file is missing).' }
    if (-not (Get-NodeExe)) { throw 'Node.js was not found. Install it (INSTALLATION_GUIDE.md, Part 1) and run this step again.' }
    if (-not (Test-Path (Join-Path $Server 'node_modules\pg'))) { throw 'Run step 2 first (the server packages are not installed).' }

    $port = Get-AppPort
    $wrapper = Join-Path $SetupDir 'run-server.cmd'
    New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null

    # Replace any copy that is already running (a window or an earlier task).
    Stop-KunApp -Port $port

    $action    = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c "' + $wrapper + '"') -WorkingDirectory $Server
    $trigger   = New-ScheduledTaskTrigger -AtStartup
    $trigger.Delay = 'PT60S'                 # give PostgreSQL time to start first
    $settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
                    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
                    -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Ok "Task '$TaskName' is registered. It starts with Windows and restarts the app if it stops."

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
