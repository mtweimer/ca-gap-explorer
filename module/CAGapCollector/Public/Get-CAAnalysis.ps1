#Requires -Version 5.1
<#
.SYNOPSIS
    Analyzes Conditional Access policy coverage and identifies gaps.

.DESCRIPTION
    Provides analysis functions for understanding policy coverage,
    identifying exposures, and summarizing security posture.
#>

<#
.SYNOPSIS
    Gets coverage analysis by grant control or condition.

.PARAMETER GraphPath
    Path to the conditional_access_graph.json file.

.PARAMETER GroupBy
    How to group results: Policy, GrantControl, or Condition.

.PARAMETER OutputFormat
    Output format: Object, Table, or Json.

.EXAMPLE
    Get-CAPolicyCoverage -GraphPath ./output/conditional_access_graph.json
#>
function Get-CAPolicyCoverage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$GraphPath,

        [Parameter()]
        [ValidateSet('Policy', 'GrantControl', 'Condition')]
        [string]$GroupBy = 'GrantControl',

        [Parameter()]
        [ValidateSet('Object', 'Table', 'Json')]
        [string]$OutputFormat = 'Object'
    )

    if (-not (Test-Path -Path $GraphPath)) {
        throw "Graph file not found: $GraphPath"
    }

    $graph = Get-Content -Path $GraphPath -Raw | ConvertFrom-Json -Depth 100

    $policyNodes = $graph.nodes | Where-Object { $_.type -eq 'policy' }
    $userNodes = $graph.nodes | Where-Object { $_.type -eq 'user' }
    $appNodes = $graph.nodes | Where-Object { $_.type -eq 'servicePrincipal' }

    $coverage = [ordered]@{
        totalPolicies = @($policyNodes).Count
        enabledPolicies = @($policyNodes | Where-Object { $_.properties.state -eq 'enabled' }).Count
        reportOnlyPolicies = @($policyNodes | Where-Object { $_.properties.state -eq 'enabledForReportingButNotEnforced' }).Count
        disabledPolicies = @($policyNodes | Where-Object { $_.properties.state -eq 'disabled' }).Count
        totalUsers = @($userNodes).Count
        totalApplications = @($appNodes).Count
        byGrantControl = @{}
        byCondition = @{}
    }

    # Group by grant control
    foreach ($policy in $policyNodes) {
        $controls = $policy.properties.grantControls
        if (-not $controls) { $controls = @('none') }
        
        foreach ($control in $controls) {
            if (-not $coverage.byGrantControl[$control]) {
                $coverage.byGrantControl[$control] = [ordered]@{
                    policyCount = 0
                    policies = @()
                }
            }
            $coverage.byGrantControl[$control].policyCount++
            $coverage.byGrantControl[$control].policies += $policy.label
        }
    }

    # Calculate edges per policy
    $edgesByPolicy = @{}
    foreach ($edge in $graph.edges) {
        if (-not $edgesByPolicy[$edge.from]) {
            $edgesByPolicy[$edge.from] = @{
                includes = @()
                excludes = @()
            }
        }
        if ($edge.relationship -like 'include:*') {
            $edgesByPolicy[$edge.from].includes += $edge
        }
        elseif ($edge.relationship -like 'exclude:*') {
            $edgesByPolicy[$edge.from].excludes += $edge
        }
    }

    $coverage.policyDetails = $policyNodes | ForEach-Object {
        $policyEdges = $edgesByPolicy[$_.id]
        [pscustomobject]@{
            Name = $_.label
            State = $_.properties.state
            GrantControls = ($_.properties.grantControls -join ', ')
            Includes = if ($policyEdges) { $policyEdges.includes.Count } else { 0 }
            Excludes = if ($policyEdges) { $policyEdges.excludes.Count } else { 0 }
        }
    }

    switch ($OutputFormat) {
        'Table' {
            $coverage.policyDetails | Format-Table -AutoSize
        }
        'Json' {
            $coverage | ConvertTo-Json -Depth 10
        }
        default {
            [pscustomobject]$coverage
        }
    }
}

<#
.SYNOPSIS
    Identifies entities not covered by Conditional Access policies.

.PARAMETER GraphPath
    Path to the conditional_access_graph.json file.

.PARAMETER EntityType
    Filter by entity type (User, Group, ServicePrincipal).

.PARAMETER MinimumCoverage
    Flag entities with coverage below this percentage.

.EXAMPLE
    Get-CAExposures -GraphPath ./output/conditional_access_graph.json
#>
function Get-CAExposures {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$GraphPath,

        [Parameter()]
        [ValidateSet('User', 'Group', 'ServicePrincipal', 'All')]
        [string]$EntityType = 'All',

        [Parameter()]
        [int]$MinimumCoverage = 0
    )

    if (-not (Test-Path -Path $GraphPath)) {
        throw "Graph file not found: $GraphPath"
    }

    $graph = Get-Content -Path $GraphPath -Raw | ConvertFrom-Json -Depth 100

    # Find all entities that are targets of policy edges
    $coveredEntities = @{}
    $excludedEntities = @{}

    foreach ($edge in $graph.edges) {
        $scope = ($edge.relationship -split ':')[0]
        $targetId = $edge.to

        if ($scope -eq 'include') {
            if (-not $coveredEntities[$targetId]) {
                $coveredEntities[$targetId] = @{
                    policies = @()
                    count = 0
                }
            }
            $coveredEntities[$targetId].policies += $edge.from
            $coveredEntities[$targetId].count++
        }
        elseif ($scope -eq 'exclude') {
            if (-not $excludedEntities[$targetId]) {
                $excludedEntities[$targetId] = @{
                    policies = @()
                    count = 0
                }
            }
            $excludedEntities[$targetId].policies += $edge.from
            $excludedEntities[$targetId].count++
        }
    }

    # Find uncovered entities
    $exposures = @()
    $typeFilter = switch ($EntityType) {
        'User' { 'user' }
        'Group' { 'group' }
        'ServicePrincipal' { 'servicePrincipal' }
        default { $null }
    }

    foreach ($node in $graph.nodes) {
        if ($node.type -eq 'policy') { continue }
        if ($typeFilter -and $node.type -ne $typeFilter) { continue }

        $isCovered = $coveredEntities.ContainsKey($node.id)
        $isExcluded = $excludedEntities.ContainsKey($node.id)
        $coverageCount = if ($isCovered) { $coveredEntities[$node.id].count } else { 0 }
        $exclusionCount = if ($isExcluded) { $excludedEntities[$node.id].count } else { 0 }

        if (-not $isCovered -or $exclusionCount -gt $coverageCount) {
            $exposures += [pscustomobject]@{
                Id = $node.id
                Name = $node.label
                Type = $node.type
                CoverageCount = $coverageCount
                ExclusionCount = $exclusionCount
                Status = if (-not $isCovered) { 'Uncovered' } else { 'OverExcluded' }
                ExcludedFrom = if ($isExcluded) { $excludedEntities[$node.id].policies -join ', ' } else { '' }
            }
        }
    }

    $exposures | Sort-Object -Property Type, Status, Name
}

<#
.SYNOPSIS
    Collects directory objects for entity resolution.

.PARAMETER OutputPath
    Directory path for output files.

.PARAMETER Types
    Object types to collect. Default is all types.

.EXAMPLE
    Get-DirectoryObjects -OutputPath ./output
#>
function Get-DirectoryObjects {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$OutputPath,

        [Parameter()]
        [ValidateSet('User', 'Group', 'ServicePrincipal', 'Role', 'NamedLocation')]
        [string[]]$Types
    )

    if (-not (Test-CAGapConnection)) {
        throw "Not connected to Microsoft Graph. Use Connect-CAGapGraph first."
    }

    if (-not (Test-Path -Path $OutputPath)) {
        New-Item -Path $OutputPath -ItemType Directory -Force | Out-Null
    }

    $entitiesPath = Join-Path -Path $OutputPath -ChildPath 'entities'
    if (-not (Test-Path -Path $entitiesPath)) {
        New-Item -Path $entitiesPath -ItemType Directory -Force | Out-Null
    }

    $allTypes = @('User', 'Group', 'ServicePrincipal', 'Role', 'NamedLocation')
    $typesToCollect = if ($Types) { $Types } else { $allTypes }

    $counts = [ordered]@{}

    foreach ($type in $typesToCollect) {
        Write-Host "[CAGapCollector] Collecting $type objects..." -ForegroundColor Cyan

        $objects = @()
        try {
            switch ($type) {
                'User' {
                    $users = Get-MgUser -All -Select Id,DisplayName,UserPrincipalName,Mail,AccountEnabled
                    $objects = $users | ForEach-Object {
                        [ordered]@{
                            id = $_.Id
                            displayName = $_.DisplayName
                            userPrincipalName = $_.UserPrincipalName
                            mail = $_.Mail
                            accountEnabled = $_.AccountEnabled
                            type = 'user'
                        }
                    }
                }
                'Group' {
                    $groups = Get-MgGroup -All -Select Id,DisplayName,Mail,SecurityEnabled,GroupTypes
                    $objects = $groups | ForEach-Object {
                        [ordered]@{
                            id = $_.Id
                            displayName = $_.DisplayName
                            mail = $_.Mail
                            securityEnabled = $_.SecurityEnabled
                            groupTypes = $_.GroupTypes
                            type = 'group'
                        }
                    }
                }
                'ServicePrincipal' {
                    $sps = Get-MgServicePrincipal -All -Select Id,DisplayName,AppId,ServicePrincipalType
                    $objects = $sps | ForEach-Object {
                        [ordered]@{
                            id = $_.Id
                            displayName = $_.DisplayName
                            appId = $_.AppId
                            servicePrincipalType = $_.ServicePrincipalType
                            type = 'servicePrincipal'
                        }
                    }
                }
                'Role' {
                    $roles = Get-MgDirectoryRole -All
                    $objects = $roles | ForEach-Object {
                        [ordered]@{
                            id = $_.RoleTemplateId
                            roleId = $_.Id
                            displayName = $_.DisplayName
                            description = $_.Description
                            type = 'role'
                        }
                    }
                }
                'NamedLocation' {
                    $locations = Get-MgIdentityConditionalAccessNamedLocation -All
                    $objects = $locations | ForEach-Object {
                        $locType = $_.AdditionalProperties['@odata.type']
                        [ordered]@{
                            id = $_.Id
                            displayName = $_.DisplayName
                            locationType = if ($locType) { $locType.Split('.')[-1] } else { 'unknown' }
                            type = 'namedLocation'
                        }
                    }
                }
            }
        }
        catch {
            Write-Warning "Failed to collect $type objects: $($_.Exception.Message)"
            continue
        }

        $counts[$type.ToLower()] = @($objects).Count
        
        $filePath = Join-Path -Path $entitiesPath -ChildPath "$($type.ToLower())s.json"
        $objects | ConvertTo-Json -Depth 10 | Out-File -FilePath $filePath -Encoding utf8
        
        Write-Host "[CAGapCollector] Saved $(@($objects).Count) $type objects" -ForegroundColor Green
    }

    # Save counts
    $countsPath = Join-Path -Path $entitiesPath -ChildPath 'counts.json'
    $counts | ConvertTo-Json | Out-File -FilePath $countsPath -Encoding utf8

    return [pscustomobject]@{
        OutputPath = $OutputPath
        Counts = $counts
    }
}

