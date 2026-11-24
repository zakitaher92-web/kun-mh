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

# The shared PostgreSQL 18 cluster (service postgresql-x64-18, port 5432). KUN MH uses its own database in it.
if ($bin -and $pgVersion -notmatch 'PostgreSQL\) 18\.') {
    Write-Fail "PostgreSQL 18 is required. The installed programs are: $pgVersion"
    $problems++
}
$dbPort = if ($env:KUN_PG_PORT) { [int]$env:KUN_PG_PORT } else { $DefaultPgPort }
$service = Get-Service -Name $PgService -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Fail "The PostgreSQL service $PgService was not found. Install PostgreSQL 18 with its default service name (INSTALLATION_GUIDE.md, Part 1b)."
    $problems++
} else {
    Write-Info "Windows service $($PgService): $($service.Status), startup type $($service.StartType)"
    if ($service.Status -ne 'Running') {
        Write-Fail "The service $PgService is not running. Start it in services.msc, then run this step again."
        $problems++
    }
    if ($service.StartType -ne 'Automatic') {
        Write-Warn "Set the $PgService service to Automatic in services.msc, so the database starts after a restart."
    }
}
if (Test-Port $dbPort) { Write-Ok "PostgreSQL is accepting connections on 127.0.0.1:$dbPort" }
else {
    Write-Fail "Nothing answers on port $dbPort (127.0.0.1). Check the service $PgService, then run this step again."
    $problems++
}

# listen_addresses: read only (this step never changes postgresql.conf). It should be localhost.
$serviceInfo = Get-CimInstance Win32_Service -Filter "Name='$PgService'" -ErrorAction SilentlyContinue
$dataDir = $null
if ($serviceInfo -and $serviceInfo.PathName -match '-D\s+"([^"]+)"') { $dataDir = $Matches[1] }
elseif ($serviceInfo -and $serviceInfo.PathName -match '-D\s+(\S+)') { $dataDir = $Matches[1] }
$confFile = if ($dataDir) { Join-Path $dataDir 'postgresql.conf' } else { $null }
if ($confFile -and (Test-Path $confFile)) {
    $listen = Get-Content $confFile | Where-Object { $_ -match '^\s*listen_addresses\s*=' } | Select-Object -First 1
    $value = if ($listen) { (($listen -split '=', 2)[1]).Split('#')[0].Trim().Trim("'").Trim('"') } else { 'localhost (default)' }
    if ($value -match '^(localhost|127\.0\.0\.1)$|default') { Write-Ok "listen_addresses = $value" }
    else { Write-Warn "listen_addresses = '$value'. The shared cluster listens beyond localhost, which exposes it to the network. Ask the owner of the Billing application to set it to 'localhost'. This step does not change it." }
} else {
    Write-Info 'The data folder of the cluster could not be read; listen_addresses was not checked.'
}

# Time zone: business dates and the logs use Baghdad time (Windows ID "Arabic Standard Time", UTC+03:00).
$tzId = ((tzutil.exe /g) | Out-String).Trim()
if ($tzId -eq 'Arabic Standard Time') { Write-Ok 'Windows time zone is Baghdad time (Arabic Standard Time)' }
else { Write-Warn "The Windows time zone is '$tzId'. Set it to Baghdad time: tzutil /s ""Arabic Standard Time"" (check with tzutil /g), then restart the app." }

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
