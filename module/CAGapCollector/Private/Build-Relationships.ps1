#Requires -Version 5.1
<#
.SYNOPSIS
    Internal functions for building policy relationships and expanding memberships.
#>

$script:RelationshipKeyCache = [System.Collections.Generic.HashSet[string]]::new()

function Add-Entity {
    <#
    .SYNOPSIS
        Adds an entity to the analysis entities collection.
    #>
    param(
        [Parameter(Mandatory)] $Analysis,
        [Parameter(Mandatory)] [string]$CollectionName,
        [Parameter(Mandatory)] $Entity
    )

    # Get entity ID - handle both hashtable and PSObject
    $entityId = $null
    if ($Entity -is [System.Collections.IDictionary]) {
        $entityId = $Entity['id']
    } elseif ($Entity -is [psobject]) {
        $entityId = $Entity.id
    }
    
    if (-not $entityId) { return }

    # Check if collection exists using Contains (works for both Hashtable and OrderedDictionary)
    if (-not ($Analysis.entities.Contains($CollectionName))) {
        $Analysis.entities[$CollectionName] = @{}
    }

    $collection = $Analysis.entities[$CollectionName]
    if (-not ($collection.Contains($entityId))) {
        $collection[$entityId] = $Entity
    }
}

function Add-Relationship {
    <#
    .SYNOPSIS
        Adds a relationship to the analysis relationships collection.
    #>
    param(
        $Analysis,
        [string]$PolicyId,
        [string]$PolicyName,
        [string]$Scope,
        [string]$TargetType,
        [string]$TargetId,
        [string]$TargetDisplayName,
        [string[]]$Via,
        [string]$Description
    )

    if ($null -eq $Analysis.relationships) {
        $Analysis.relationships = [System.Collections.ArrayList]@()
    }

    $viaKey = if ($Via) { ($Via -join ' > ') } else { '' }
    $key = "$PolicyId|$Scope|$TargetType|$TargetId|$viaKey"

    if ($script:RelationshipKeyCache.Add($key)) {
        # Item was added (wasn't already present)
        $relationship = [ordered]@{
            policyId = $PolicyId
            policyName = $PolicyName
            scope = $Scope
            targetType = $TargetType
            targetId = $TargetId
            targetDisplayName = $TargetDisplayName
            via = if ($Via) { @($Via) } else { $null }
        }

        if ($Description) {
            $relationship.description = $Description
        }

        [void]$Analysis.relationships.Add($relationship)
    }
}

function Expand-GroupMembersInternal {
    <#
    .SYNOPSIS
        Recursively expands group members.
    #>
    param(
        [string]$GroupId,
        [string[]]$Path,
        [hashtable]$Visited
    )

    $results = @()

    if (-not $Visited) {
        $Visited = @{}
    }

    if ($Visited.ContainsKey($GroupId)) {
        return $results
    }

    $Visited[$GroupId] = $true

    $group = Get-GroupById $GroupId
    $currentPath = @()
    if ($Path) {
        $currentPath += $Path
    }
    if ($group -and $group.displayName) {
        $currentPath += $group.displayName
    }
    else {
        $currentPath += $GroupId
    }

    $members = @()
    try {
        $parameters = @{
            GroupId = $GroupId
            All     = $true
        }
        $members = Get-MgGroupMember @parameters -ErrorAction Stop
    }
    catch {
        Write-Verbose "Failed to enumerate members for group $($GroupId): $($_.Exception.Message)"
        return $results
    }

    foreach ($member in $members) {
        if (-not $member) { continue }

        $props = $member.AdditionalProperties
        $odataType = $props['@odata.type']

        switch ($odataType) {
            '#microsoft.graph.user' {
                $user = Get-UserById $member.Id
                if ($user) {
                    $results += [pscustomobject]@{
                        id = $user.id
                        type = 'user'
                        displayName = $user.displayName
                        userPrincipalName = $user.userPrincipalName
                        mail = $user.mail
                        via = @($currentPath)
                    }
                }
            }
            '#microsoft.graph.group' {
                $childGroup = Get-GroupById $member.Id
                $displayName = if ($childGroup) { $childGroup.displayName } else { $props['displayName'] }

                $results += [pscustomobject]@{
                    id = $member.Id
                    type = 'group'
                    displayName = $displayName
                    via = @($currentPath)
                }

                $nested = Expand-GroupMembersInternal -GroupId $member.Id -Path $currentPath -Visited $Visited
                if ($nested) {
                    $results += $nested
                }
            }
            '#microsoft.graph.servicePrincipal' {
                $sp = Get-ServicePrincipalById $member.Id
                if ($sp) {
                    $results += [pscustomobject]@{
                        id = $sp.id
                        type = 'servicePrincipal'
                        displayName = $sp.displayName
                        appId = $sp.appId
                        via = @($currentPath)
                    }
                }
            }
            '#microsoft.graph.device' {
                $results += [pscustomobject]@{
                    id = $member.Id
                    type = 'device'
                    displayName = $props['displayName']
                    operatingSystem = $props['operatingSystem']
                    trustType = $props['trustType']
                    via = @($currentPath)
                }
            }
            default {
                $results += [pscustomobject]@{
                    id = $member.Id
                    type = if ($odataType) { $odataType.TrimStart('#microsoft.graph.') } else { 'unknown' }
                    displayName = $props['displayName']
                    via = @($currentPath)
                    rawType = $odataType
                }
            }
        }
    }

    return $results
}

function Get-GroupMembersExpanded {
    <#
    .SYNOPSIS
        Gets expanded group members with caching.
    #>
    param([string]$GroupId)

    if (-not $GroupId) { return @() }

    if ($script:GroupMembersCache.ContainsKey($GroupId)) {
        return $script:GroupMembersCache[$GroupId]
    }

    $members = Expand-GroupMembersInternal -GroupId $GroupId -Path @() -Visited @{}
    $script:GroupMembersCache[$GroupId] = $members
    return $members
}

function Get-RoleMembersExpanded {
    <#
    .SYNOPSIS
        Gets expanded role members with caching.
    #>
    param([string]$RoleTemplateId)

    if (-not $RoleTemplateId) { return @() }

    if ($script:RoleMembersCache.ContainsKey($RoleTemplateId)) {
        return $script:RoleMembersCache[$RoleTemplateId]
    }

    $members = @()

    try {
        $activatedRole = Get-MgDirectoryRole -All | Where-Object { $_.RoleTemplateId -eq $RoleTemplateId } | Select-Object -First 1
        
        if ($activatedRole) {
            $roleMembers = Get-MgDirectoryRoleMember -DirectoryRoleId $activatedRole.Id -All -ErrorAction SilentlyContinue
            
            foreach ($member in $roleMembers) {
                if ($member.AdditionalProperties -and $member.AdditionalProperties['@odata.type'] -eq '#microsoft.graph.user') {
                    $user = Get-UserById $member.Id
                    if ($user) {
                        $members += [ordered]@{
                            id = $user.id
                            type = 'user'
                            displayName = $user.displayName
                            userPrincipalName = $user.userPrincipalName
                            mail = $user.mail
                            via = @($activatedRole.DisplayName)
                        }
                    }
                }
            }
        }
    }
    catch {
        Write-Verbose "Failed to expand members for role template $($RoleTemplateId): $($_.Exception.Message)"
    }

    $script:RoleMembersCache[$RoleTemplateId] = $members
    return $members
}

function Clear-RelationshipCache {
    <#
    .SYNOPSIS
        Clears the relationship deduplication cache.
    #>
    $script:RelationshipKeyCache.Clear()
}

