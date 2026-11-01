# Step 1: checks that this computer has what the app needs.
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 1 of 7: checking this computer'
$problems = 0
try {
    $nodeVersion = (& node -v) 2>$null
    if ($nodeVersion -and ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -ge 22)) {
        Write-Ok "Node.js $nodeVersion"
    } else {
        Write-Fail 'Node.js 22 or newer is needed. Install the LTS version from https://nodejs.org, open a new window and run this step again.'
        $problems++
    }
} catch {
    Write-Fail 'Node.js is not installed. Install the LTS version from https://nodejs.org, open a new window and run this step again.'
    $problems++
}

if (Get-Command npm -ErrorAction SilentlyContinue) { Write-Ok 'npm is available' }
else { Write-Fail 'npm is not available. It is installed together with Node.js.'; $problems++ }

$bin = Get-PgBin
if ($bin) {
    $pgVersion = (& (Join-Path $bin 'postgres.exe') --version) 2>$null
    Write-Ok "PostgreSQL found: $pgVersion"
    Write-Info "folder: $bin"
} else {
    Write-Fail 'PostgreSQL 16 was not found. Install it as described in INSTALLATION_GUIDE.md, Part 1b.'
    $problems++
}

$service = Get-Service -Name 'postgresql-x64-16' -ErrorAction SilentlyContinue
if ($service) { Write-Info "Windows service postgresql-x64-16: $($service.Status)" }

if (Test-Port 5432) { Write-Ok 'PostgreSQL is accepting connections on port 5432' }
else {
    Write-Fail 'PostgreSQL is not running on port 5432. Start the postgresql-x64-16 service in services.msc, then run this step again.'
    $problems++
}

if (Test-Port 3000) { Write-Warn 'Port 3000 is already in use. The app may already be running. That is fine if it is the KUN app.' }
else { Write-Ok 'Port 3000 is free for the app' }

Write-Host ''
if ($problems -eq 0) { Write-Ok 'Everything needed is in place. Next: run 2-install-packages.bat' }
else { Write-Fail "$problems problem(s) found. Fix the items marked FAIL, then run this step again." }
Wait-Close
