# Tests the live-update stream (/api/events) the way a browser uses it. Read only: it changes no data.
# It logs in with an account of the app, opens the stream, and checks:
#   1. the response type is text/event-stream;
#   2. the first line ("retry: ...") arrives within 5 seconds (IIS is not holding the stream back);
#   3. a keep-alive line (": ping") arrives within 35 seconds (the connection stays open).
# Run it twice: against the app directly, and through IIS.
#   check-events.bat                                  (asks for the address and an account)
#   check-events.bat http://127.0.0.1:3100            (the app, on this server)
#   check-events.bat https://kun-mh:8443              (through IIS, as the users do)
# The login is recorded in the audit log like any other log-in. Use an account that is meant for testing.
param([string]$Base = '')
. "$PSScriptRoot\common.ps1"
Write-Step 'Live-update stream test'

if (-not $Base) { $Base = Read-Host 'Address of the app (for example http://127.0.0.1:3100 or https://kun-mh:8443)' }
$Base = $Base.TrimEnd('/')
$email = Read-Host 'Email of a test account'
$password = Read-Secret 'Password of that account'

$problems = 0
try {
    Add-Type -AssemblyName System.Net.Http

    # 1. log in: the session cookie is kept in $session
    $body = @{ email = $email; password = $password } | ConvertTo-Json -Compress
    $login = Invoke-WebRequest -Method Post -Uri "$Base/api/login" -ContentType 'application/json' -Body $body `
        -SessionVariable session -UseBasicParsing
    if ($login.StatusCode -ne 200) { throw "The log-in failed (status $($login.StatusCode))." }
    $cookies = $session.Cookies.GetCookies([uri]$Base)
    if ($cookies.Count -eq 0) { throw 'The log-in gave no session cookie. Over http:// with COOKIE_SECURE=true the browser would also drop it: use the https:// address.' }
    $cookieHeader = ($cookies | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; '
    Write-Ok 'Logged in; session cookie received.'

    # 2. open the stream
    $handler = New-Object System.Net.Http.HttpClientHandler
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(60)
    $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, "$Base/api/events")
    $req.Headers.Add('Cookie', $cookieHeader)
    $resp = $client.SendAsync($req, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    if (-not $resp.IsSuccessStatusCode) { throw "The stream answered with status $([int]$resp.StatusCode)." }
    $type = $resp.Content.Headers.ContentType.MediaType
    if ($type -eq 'text/event-stream') { Write-Ok 'The response type is text/event-stream.' }
    else { Write-Fail "The response type is '$type', not text/event-stream. A proxy or compression may be changing the response."; $problems++ }

    $reader = New-Object IO.StreamReader($resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult())

    # 3. the first line must arrive at once
    $first = $reader.ReadLineAsync()
    if ($first.Wait(5000) -and $first.Result -like 'retry:*') { Write-Ok "The first line arrived at once: '$($first.Result)'. Nothing is buffered." }
    else { Write-Fail 'No line arrived within 5 seconds. IIS is probably buffering or compressing the stream (see INSTALLATION_GUIDE.md, Part 9).'; $problems++ }

    # 4. a keep-alive line must arrive (the app sends one every 25 seconds)
    $deadline = (Get-Date).AddSeconds(35)
    $gotPing = $false
    while ((Get-Date) -lt $deadline -and -not $gotPing) {
        $next = $reader.ReadLineAsync()
        if (-not $next.Wait(5000)) { continue }
        if ($next.Result -eq $null) { break }
        if ($next.Result -like ':*') { $gotPing = $true }
    }
    if ($gotPing) { Write-Ok 'A keep-alive line arrived: the connection stays open.' }
    else { Write-Fail 'No keep-alive line within 35 seconds: the connection was closed or held back.'; $problems++ }
} catch {
    Write-Fail $_.Exception.Message
    $problems++
} finally {
    if ($client) { $client.Dispose() }
}

Write-Host ''
if ($problems -eq 0) { Write-Ok 'The live-update stream works at this address.' }
else { Write-Fail "$problems check(s) failed. See the lines above and INSTALLATION_GUIDE.md, Part 9 and Part 10." }
Wait-Close
