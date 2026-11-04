# Step 5: creates the log-in accounts for the people who will use the app.
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 5 of 8: creating log-in accounts'
try {
    if (-not (Test-Path $EnvFile)) { throw 'Run step 4 first (the settings file is missing).' }
    $more = 'y'
    while ($more -match '^[yY]') {
        $email = if ($env:KUN_ADMIN_EMAIL) { $env:KUN_ADMIN_EMAIL } else { Read-Host 'Email of the person (for example head.accounts@example.com)' }
        $name  = if ($env:KUN_ADMIN_NAME) { $env:KUN_ADMIN_NAME } else { Read-Host 'Full name' }
        $pw    = if ($env:KUN_ADMIN_PASSWORD) { $env:KUN_ADMIN_PASSWORD } else { Read-Secret 'Password for this person (at least 8 characters)' }
        $rule = Test-PasswordRule $pw
        if (-not $email -or -not $name) { Write-Warn 'Email and name are both needed.' }
        elseif ($rule) { Write-Warn $rule }
        else {
            $code = Invoke-Node @('--env-file-if-exists=.env', 'src/manage.js', 'add', $email, $name, $pw)
            if ($code -eq 0) { Write-Ok "Log-in created for $email" }
            else { Write-Warn 'The log-in was not created. See the message above (an email can only be used once).' }
        }
        if ($env:KUN_ADMIN_EMAIL) { break }
        $more = Read-Host 'Add another person? (y/N)'
    }
    Write-Info 'Accounts in the database:'
    Invoke-Node @('--env-file-if-exists=.env', 'src/manage.js', 'list') | Out-Null
    Write-Ok 'Next: run 6-start-app.bat'
} catch {
    Write-Fail $_.Exception.Message
}
Wait-Close
