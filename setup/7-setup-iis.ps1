# Step 7: sets up IIS as the front door for other computers.
# Office users open http://SERVER-NAME:8080/ (or https://SERVER-NAME:8443/ with a certificate).
# IIS passes each request to the app on 127.0.0.1 (port from server\.env, default 3100), which stays private.
# Ports 80, 443 and 3000 are used by other applications on this server and are never used here.
. "$PSScriptRoot\common.ps1"
Write-Step 'Step 7 of 8: setting up IIS (the web server that other computers use)'
try {
    Assert-Admin
    if (-not (Test-Path $EnvFile)) { throw 'Run step 4 first (the settings file is missing).' }
    $appPort = Get-AppPort

    # 1. IIS itself
    $iisFeatures = @('Web-Server', 'Web-Mgmt-Console', 'Web-Scripting-Tools')
    if (Get-Command Install-WindowsFeature -ErrorAction SilentlyContinue) {
        Write-Info 'Installing the IIS role (this can take a few minutes)...'
        $result = Install-WindowsFeature -Name $iisFeatures -IncludeManagementTools
        if (-not $result.Success) { throw 'IIS could not be installed. Add the Web Server (IIS) role in Server Manager, then run this step again.' }
    } else {
        Write-Info 'Enabling IIS (this can take a few minutes)...'
        Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServer, IIS-ManagementConsole, IIS-ManagementScriptingTools -All -NoRestart | Out-Null
    }
    Import-Module WebAdministration
    Write-Ok 'IIS is installed'

    # 2. URL Rewrite and Application Request Routing (downloads from iis.net, not part of Windows)
    $rewriteDll = Join-Path $env:SystemRoot 'System32\inetsrv\rewrite.dll'
    $arrDll     = Join-Path $env:ProgramFiles 'IIS\Application Request Routing\requestRouter.dll'
    if (-not (Test-Path $rewriteDll)) { throw 'IIS URL Rewrite is not installed. Install "URL Rewrite 2.1" from https://www.iis.net/downloads/microsoft/url-rewrite, then run this step again.' }
    if (-not (Test-Path $arrDll)) { throw 'Application Request Routing is not installed. Install "Application Request Routing 3.0" from https://www.iis.net/downloads/microsoft/application-request-routing, then run this step again.' }
    Write-Ok 'URL Rewrite and Application Request Routing are installed'

    # 3. Allow the reverse proxy. ARR is installed with the proxy switched off and the setting locked.
    # appcmd is run through cmd so that its messages on stderr do not stop the script.
    $appcmd = Join-Path $env:SystemRoot 'System32\inetsrv\appcmd.exe'
    cmd.exe /c "`"$appcmd`" unlock config -section:system.webServer/proxy >nul 2>&1" | Out-Null
    cmd.exe /c "`"$appcmd`" unlock config -section:system.webServer/rewrite/rules >nul 2>&1" | Out-Null
    Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled' -Value 'True'
    Write-Ok 'The IIS reverse proxy is switched on'

    # 4. Settings from the person doing the install
    $allowed = if ($env:KUN_ALLOWED_ADDRESSES) { $env:KUN_ALLOWED_ADDRESSES } else {
        Read-Host 'Which computers may open the app? Press Enter for this network only (LocalSubnet), or type a range such as 10.10.0.0/16, or Any'
    }
    $allowed = $allowed.Trim()
    if (-not $allowed) { $allowed = 'LocalSubnet' }

    $thumb = if ($env:KUN_CERT_THUMBPRINT) { $env:KUN_CERT_THUMBPRINT } else {
        Read-Host 'Certificate thumbprint for HTTPS (Enter to skip; see INSTALLATION_GUIDE.md, Part 5)'
    }
    $thumb = ($thumb -replace '\s', '').ToUpper()
    $cert = $null
    if ($thumb) {
        $cert = Get-Item -Path "Cert:\LocalMachine\My\$thumb" -ErrorAction SilentlyContinue
        if (-not $cert) { throw "No certificate with thumbprint $thumb in Local Computer > Personal. Check the thumbprint and run this step again." }
        Write-Ok "HTTPS will use the certificate for $($cert.Subject)"
        Write-Info "Names on the certificate: $(($cert.DnsNameList | ForEach-Object { $_.Unicode }) -join ', ')"
        if (-not $cert.HasPrivateKey) { throw 'This certificate has no private key on this server, so IIS cannot use it. Choose a certificate that was installed with its key.' }
        if ($cert.NotAfter -lt (Get-Date).AddDays(14)) { throw "This certificate expires on $($cert.NotAfter.ToString('yyyy-MM-dd')). Renew it first." }
        $fqdn = $env:COMPUTERNAME
        try { $fqdn = [System.Net.Dns]::GetHostEntry($env:COMPUTERNAME).HostName } catch { }
        $covered = @($cert.DnsNameList | ForEach-Object { $_.Unicode }) | Where-Object { $_ -ieq $env:COMPUTERNAME -or $_ -ieq $fqdn -or $_ -ieq ('*.' + ($fqdn -replace '^[^.]+\.', '')) }
        if (-not $covered) {
            Write-Warn "The certificate does not list this server's name ($env:COMPUTERNAME or $fqdn). Browsers will show a name warning. Use a certificate that includes the name users type, or ask IT to add it."
        }
    } else {
        Write-Warn 'HTTPS is skipped. Passwords and data would travel unencrypted on the network. Add a certificate as soon as possible (Part 5), then run this step again.'
    }

    $httpPort = if ($env:KUN_HTTP_PORT) { [int]$env:KUN_HTTP_PORT } else {
        [int](Read-Host "Port for office users over HTTP (Enter for $DefaultHttpPort)")
    }
    if (-not $httpPort) { $httpPort = $DefaultHttpPort }
    $httpsPort = $null
    if ($cert) {
        $httpsPort = if ($env:KUN_HTTPS_PORT) { [int]$env:KUN_HTTPS_PORT } else {
            [int](Read-Host "Port for office users over HTTPS (Enter for $DefaultHttpsPort)")
        }
        if (-not $httpsPort) { $httpsPort = $DefaultHttpsPort }
    }
    $ports = @($httpPort)
    if ($httpsPort) { $ports += $httpsPort }

    foreach ($p in $ports) {
        Assert-NotReserved $p 'KUN MH'
        if ($p -eq $appPort) { throw "Port $p is the port of the app itself. Choose another port." }
    }

    # 5. The ports must be free for this site: stop IIS websites that use them (after asking), and refuse other programs
    foreach ($p in $ports) {
        $others = @()
        foreach ($site in Get-Website) {
            if ($site.Name -eq $SiteName) { continue }
            foreach ($b in $site.bindings.Collection) {
                if ($b.bindingInformation -like "*:${p}:*") { $others += $site }
            }
        }
        foreach ($site in ($others | Sort-Object -Property Name -Unique)) {
            Write-Warn "Port $p is used by the IIS website '$($site.Name)' (state: $($site.State))."
            $stop = if ($env:KUN_STOP_CONFLICTS) { $env:KUN_STOP_CONFLICTS } else {
                Read-Host "Stop the website '$($site.Name)' so that $SiteName can use port $p? (y/N)"
            }
            if ($stop -match '^[yY]') {
                Stop-Website -Name $site.Name
                Write-Ok "Stopped the website '$($site.Name)'. (It is only stopped, not deleted.)"
            } else {
                throw "Port $p is in use by '$($site.Name)'. Choose another port, or stop that website in IIS Manager, then run this step again."
            }
        }
        $ownBinding = Get-WebBinding -Name $SiteName -Port $p -ErrorAction SilentlyContinue
        if (-not $ownBinding -and (Test-Port $p)) {
            throw "Port $p is already in use by another program on this server. Choose another port, then run this step again."
        }
    }

    # 6. web.config: the rule that passes every request to the app
    $siteDir = Join-Path $Root 'iis'
    New-Item -ItemType Directory -Force -Path $siteDir | Out-Null

    $httpsRule = ''
    if ($httpsPort) {
        $httpsRule = @'
        <rule name="Redirect to HTTPS" stopProcessing="true">
          <match url="(.*)" />
          <conditions><add input="{HTTPS}" pattern="^OFF$" /></conditions>
          <action type="Redirect" url="https://{SERVER_NAME}:__HTTPS_PORT__/{R:1}" redirectType="Permanent" />
        </rule>

'@
    }
    $template = @'
<?xml version="1.0" encoding="utf-8"?>
<!-- Written by setup\7-setup-iis.ps1. Every request is passed to the KUN MH app on this server. -->
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
__HTTPS_RULE__        <rule name="KUN-MH app" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:__APP_PORT__/{R:1}" />
        </rule>
      </rules>
    </rewrite>
    <!-- responseBufferLimit=0: the live-update stream (/api/events) must not be held back by IIS -->
    <proxy enabled="true" preserveHostHeader="true" reverseRewriteHostInResponseHeaders="false" responseBufferLimit="0" />
  </system.webServer>
</configuration>
'@
    $webConfig = $template.Replace('__HTTPS_RULE__', $httpsRule).Replace('__APP_PORT__', [string]$appPort).Replace('__HTTPS_PORT__', [string]$httpsPort)
    [IO.File]::WriteAllText((Join-Path $siteDir 'web.config'), $webConfig, (New-Object Text.UTF8Encoding $false))
    Write-Ok "Saved $siteDir\web.config"

    # 7. The application pool: no .NET, used only by this website (the Billing site keeps its own pool)
    if (-not (Test-Path "IIS:\AppPools\$IisAppPool")) { New-WebAppPool -Name $IisAppPool | Out-Null }
    Set-ItemProperty "IIS:\AppPools\$IisAppPool" -Name managedRuntimeVersion -Value ''

    # 8. The IIS website, on the chosen ports only
    if (-not (Get-Website -Name $SiteName -ErrorAction SilentlyContinue)) {
        New-Website -Name $SiteName -PhysicalPath $siteDir -Port $httpPort -ApplicationPool $IisAppPool | Out-Null
        Write-Ok "Created the IIS website '$SiteName' on port $httpPort"
    } else {
        Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $siteDir
        Set-ItemProperty "IIS:\Sites\$SiteName" -Name applicationPool -Value $IisAppPool
        if (-not (Get-WebBinding -Name $SiteName -Protocol http -Port $httpPort)) { New-WebBinding -Name $SiteName -Protocol http -Port $httpPort | Out-Null }
        Write-Ok "Updated the IIS website '$SiteName'"
    }
    # Users reach the site only through the chosen ports: remove bindings left from an earlier run
    foreach ($b in @(Get-WebBinding -Name $SiteName)) {
        $parts = $b.bindingInformation -split ':'
        if ($ports -notcontains [int]$parts[1]) {
            Remove-WebBinding -Name $SiteName -IPAddress $parts[0] -Port ([int]$parts[1]) -HostHeader $parts[2] -Protocol $b.protocol
            Write-Info "Removed the old $($b.protocol) binding on port $($parts[1])"
        }
    }
    Set-WebConfigurationProperty -PSPath "MACHINE/WEBROOT/APPHOST/$SiteName" `
        -Filter 'system.webServer/security/authentication/anonymousAuthentication' -Name enabled -Value 'True'
    if ($httpsPort) {
        if (-not (Get-WebBinding -Name $SiteName -Protocol https -Port $httpsPort)) {
            New-WebBinding -Name $SiteName -Protocol https -Port $httpsPort -IPAddress '*' -SslFlags 0 | Out-Null
        }
        $sslPath = "IIS:\SslBindings\0.0.0.0!$httpsPort"
        if (Test-Path $sslPath) { Remove-Item $sslPath -Force }
        New-Item $sslPath -Value $cert | Out-Null
        Write-Ok "HTTPS is set up on port $httpsPort"
    }
    Start-Website -Name $SiteName

    # 9. Windows Firewall: only the chosen web ports, only from the chosen addresses. The app port is not opened.
    $wantedRules = @($ports | ForEach-Object { "KUN-MH IIS port $_" })
    foreach ($rule in @(Get-NetFirewallRule -DisplayName 'KUN-MH IIS port *' -ErrorAction SilentlyContinue)) {
        if ($wantedRules -notcontains $rule.DisplayName) {
            Remove-NetFirewallRule -Name $rule.Name
            Write-Info "Removed the firewall rule '$($rule.DisplayName)' from an earlier run"
        }
    }
    foreach ($p in $ports) {
        $ruleName = "KUN-MH IIS port $p"
        Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP `
            -LocalPort $p -RemoteAddress $allowed -Profile Any | Out-Null
        Write-Ok "Firewall: port $p is open for $allowed"
    }

    # 10. Test the whole path: IIS -> app. The app answers 401 ("log in first") to an anonymous request.
    Start-Sleep -Seconds 2
    $status = Get-HttpStatus "http://127.0.0.1:$httpPort/api/me"
    if ($status -eq 401) {
        Write-Ok 'IIS reaches the app. The log-in check answered as expected.'
    } elseif ($status -eq 0 -or $status -ge 500) {
        Write-Fail "IIS answered with status $status, so it cannot reach the app. Run 6-start-app.bat, then run this step again if needed. Check $LogFile."
    } else {
        Write-Warn "IIS answered with status $status (expected 401). Check the site in IIS Manager."
    }

    $lan = Get-LanAddress
    if ($lan) {
        $lanStatus = Get-HttpStatus "http://$lan`:$httpPort/api/me"
        if ($lanStatus -eq 401) { Write-Ok "Reachable on the network address http://$lan`:$httpPort/" }
        else { Write-Warn "The network address http://$lan`:$httpPort/ answered with status $lanStatus. Check the firewall and the network profile of this server." }
        if (Test-TcpPort $lan $appPort) { Write-Warn "The app port $appPort answers on the network address. It must only answer on 127.0.0.1; check HOST in server\.env." }
        else { Write-Ok "The app port $appPort is not reachable from the network (correct)" }
    }
    $serverName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'SERVER' }
    Write-Host ''
    Write-Ok 'IIS is set up. Other computers on the network open the app at:'
    Write-Info "http://$serverName`:$httpPort/   (works when the computer name is known on the network)"
    if ($lan) { Write-Info "http://$lan`:$httpPort/" }
    if ($httpsPort) { Write-Info "https://$serverName`:$httpsPort/   (use the name on the certificate)" }
    Write-Info 'Next: run 5-create-admin.bat if you have not, then open the app from another computer and check it. Step 8 sets up backups.'
} catch {
    Write-Fail $_.Exception.Message
}
Wait-Close
