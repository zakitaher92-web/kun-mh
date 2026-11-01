# Step 6: starts the app server in its own window and opens the app in the browser.
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 6 of 7: starting the app'
try {
    if (-not (Test-Path $EnvFile)) { throw 'Run step 4 first (the settings file is missing).' }
    $port = [int](Get-EnvValue 'PORT')
    if (-not $port) { $port = 3000 }
    if (Test-Port $port) {
        Write-Warn "Port $port is already in use, so the app is probably running already."
        Write-Info "Open http://localhost:$port in the browser. To restart, close the server window first."
    } else {
        Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'npm start' -WorkingDirectory $Server
        Write-Info 'A new window has opened with the server. Keep that window open while the app is in use.'
        for ($i = 0; $i -lt 40 -and -not (Test-Port $port); $i++) { Start-Sleep -Seconds 1 }
        if (Test-Port $port) {
            Write-Ok "The app is running at http://localhost:$port"
            Start-Process "http://localhost:$port"
            Write-Info 'Next: log in with the first account and choose the example data or start empty.'
        } else {
            Write-Fail 'The app did not start. Read the new server window for the error message.'
        }
    }
} catch {
    Write-Fail $_.Exception.Message
}
Wait-Close
