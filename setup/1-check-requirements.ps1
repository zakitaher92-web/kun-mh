# Step 1: checks that this server has what the app needs.
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 1 of 8: checking this server'
$problems = 0

$os = Get-CimInstance Win32_OperatingSystem
Write-Info "Windows: $($os.Caption) (version $($os.Version))"
if ($os.Caption -notmatch 'Server') {
    Write-Warn 'This is not a Windows Server edition. The steps were written for Windows Server 2016. Continue only on a test computer.'
}
try { Assert-Admin; Write-Ok 'Running as administrator' }
catch { Write-Warn 'Not running as administrator. Steps 6, 7 and 8 need it: right-click the .bat file and choose "Run as administrator".' }

# Node.js
$nodeExe = Get-NodeExe
if ($nodeExe) {
    $nodeVersion = (& $nodeExe -v) 2>$null
    $parsed = $null
    if ($nodeVersion -and [version]::TryParse($nodeVersion.TrimStart('v'), [ref]$parsed) -and $parsed -ge [version]'22.9.0') {
        Write-Ok "Node.js $nodeVersion"
        Write-Info "folder: $nodeExe"
    } else {
        Write-Fail "Node.js $nodeVersion is too old. Node.js 22.9 or newer is needed (use the LTS 22 installer from https://nodejs.org)."
        $problems++
    }
} else {
    Write-Fail 'Node.js is not installed. Install Node.js 22 LTS from https://nodejs.org, open a new window and run this step again.'
    $problems++
}

if (Get-Command npm -ErrorAction SilentlyContinue) { Write-Ok 'npm is available' }
else { Write-Fail 'npm is not available. It is installed together with Node.js.'; $problems++ }

# PostgreSQL
$bin = Get-PgBin
if ($bin) {
    $pgVersion = (& (Join-Path $bin 'postgres.exe') --version) 2>$null
    Write-Ok "PostgreSQL found: $pgVersion"
    Write-Info "folder: $bin"
} else {
    Write-Fail 'PostgreSQL 18 was not found. Install it as described in INSTALLATION_GUIDE.md, Part 1.'
    $problems++
}

$dbPort = if ($env:KUN_PG_PORT) { [int]$env:KUN_PG_PORT } else { Get-DbPort }
$service = Get-Service -Name $PgService -ErrorAction SilentlyContinue
if ($service) {
    Write-Info "Windows service $($PgService): $($service.Status), startup type $($service.StartType)"
    if ($service.StartType -ne 'Automatic') {
        Write-Warn "Set the $PgService service to Automatic in services.msc, so the database starts after a restart."
    }
} else {
    Write-Info "The KUN MH database service $PgService does not exist yet. Step 3 creates it."
}
try { Assert-NotReserved $dbPort 'The KUN MH database' } catch { Write-Fail $_.Exception.Message; $problems++ }
if (Test-Port $dbPort) { Write-Ok "PostgreSQL is accepting connections on port $dbPort" }
elseif ($service) {
    Write-Fail "PostgreSQL is not running on port $dbPort. Start the $PgService service in services.msc, then run this step again."
    $problems++
}

# IIS and its two add-ons (IIS itself is installed by step 7)
$w3svc = Get-Service -Name W3SVC -ErrorAction SilentlyContinue
if ($w3svc) { Write-Ok "IIS is installed (service W3SVC: $($w3svc.Status))" }
else { Write-Info 'IIS is not installed yet. Step 7 installs it.' }

$rewriteDll = Join-Path $env:SystemRoot 'System32\inetsrv\rewrite.dll'
if (Test-Path $rewriteDll) { Write-Ok 'IIS URL Rewrite is installed' }
else {
    Write-Fail 'IIS URL Rewrite is not installed. Download "URL Rewrite 2.1" from https://www.iis.net/downloads/microsoft/url-rewrite and install it, then run this step again.'
    $problems++
}

$arrDll = Join-Path $env:ProgramFiles 'IIS\Application Request Routing\requestRouter.dll'
if (Test-Path $arrDll) { Write-Ok 'Application Request Routing (ARR) is installed' }
else {
    Write-Fail 'Application Request Routing is not installed. Download "Application Request Routing 3.0" from https://www.iis.net/downloads/microsoft/application-request-routing, install it after URL Rewrite, then run this step again.'
    $problems++
}

# Ports. The KUN MH ports must be free and must not be ports used by other applications.
$appPort = if ($env:KUN_APP_PORT) { [int]$env:KUN_APP_PORT } else { $DefaultAppPort }
$httpPort = if ($env:KUN_HTTP_PORT) { [int]$env:KUN_HTTP_PORT } else { $DefaultHttpPort }
$httpsPort = if ($env:KUN_HTTPS_PORT) { [int]$env:KUN_HTTPS_PORT } else { $DefaultHttpsPort }
foreach ($entry in @(
    @{ Port = $appPort;   What = 'the app (private)' },
    @{ Port = $httpPort;  What = 'IIS HTTP (office users)' },
    @{ Port = $httpsPort; What = 'IIS HTTPS (office users)' })) {
    try { Assert-NotReserved $entry.Port $entry.What } catch { Write-Fail $_.Exception.Message; $problems++; continue }
    if (Test-Port $entry.Port) {
        Write-Warn "Port $($entry.Port) (for $($entry.What)) is already in use. If it is the KUN app itself, that is fine. Otherwise choose another port in step 4 or 7."
    } else {
        Write-Ok "Port $($entry.Port) is free for $($entry.What)"
    }
}

Write-Host ''
if ($problems -eq 0) { Write-Ok 'Everything needed is in place. Next: run 2-install-packages.bat' }
else { Write-Fail "$problems problem(s) found. Fix the items marked FAIL, then run this step again." }
Wait-Close
