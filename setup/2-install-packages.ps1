# Step 2: downloads the packages the server needs (one time).
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 2 of 8: installing the server packages'
try {
    if (Test-Path (Join-Path $Server 'node_modules\pg')) {
        Write-Ok 'The server packages are already installed.'
    } else {
        # npm runs through cmd.exe: PowerShell 5.1 can misreport npm's output as an error when $ErrorActionPreference is Stop.
        Push-Location $Server
        try {
            cmd.exe /c 'npm install --no-audit --no-fund'
            if ($LASTEXITCODE -ne 0 -and -not (Test-Path (Join-Path $Server 'node_modules\pg'))) {
                throw "npm install did not finish (exit code $LASTEXITCODE). Check your internet connection (or the proxy setting) and run this step again."
            }
        } finally { Pop-Location }
    }
    if (Test-Path (Join-Path $Server 'node_modules\pg')) {
        Write-Ok 'Server packages installed. Next: run 3-create-database.bat'
    } else { throw 'The packages were not installed. Run this step again.' }
} catch {
    Write-Fail $_.Exception.Message
}
Wait-Close
