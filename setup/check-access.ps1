# Checks that the app can be reached from other computers, and that only the intended ports are open.
# Read-only: it changes nothing. Run it after step 7, and after any change to the network, firewall or IIS.
. "$PSScriptRoot\common.ps1"
Write-Step 'Checking access to the KUN MH app'
$problems = 0
function Check([bool]$ok, [string]$good, [string]$bad) {
    if ($ok) { Write-Ok $good } else { Write-Fail $bad; $script:problems++ }
}

try {
    Import-Module WebAdministration -ErrorAction Stop
    $appPort  = Get-AppPort
    $dbPort   = Get-DbPort
    $lan      = Get-LanAddress
    $site     = Get-Website -Name $SiteName -ErrorAction SilentlyContinue
    $bindings = if ($site) { @($site.bindings.Collection) } else { @() }
    $httpBinding  = $bindings | Where-Object { $_.protocol -eq 'http' } | Select-Object -First 1
    $httpsBinding = $bindings | Where-Object { $_.protocol -eq 'https' } | Select-Object -First 1
    $httpPort  = if ($httpBinding) { [int]($httpBinding.bindingInformation -split ':')[1] } else { $null }
    $httpsPort = if ($httpsBinding) { [int]($httpsBinding.bindingInformation -split ':')[1] } else { $null }

    Write-Info "App port (private): $appPort    Database port (private): $dbPort"
    Write-Info "Office users: HTTP $httpPort$(if ($httpsPort) { ", HTTPS $httpsPort" })    Network address of this server: $lan"
    Write-Host ''

    # Services
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Check ([bool]$task -and $task.State -eq 'Running') "Scheduled task '$TaskName' is running" "The app is not running (task '$TaskName' is missing or stopped). Run 6-start-app.bat."
    $pgSvc = Get-Service -Name $PgService -ErrorAction SilentlyContinue
    Check ([bool]$pgSvc -and $pgSvc.Status -eq 'Running') "Database service $PgService is running" "The database service $PgService is not running."
    $w3 = Get-Service -Name W3SVC -ErrorAction SilentlyContinue
    Check ([bool]$w3 -and $w3.Status -eq 'Running') 'IIS (W3SVC) is running' 'IIS is not running. Start the World Wide Web Publishing Service.'
    Check ([bool]$site -and $site.State -eq 'Started') "IIS website '$SiteName' is started" "The IIS website '$SiteName' is missing or stopped. Run 7-setup-iis.bat."

    # Ports on the network address: the app and the database must NOT answer; IIS must answer
    if ($lan) {
        Check (-not (Test-TcpPort $lan $appPort)) "App port $appPort is closed to the network" "App port $appPort answers on $lan. It must be private: check HOST=127.0.0.1 in server\.env."
        Check (-not (Test-TcpPort $lan $dbPort)) "Database port $dbPort is closed to the network" "Database port $dbPort answers on $lan. Check the listen_addresses setting of the KUN MH database (localhost only)."
        foreach ($p in @($httpPort, $httpsPort) | Where-Object { $_ }) {
            Check (Test-TcpPort $lan $p) "Port $p is open to the network (IIS)" "Port $p does not answer on $lan. Check the firewall rule 'KUN-MH IIS port $p' and the network profile."
        }
    } else {
        Write-Warn 'No network address found for this server. Network checks skipped.'
    }

    # Ports used by other applications must not be used by KUN MH
    foreach ($p in @($appPort, $dbPort, $httpPort, $httpsPort) | Where-Object { $_ }) {
        Check ($ReservedPorts -notcontains $p) "Port $p is not used by another application" "Port $p belongs to another application ($($ReservedPorts -join ', ' ) are reserved). Change it."
    }

    # IIS -> app, locally and on the network address
    if ($httpPort) {
        $local = Get-HttpStatus "http://127.0.0.1:$httpPort/api/me"
        Check ($local -eq 401) "IIS passes requests to the app (status $local, expected 401)" "IIS does not reach the app (status $local). Check $LogFile and run 6-start-app.bat."
        if ($lan) {
            $remote = Get-HttpStatus "http://$lan`:$httpPort/api/me"
            Check ($remote -eq 401) "The app answers on http://$lan`:$httpPort/ (status $remote)" "http://$lan`:$httpPort/ does not answer as expected (status $remote)."
        }
    }

    # Firewall: only the web ports are opened, and only for the chosen addresses
    $rules = @(Get-NetFirewallRule -DisplayName 'KUN-MH IIS port *' -ErrorAction SilentlyContinue)
    Check ($rules.Count -gt 0) "Firewall rules for the web ports: $(($rules | ForEach-Object { $_.DisplayName }) -join '; ')" 'No firewall rule for the web ports. Run 7-setup-iis.bat.'
    foreach ($r in $rules) {
        $filter = $r | Get-NetFirewallAddressFilter
        Write-Info "$($r.DisplayName): allowed for $($filter.RemoteAddress)"
        if ($filter.RemoteAddress -contains 'Any') { Write-Warn "$($r.DisplayName) allows every address. Re-run 7-setup-iis.bat and choose LocalSubnet or your office range." }
    }
    $openRules = @(Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -match 'KUN' } | ForEach-Object { $_.DisplayName })
    Write-Info "KUN MH inbound allow rules: $(if ($openRules) { $openRules -join '; ' } else { 'none' })"

    Write-Host ''
    if ($problems -eq 0) { Write-Ok 'Access is set up correctly. Other computers can open the app at the address shown in step 7.' }
    else { Write-Fail "$problems check(s) failed. Fix them and run this check again." }
} catch {
    Write-Fail $_.Exception.Message
}
Wait-Close
