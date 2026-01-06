#Requires -Version 5.1
<#
.SYNOPSIS
    Resolves nested group memberships recursively.

.DESCRIPTION
    Functions for resolving nested group members with cycle detection,
    based on the EntraNesting approach.
#>

<#
.SYNOPSIS
    Recursively resolves all members of a group, including nested group members.

.PARAMETER GroupId
    The ID of the group to resolve.

.PARAMETER GroupMembersCache
    A hashtable cache of already-resolved group members to avoid redundant API calls.

.PARAMETER Visited
    A hashtable tracking visited groups to detect cycles.

.PARAMETER MaxDepth
    Maximum recursion depth (default 10).

.PARAMETER CurrentDepth
    Current recursion depth (internal use).

.EXAMPLE
    $nestedMembers = Resolve-NestedGroupMembers -GroupId "abc123" -GroupMembersCache @{}
#>
function Resolve-NestedGroupMembers {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$GroupId,

        [Parameter()]
        [hashtable]$GroupMembersCache = @{},

        [Parameter()]
        [hashtable]$Visited = @{},

        [Parameter()]
        [int]$MaxDepth = 10,

        [Parameter()]
        [int]$CurrentDepth = 0
    )

    # Cycle detection
    if ($Visited.ContainsKey($GroupId)) {
        Write-Verbose "Cycle detected for group $GroupId, skipping"
        return @{
            directMembers = @()
            nestedMembers = @()
            nestedGroups = @()
            cycleDetected = $true
        }
    }

    # Max depth check
    if ($CurrentDepth -ge $MaxDepth) {
        Write-Verbose "Max depth $MaxDepth reached for group $GroupId"
        return @{
            directMembers = @()
            nestedMembers = @()
            nestedGroups = @()
            maxDepthReached = $true
        }
    }

    # Mark as visited
    $Visited[$GroupId] = $true

    $result = @{
        directMembers = @()
        nestedMembers = @()
        nestedGroups = @()
        totalMemberCount = 0
    }

    # Get direct members (use cache if available)
    $directMembers = @()
    if ($GroupMembersCache.ContainsKey($GroupId)) {
        $directMembers = $GroupMembersCache[$GroupId]
    }
    else {
        try {
            $members = Get-MgGroupMember -GroupId $GroupId -All
            $directMembers = @($members | ForEach-Object {
                $odataType = $_.AdditionalProperties['@odata.type']
                $memberType = switch ($odataType) {
                    '#microsoft.graph.user' { 'user' }
                    '#microsoft.graph.group' { 'group' }
                    '#microsoft.graph.servicePrincipal' { 'servicePrincipal' }
                    '#microsoft.graph.device' { 'device' }
                    default { 'unknown' }
                }
                [ordered]@{
                    id = $_.Id
                    displayName = $_.AdditionalProperties['displayName']
                    type = $memberType
                }
            })
            $GroupMembersCache[$GroupId] = $directMembers
        }
        catch {
            Write-Verbose "Could not get members for group $GroupId`: $($_.Exception.Message)"
            return $result
        }
    }

    $result.directMembers = $directMembers

    # Separate group members from non-group members
    $nestedGroupMembers = @($directMembers | Where-Object { $_.type -eq 'group' })
    $nonGroupMembers = @($directMembers | Where-Object { $_.type -ne 'group' })

    # Track all unique members (by ID)
    $allMembersById = @{}
    foreach ($member in $nonGroupMembers) {
        $allMembersById[$member.id] = $member
    }

    # Recursively resolve nested groups
    foreach ($nestedGroup in $nestedGroupMembers) {
        $result.nestedGroups += [ordered]@{
            id = $nestedGroup.id
            displayName = $nestedGroup.displayName
            depth = $CurrentDepth + 1
        }

        $nestedResult = Resolve-NestedGroupMembers `
            -GroupId $nestedGroup.id `
            -GroupMembersCache $GroupMembersCache `
            -Visited $Visited.Clone() `
            -MaxDepth $MaxDepth `
            -CurrentDepth ($CurrentDepth + 1)

        # Add nested members (avoid duplicates)
        foreach ($nestedMember in $nestedResult.directMembers) {
            if ($nestedMember.type -ne 'group' -and -not $allMembersById.ContainsKey($nestedMember.id)) {
                $allMembersById[$nestedMember.id] = [ordered]@{
                    id = $nestedMember.id
                    displayName = $nestedMember.displayName
                    type = $nestedMember.type
                    fromGroup = $nestedGroup.displayName
                    depth = $CurrentDepth + 1
                }
            }
        }

        # Also add deeply nested members
        foreach ($deepMember in $nestedResult.nestedMembers) {
            if (-not $allMembersById.ContainsKey($deepMember.id)) {
                $allMembersById[$deepMember.id] = $deepMember
            }
        }

        # Add nested groups info
        $result.nestedGroups += $nestedResult.nestedGroups
    }

    # Nested members are all except direct non-group members
    $directIds = @($nonGroupMembers | ForEach-Object { $_.id })
    $result.nestedMembers = @($allMembersById.Values | Where-Object { $_.id -notin $directIds })
    $result.totalMemberCount = $allMembersById.Count

    return $result
}

<#
.SYNOPSIS
    Adds nested member information to a collection of groups.

.PARAMETER Groups
    Array of group objects with members already populated.

.EXAMPLE
    $groupsWithNesting = Add-NestedGroupInfo -Groups $groups
#>
function Add-NestedGroupInfo {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [array]$Groups
    )

    Write-Host "[CAGapCollector] Resolving nested group memberships..." -ForegroundColor Cyan

    # Build a cache of group members for efficiency
    $memberCache = @{}
    foreach ($group in $Groups) {
        if ($group.members) {
            $memberCache[$group.id] = $group.members
        }
    }

    $totalGroups = @($Groups).Count
    $processedCount = 0

    $enrichedGroups = foreach ($group in $Groups) {
        $processedCount++
        
        # Only resolve nesting for security groups (more likely to have nesting)
        if ($group.securityEnabled -and $group.members -and @($group.members | Where-Object { $_.type -eq 'group' }).Count -gt 0) {
            Write-Verbose "Resolving nesting for group: $($group.displayName)"
            
            $nestedInfo = Resolve-NestedGroupMembers -GroupId $group.id -GroupMembersCache $memberCache
            
            $group['nestedMembers'] = $nestedInfo.nestedMembers
            $group['nestedMemberCount'] = $nestedInfo.nestedMembers.Count
            $group['nestedGroups'] = $nestedInfo.nestedGroups
            $group['totalMemberCount'] = $nestedInfo.totalMemberCount
            $group['hasNesting'] = ($nestedInfo.nestedGroups.Count -gt 0)
        }
        else {
            $group['nestedMembers'] = @()
            $group['nestedMemberCount'] = 0
            $group['nestedGroups'] = @()
            $group['totalMemberCount'] = $group.memberCount
            $group['hasNesting'] = $false
        }
        
        $group
    }

    $nestedCount = @($enrichedGroups | Where-Object { $_.hasNesting }).Count
    Write-Host "[CAGapCollector] Found $nestedCount groups with nested memberships" -ForegroundColor Green

    return $enrichedGroups
}

