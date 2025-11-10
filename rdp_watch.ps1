param(
    [int]$IntervalSec = 5,
    [switch]$Backfill,
    [switch]$IncludeSecurity
)

[bool]$LogOnlyRCMSuccessWithIP = $true

[bool]$SuppressConsoleAll = $true

[string]$FilterUser   = ""
[string]$FilterDomain = ""
[string]$FilterIP     = ""

# Text log settings
[string]$TextLogPath = "C:\Users\dkc\Desktop\daihatsu_system\log\rdp_access.log"
[bool]$WriteAcceptedRowsToTextLog = $true
[bool]$WriteErrorsToTextLog       = $true
try {
    $logDir = Split-Path -Path $TextLogPath -Parent
    if ($logDir -and -not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    if (-not (Test-Path $TextLogPath)) {
        New-Item -ItemType File -Path $TextLogPath -Force | Out-Null
    }
} catch { }

function Write-Log {
    param([string]$Message)
    try {
        $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        "$stamp $Message" | Out-File -FilePath $TextLogPath -Append -Encoding UTF8
    } catch { }
}

$channels = @(
    @{ Label='RCM';     Log='Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational'; XPath="*[System[(EventID=1149)]]";                    Result='SUCCESS' },
    @{ Label='LSM';     Log='Microsoft-Windows-TerminalServices-LocalSessionManager/Operational';     XPath="*[System[(EventID=21 or EventID=25)]]";         Result='SUCCESS' },
    @{ Label='RDPCORE'; Log='Microsoft-Windows-RemoteDesktopServices-RDPCoreTS/Operational';          XPath="*[System[(EventID=140)]]";                      Result='FAILURE' }
)

$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if ($IncludeSecurity) {
    if (-not $admin) {
        if ($WriteErrorsToTextLog) { Write-Log "IncludeSecurity requires Administrator." }
    } else {
        $channels += @{ Label='SEC'; Log='Security'; XPath="*[System[(EventID=4625)]] and *[EventData[Data[@Name='LogonType']='10']]"; Result='FAILURE' }
    }
}

function Parse-Event {
    param([System.Diagnostics.Eventing.Reader.EventRecord]$Event, [string]$Label, [string]$Result)

    [xml]$xml = $Event.ToXml()

    $eventId  = [string]$Event.Id
    if (-not $eventId) { $eventId = [string]$xml.Event.System.EventID.'#text' }

    $timeUtc  = [string]$xml.Event.System.TimeCreated.SystemTime
    $recordId = [long]$xml.Event.System.EventRecordID
    $computer = [string]$xml.Event.System.Computer

    $ed = @{}
    foreach ($d in $xml.Event.EventData.Data) {
        $name = [string]$d.Name
        $val  = [string]$d.'#text'
        if ($name) { $ed[$name] = $val }
    }

    $p1 = [string]$xml.Event.UserData.EventXML.Param1
    $p2 = [string]$xml.Event.UserData.EventXML.Param2
    $p3 = [string]$xml.Event.UserData.EventXML.Param3

    if ($p1) { if (-not $ed.ContainsKey('User')      -or [string]::IsNullOrEmpty($ed['User']))      { $ed['User']      = $p1 } }
    if ($p2) { if (-not $ed.ContainsKey('Domain')    -or [string]::IsNullOrEmpty($ed['Domain']))    { $ed['Domain']    = $p2 } }
    if ($p3) { if (-not $ed.ContainsKey('IpAddress') -or [string]::IsNullOrEmpty($ed['IpAddress'])) { $ed['IpAddress'] = $p3 } }

    function Pick([hashtable]$h, [string[]]$keys) {
        foreach ($k in $keys) { if ($h.ContainsKey($k) -and $h[$k]) { return $h[$k] } }
        return $null
    }

    $user   = Pick $ed @('User','TargetUserName','AccountName')
    $domain = Pick $ed @('Domain','TargetDomainName')
    $ip     = Pick $ed @('IpAddress','ClientAddress','Address','SourceNetworkAddress','RemoteAddress')
    $sess   = Pick $ed @('SessionID','SessionId','Session')

    $reason = $null
    if ($Label -eq 'RDPCORE' -and $eventId -eq '140') { $reason = 'Bad username or password' }
    elseif ($Label -eq 'SEC' -and $eventId -eq '4625') { $reason = Pick $ed @('FailureReason','Status','SubStatus') }

    return [pscustomobject]@{
        DetectedAtLocal = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        Channel         = $Label
        EventID         = $eventId
        Result          = $Result
        User            = $user
        Domain          = $domain
        ClientIP        = $ip
        SessionID       = $sess
        TimeCreatedUTC  = $timeUtc
        RecordId        = $recordId
        Computer        = $computer
        Reason          = $reason
    }
}

function Should-Log {
    param([pscustomobject]$Row)

    if ($FilterUser   -and $Row.User     -and ($Row.User     -ne $FilterUser))   { return $false }
    if ($FilterDomain -and $Row.Domain   -and ($Row.Domain   -ne $FilterDomain)) { return $false }
    if ($FilterIP     -and $Row.ClientIP -and ($Row.ClientIP -ne $FilterIP))     { return $false }

    if ($LogOnlyRCMSuccessWithIP) {
        if (($Row.Channel -ne 'RCM') -or ($Row.Result -ne 'SUCCESS')) { return $false }
        if ([string]::IsNullOrWhiteSpace($Row.User))     { return $false }
        if ([string]::IsNullOrWhiteSpace($Row.Domain))   { return $false }
        if ([string]::IsNullOrWhiteSpace($Row.ClientIP)) { return $false }
        return $true
    }

    return $true
}

function Log-AcceptedSummary {
    param([pscustomobject]$Row)
    if ($WriteAcceptedRowsToTextLog) {
        Write-Log ("[ACCEPTED {0} {1}] {2}\{3} from {4} RecID={5} UTC={6}" -f `
            $Row.Channel, $Row.Result, $Row.Domain, $Row.User, $Row.ClientIP, $Row.RecordId, $Row.TimeCreatedUTC)
    }
}

$last = @{}

if (-not $SuppressConsoleAll) {
    Write-Host "[Watch-RdpAccess] start. Interval: ${IntervalSec}s"
}
foreach ($c in $channels) {
    try {
        $ev = Get-WinEvent -LogName $c.Log -FilterXPath $c.XPath -MaxEvents 1 -ErrorAction Stop
        $last[$c.Label] = $ev.RecordId
        if (-not $SuppressConsoleAll) {
            Write-Host "  OK  - $($c.Label): latest RecID=$($ev.RecordId)"
        }
    }
    catch {
        $last[$c.Label] = 0
    }
}

if ($Backfill) {
    foreach ($c in $channels) {
        try {
            $evs = Get-WinEvent -LogName $c.Log -FilterXPath $c.XPath -MaxEvents 50 -ErrorAction Stop |
                   Where-Object { $_.RecordId -gt $last[$c.Label] } |
                   Sort-Object RecordId
            foreach ($e in $evs) {
                $row = Parse-Event -Event $e -Label $c.Label -Result $c.Result

                if (-not (Should-Log -Row $row)) {
                    $last[$c.Label] = $row.RecordId
                    continue
                }

                Log-AcceptedSummary -Row $row
                $last[$c.Label] = $row.RecordId
            }
        } catch {
            if ($WriteErrorsToTextLog) { Write-Log "$($c.Label): backfill error $($_.Exception.Message)" }
        }
    }
}

try {
    while ($true) {
        foreach ($c in $channels) {
            try {
                $evs = Get-WinEvent -LogName $c.Log -FilterXPath $c.XPath -MaxEvents 50 -ErrorAction Stop |
                       Where-Object { $_.RecordId -gt $last[$c.Label] } |
                       Sort-Object RecordId
                foreach ($e in $evs) {
                    $row = Parse-Event -Event $e -Label $c.Label -Result $c.Result

                    if (-not (Should-Log -Row $row)) {
                        $last[$c.Label] = $row.RecordId
                        continue
                    }

                    Log-AcceptedSummary -Row $row
                    $last[$c.Label] = $row.RecordId
                }
            } catch {}
        }
        Start-Sleep -Seconds $IntervalSec
    }
}
catch {
    if ($WriteErrorsToTextLog) { Write-Log "watch loop stopped: $($_.Exception.Message)" }
}
