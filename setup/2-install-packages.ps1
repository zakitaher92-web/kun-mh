# Step 2: downloads the packages the server needs (one time).
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 2 of 8: installing the server packages'
try {
    Push-Location $Server
    try { & npm install; if ($LASTEXITCODE -ne 0) { throw 'npm install did not finish. Check your internet connection and try again.' } }
    finally { Pop-Location }
    if (Test-Path (Join-Path $Server 'node_modules\pg')) {
        Write-Ok 'Server packages installed. Next: run 3-create-database.bat'
    } else { throw 'The packages were not installed. Run this step again.' }
} catch {
    Write-Fail $_.Exception.Message
}
Wait-Close
