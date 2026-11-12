# Stops the app: the scheduled task and the server process. IIS keeps running and shows an error page until the app is started again.
. "$PSScriptRoot\common.ps1"
Write-Step 'Stopping the app'
try {
    Assert-Admin
    $port = Get-AppPort
    Stop-KunApp -Port $port
    if (Test-Port $port) { Write-Fail "The app is still running on port $port. Restart this computer, or stop the node.exe process in Task Manager." }
    else { Write-Ok 'The app is stopped. Start it again with 6-start-app.bat.' }
} catch {
    Write-Fail $_.Exception.Message
}
Wait-Close
