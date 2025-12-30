param(
    [switch]$SkipConnect,
    [string]$OutputDir = (Join-Path -Path $PSScriptRoot -ChildPath '../output/entities'),
    [string]$PublicDir = (Join-Path -Path $PSScriptRoot -ChildPath '../web/public/entities')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-Dir {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

Ensure-Dir -Path $OutputDir
Ensure-Dir -Path $PublicDir

if (-not $SkipConnect) {
    Write-Host 'Connecting to Microsoft Graph (device code flow)…' -ForegroundColor Cyan
    Connect-MgGraph -Scopes @(
        'Directory.Read.All',
        'Policy.Read.All',
        'Policy.Read.ConditionalAccess'
    ) -ErrorAction Stop | Out-Null
}

try {
    # Users
    Write-Host 'Collecting users…' -ForegroundColor Cyan
    $users = @(Get-MgUser -All -ConsistencyLevel eventual |
        Select-Object id, displayName, userPrincipalName, mail, accountEnabled, createdDateTime)
    $users | ConvertTo-Json -Depth 6 | Out-File (Join-Path $OutputDir 'users.json') -Encoding utf8

    # Groups
    Write-Host 'Collecting groups…' -ForegroundColor Cyan
    $groups = @(Get-MgGroup -All -ConsistencyLevel eventual |
        Select-Object id, displayName, securityEnabled, groupTypes, mailNickname)
    $groups | ConvertTo-Json -Depth 6 | Out-File (Join-Path $OutputDir 'groups.json') -Encoding utf8

    # Service Principals
    Write-Host 'Collecting service principals…' -ForegroundColor Cyan
    $sps = @(Get-MgServicePrincipal -All -ConsistencyLevel eventual |
        Select-Object id, displayName, appId, servicePrincipalType)
    $sps | ConvertTo-Json -Depth 6 | Out-File (Join-Path $OutputDir 'service_principals.json') -Encoding utf8

    # Directory roles (active)
    Write-Host 'Collecting directory roles…' -ForegroundColor Cyan
    $roles = Get-MgDirectoryRole -All | Select-Object id, displayName
    $roles | ConvertTo-Json -Depth 4 | Out-File (Join-Path $OutputDir 'roles.json') -Encoding utf8

    # Named locations
    Write-Host 'Collecting named locations…' -ForegroundColor Cyan
    $rawLocs = Get-MgIdentityConditionalAccessNamedLocation -All
    $locs = @()
    foreach ($loc in $rawLocs) {
        # Properties might be in AdditionalProperties depending on SDK version
        $isTrusted = if ($loc.PSObject.Properties['IsTrusted']) { $loc.IsTrusted } else { $loc.AdditionalProperties['isTrusted'] }
        $countries = if ($loc.PSObject.Properties['CountriesAndRegions']) { $loc.CountriesAndRegions } else { $loc.AdditionalProperties['countriesAndRegions'] }
        $ipRanges = if ($loc.PSObject.Properties['IpRanges']) { $loc.IpRanges } else { $loc.AdditionalProperties['ipRanges'] }
        
        $locs += [PSCustomObject]@{
            id = $loc.Id
            displayName = $loc.DisplayName
            isTrusted = $isTrusted
            countriesAndRegions = $countries
            ipRanges = $ipRanges
        }
    }
    $locs | ConvertTo-Json -Depth 8 | Out-File (Join-Path $OutputDir 'named_locations.json') -Encoding utf8

    # Optional applications (for appId→name mapping)
    Write-Host 'Collecting applications (optional)…' -ForegroundColor DarkGray
    try {
        $apps = Get-MgApplication -All -ConsistencyLevel eventual |
            Select-Object id, displayName, appId
    } catch { $apps = @() }
    $apps | ConvertTo-Json -Depth 4 | Out-File (Join-Path $OutputDir 'applications.json') -Encoding utf8

    # Counts summary
    $counts = [ordered]@{
        users            = $users.Count
        groups           = $groups.Count
        roles            = @($roles).Count
        servicePrincipals= $sps.Count
        applications     = @($apps).Count
        namedLocations   = @($locs).Count
    }
    $counts | ConvertTo-Json | Out-File (Join-Path $OutputDir 'counts.json') -Encoding utf8

    # Mirror to web/public for UI
    Get-ChildItem -LiteralPath $OutputDir -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $PublicDir $_.Name) -Force
    }

    Write-Host "Export complete. Files written to:`n  $OutputDir`nMirrored to:`n  $PublicDir" -ForegroundColor Green
} finally {
    if (-not $SkipConnect) { Disconnect-MgGraph | Out-Null }
}


