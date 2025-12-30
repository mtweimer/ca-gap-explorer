#Requires -Version 5.1
<#
.SYNOPSIS
    Collects Conditional Access policies and expands all relationships.

.DESCRIPTION
    Retrieves all Conditional Access policies from Microsoft Graph and resolves
    all user, group, role, application, and location assignments.

.PARAMETER OutputPath
    Directory path for output files.

.PARAMETER ExpandGroups
    Expand group memberships. Default is true.

.PARAMETER ExpandRoles
    Expand role assignments. Default is true.

.PARAMETER MaxDepth
    Maximum nesting depth for group expansion. Default is 3.

.PARAMETER PolicyFilter
    ScriptBlock to filter policies.

.EXAMPLE
    Get-CAPolicies -OutputPath ./output
    
    Collects all policies and saves to ./output.

.EXAMPLE
    Get-CAPolicies -OutputPath ./output -ExpandGroups:$false
    
    Collects policies without expanding group memberships.
#>
function Get-CAPolicies {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$OutputPath,

        [Parameter()]
        [bool]$ExpandGroups = $true,

        [Parameter()]
        [bool]$ExpandRoles = $true,

        [Parameter()]
        [int]$MaxDepth = 3,

        [Parameter()]
        [scriptblock]$PolicyFilter
    )

    # Verify connection
    if (-not (Test-CAGapConnection)) {
        throw "Not connected to Microsoft Graph. Use Connect-CAGapGraph first."
    }

    # Ensure output directory exists
    if (-not (Test-Path -Path $OutputPath)) {
        New-Item -Path $OutputPath -ItemType Directory -Force | Out-Null
    }

    $entitiesPath = Join-Path -Path $OutputPath -ChildPath 'entities'
    if (-not (Test-Path -Path $entitiesPath)) {
        New-Item -Path $entitiesPath -ItemType Directory -Force | Out-Null
    }

    # Clear relationship cache for fresh collection
    Clear-RelationshipCache

    # Get context info
    $context = Get-MgContext

    Write-Host "[CAGapCollector] Retrieving Conditional Access policies..." -ForegroundColor Cyan

    # Collect policies
    $policies = @()
    try {
        $policies = Get-MgIdentityConditionalAccessPolicy -All -ErrorAction Stop
    }
    catch {
        throw "Failed to retrieve policies: $($_.Exception.Message)"
    }

    # Apply filter if provided
    if ($PolicyFilter) {
        $policies = $policies | Where-Object $PolicyFilter
    }

    $totalPolicies = @($policies).Count
    Write-Host "[CAGapCollector] Retrieved $totalPolicies policies." -ForegroundColor Green

    # Initialize analysis structure
    $analysis = [ordered]@{
        generatedAt = (Get-Date).ToString('o')
        metadata = [ordered]@{
            account = $context.Account
            tenantId = $context.TenantId
            scopes = $context.Scopes
            policyCount = $totalPolicies
        }
        policies = [System.Collections.ArrayList]@()
        entities = [ordered]@{
            users = @{}
            groups = @{}
            roles = @{}
            servicePrincipals = @{}
            namedLocations = @{}
            devices = @{}
            keywords = @{}
        }
        relationships = [System.Collections.ArrayList]@()
    }

    # Process each policy
    $policyIndex = 0
    foreach ($policy in $policies) {
        $policyIndex++
        $percent = if ($totalPolicies -gt 0) { [int](($policyIndex / $totalPolicies) * 100) } else { 100 }
        Write-Progress -Activity 'Collecting Conditional Access policies' -Status "$policyIndex of $totalPolicies" -PercentComplete $percent

        if (($policyIndex % 5) -eq 0 -or $policyIndex -eq 1 -or $policyIndex -eq $totalPolicies) {
            Write-Verbose "Processing policy $policyIndex/$totalPolicies: $($policy.DisplayName)"
        }

        $policySummary = [ordered]@{
            id = $policy.Id
            displayName = $policy.DisplayName
            state = $policy.State
            createdDateTime = $policy.CreatedDateTime
            modifiedDateTime = $policy.ModifiedDateTime
            description = $policy.Description
        }

        # Process conditions
        $conditions = $policy.Conditions
        $grantControls = Build-GrantSummary -GrantControls $policy.GrantControls
        $sessionControls = Build-SessionSummary -SessionControls $policy.SessionControls

        # Resolve user conditions
        $usersCondition = $conditions.Users
        if ($usersCondition) {
            $includeUsers = Resolve-UserAssignments -Values $usersCondition.IncludeUsers -Scope 'include' -PolicySummary $policySummary -Analysis $analysis
            $excludeUsers = Resolve-UserAssignments -Values $usersCondition.ExcludeUsers -Scope 'exclude' -PolicySummary $policySummary -Analysis $analysis

            if ($ExpandGroups) {
                $includeGroups = Resolve-GroupAssignments -Values $usersCondition.IncludeGroups -Scope 'include' -PolicySummary $policySummary -Analysis $analysis
                $excludeGroups = Resolve-GroupAssignments -Values $usersCondition.ExcludeGroups -Scope 'exclude' -PolicySummary $policySummary -Analysis $analysis
            }
            else {
                $includeGroups = @{ keywords = @(); entities = @() }
                $excludeGroups = @{ keywords = @(); entities = @() }
            }

            if ($ExpandRoles) {
                $includeRoles = Resolve-RoleAssignments -Values $usersCondition.IncludeRoles -Scope 'include' -PolicySummary $policySummary -Analysis $analysis
                $excludeRoles = Resolve-RoleAssignments -Values $usersCondition.ExcludeRoles -Scope 'exclude' -PolicySummary $policySummary -Analysis $analysis
            }
            else {
                $includeRoles = @{ keywords = @(); entities = @() }
                $excludeRoles = @{ keywords = @(); entities = @() }
            }
        }
        else {
            $includeUsers = @{ keywords = @(); entities = @() }
            $excludeUsers = @{ keywords = @(); entities = @() }
            $includeGroups = @{ keywords = @(); entities = @() }
            $excludeGroups = @{ keywords = @(); entities = @() }
            $includeRoles = @{ keywords = @(); entities = @() }
            $excludeRoles = @{ keywords = @(); entities = @() }
        }

        # Resolve application conditions
        $appsCondition = $conditions.Applications
        if ($appsCondition) {
            $includeApplications = Resolve-ApplicationAssignments -Values $appsCondition.IncludeApplications -Scope 'include' -PolicySummary $policySummary -Analysis $analysis
            $excludeApplications = Resolve-ApplicationAssignments -Values $appsCondition.ExcludeApplications -Scope 'exclude' -PolicySummary $policySummary -Analysis $analysis
        }
        else {
            $includeApplications = @{ keywords = @(); entities = @() }
            $excludeApplications = @{ keywords = @(); entities = @() }
        }

        # Resolve location conditions
        $locationsCondition = $conditions.Locations
        if ($locationsCondition) {
            $includeLocations = Resolve-NamedLocationAssignments -Values $locationsCondition.IncludeLocations -Scope 'include' -PolicySummary $policySummary -Analysis $analysis
            $excludeLocations = Resolve-NamedLocationAssignments -Values $locationsCondition.ExcludeLocations -Scope 'exclude' -PolicySummary $policySummary -Analysis $analysis
        }
        else {
            $includeLocations = @{ keywords = @(); entities = @() }
            $excludeLocations = @{ keywords = @(); entities = @() }
        }

        # Build policy summary
        $policySummary.assignments = [ordered]@{
            include = [ordered]@{
                users = $includeUsers
                groups = $includeGroups
                roles = $includeRoles
            }
            exclude = [ordered]@{
                users = $excludeUsers
                groups = $excludeGroups
                roles = $excludeRoles
            }
        }

        $policySummary.targetResources = [ordered]@{
            applications = [ordered]@{
                include = $includeApplications
                exclude = $excludeApplications
                includeUserActions = To-Array $appsCondition.IncludeUserActions
                excludeUserActions = To-Array $appsCondition.ExcludeUserActions
                includeAuthenticationContextClassReferences = To-Array $appsCondition.IncludeAuthenticationContextClassReferences
            }
        }

        $policySummary.conditions = [ordered]@{
            clientAppTypes = To-Array $conditions.ClientAppTypes
            platforms = [ordered]@{
                include = To-Array $conditions.Platforms.IncludePlatforms
                exclude = To-Array $conditions.Platforms.ExcludePlatforms
            }
            signInRiskLevels = To-Array $conditions.SignInRiskLevels
            userRiskLevels = To-Array $conditions.UserRiskLevels
            locations = [ordered]@{
                include = $includeLocations
                exclude = $excludeLocations
            }
        }

        $policySummary.accessControls = [ordered]@{
            grant = $grantControls
            session = $sessionControls
        }

        [void]$analysis.policies.Add($policySummary)
    }

    Write-Progress -Activity 'Collecting Conditional Access policies' -Completed

    # Save outputs
    $jsonPath = Join-Path -Path $OutputPath -ChildPath 'conditional_access_policies.json'
    $analysis | ConvertTo-Json -Depth 20 | Out-File -FilePath $jsonPath -Encoding utf8
    Write-Host "[CAGapCollector] Saved policies to: $jsonPath" -ForegroundColor Green

    # Save entity files
    foreach ($entityType in $analysis.entities.Keys) {
        $entityPath = Join-Path -Path $entitiesPath -ChildPath "$entityType.json"
        $analysis.entities[$entityType] | ConvertTo-Json -Depth 10 | Out-File -FilePath $entityPath -Encoding utf8
    }

    # Save counts
    $counts = [ordered]@{
        users = $analysis.entities.users.Count
        groups = $analysis.entities.groups.Count
        roles = $analysis.entities.roles.Count
        servicePrincipals = $analysis.entities.servicePrincipals.Count
        namedLocations = $analysis.entities.namedLocations.Count
        policies = $totalPolicies
        relationships = $analysis.relationships.Count
    }
    $countsPath = Join-Path -Path $entitiesPath -ChildPath 'counts.json'
    $counts | ConvertTo-Json | Out-File -FilePath $countsPath -Encoding utf8

    Write-Host "[CAGapCollector] Collection complete!" -ForegroundColor Green
    Write-Host "  Policies: $totalPolicies" -ForegroundColor Cyan
    Write-Host "  Relationships: $($analysis.relationships.Count)" -ForegroundColor Cyan

    return [pscustomobject]@{
        OutputPath = $OutputPath
        PolicyCount = $totalPolicies
        RelationshipCount = $analysis.relationships.Count
        Entities = $counts
    }
}

# Helper functions for Get-CAPolicies

function Build-GrantSummary {
    param($GrantControls)
    if (-not $GrantControls) { return $null }

    [ordered]@{
        operator = $GrantControls.Operator
        builtInControls = To-Array $GrantControls.BuiltInControls
        termsOfUse = To-Array $GrantControls.TermsOfUse
        customAuthenticationFactors = To-Array $GrantControls.CustomAuthenticationFactors
        authenticationStrength = if ($GrantControls.AuthenticationStrength) {
            [ordered]@{
                id = $GrantControls.AuthenticationStrength.Id
                displayName = $GrantControls.AuthenticationStrength.DisplayName
            }
        } else { $null }
    }
}

function Build-SessionSummary {
    param($SessionControls)
    if (-not $SessionControls) { return $null }

    $summary = [ordered]@{}

    if ($SessionControls.SignInFrequency) {
        $summary.signInFrequency = [ordered]@{
            value = $SessionControls.SignInFrequency.Value
            type = $SessionControls.SignInFrequency.Type
            isEnabled = $SessionControls.SignInFrequency.IsEnabled
        }
    }

    if ($SessionControls.PersistentBrowser) {
        $summary.persistentBrowser = [ordered]@{
            mode = $SessionControls.PersistentBrowser.Mode
            isEnabled = $SessionControls.PersistentBrowser.IsEnabled
        }
    }

    if ($SessionControls.CloudAppSecurity) {
        $summary.cloudAppSecurity = [ordered]@{
            cloudAppSecurityType = $SessionControls.CloudAppSecurity.CloudAppSecurityType
            isEnabled = $SessionControls.CloudAppSecurity.IsEnabled
        }
    }

    return $summary
}

function Resolve-UserAssignments {
    param([string[]]$Values, [string]$Scope, [hashtable]$PolicySummary, [hashtable]$Analysis)
    
    $result = @{ keywords = @(); entities = @() }
    
    foreach ($value in (To-Array $Values)) {
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        
        if ($value -match '^[0-9a-fA-F-]{32,36}$') {
            $user = Get-UserById $value
            if ($user) {
                $result.entities += $user
                Add-Entity -Analysis $Analysis -CollectionName 'users' -Entity (ConvertTo-OrderedHashtable $user)
                Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'user' -TargetId $user.id -TargetDisplayName $user.displayName
            }
        }
        else {
            $result.keywords += $value
            Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'keyword' -TargetId $value -TargetDisplayName $value
        }
    }
    
    return $result
}

function Resolve-GroupAssignments {
    param([string[]]$Values, [string]$Scope, [hashtable]$PolicySummary, [hashtable]$Analysis)
    
    $result = @{ keywords = @(); entities = @() }
    
    foreach ($value in (To-Array $Values)) {
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        
        if ($value -match '^[0-9a-fA-F-]{32,36}$') {
            $group = Get-GroupById $value
            $members = Get-GroupMembersExpanded $value
            
            if ($group) {
                $groupEntity = [pscustomobject]@{
                    id = $group.id
                    displayName = $group.displayName
                    memberCount = @($members | Where-Object { $_.type -ne 'group' }).Count
                    members = $members
                    type = 'group'
                }
                $result.entities += $groupEntity
                Add-Entity -Analysis $Analysis -CollectionName 'groups' -Entity (ConvertTo-OrderedHashtable $groupEntity)
                Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'group' -TargetId $group.id -TargetDisplayName $group.displayName
                
                # Add member relationships
                foreach ($member in $members) {
                    if ($member.type -eq 'user') {
                        Add-Entity -Analysis $Analysis -CollectionName 'users' -Entity (ConvertTo-OrderedHashtable $member)
                        Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'user' -TargetId $member.id -TargetDisplayName $member.displayName -Via $member.via
                    }
                }
            }
        }
        else {
            $result.keywords += $value
        }
    }
    
    return $result
}

function Resolve-RoleAssignments {
    param([string[]]$Values, [string]$Scope, [hashtable]$PolicySummary, [hashtable]$Analysis)
    
    $result = @{ keywords = @(); entities = @() }
    Initialize-RoleTemplates
    
    foreach ($value in (To-Array $Values)) {
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        
        if ($script:RoleTemplateCache.ContainsKey($value)) {
            $role = $script:RoleTemplateCache[$value]
            $members = Get-RoleMembersExpanded -RoleTemplateId $value
            
            $roleEntity = [pscustomobject]@{
                id = $role.id
                displayName = $role.displayName
                description = $role.description
                memberCount = @($members).Count
                members = $members
                type = 'role'
            }
            $result.entities += $roleEntity
            Add-Entity -Analysis $Analysis -CollectionName 'roles' -Entity (ConvertTo-OrderedHashtable $roleEntity)
            Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'role' -TargetId $role.id -TargetDisplayName $role.displayName
            
            foreach ($member in $members) {
                Add-Entity -Analysis $Analysis -CollectionName 'users' -Entity $member
                Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'user' -TargetId $member.id -TargetDisplayName $member.displayName -Via @($role.displayName)
            }
        }
        else {
            $result.keywords += $value
        }
    }
    
    return $result
}

function Resolve-ApplicationAssignments {
    param([string[]]$Values, [string]$Scope, [hashtable]$PolicySummary, [hashtable]$Analysis)
    
    $result = @{ keywords = @(); entities = @() }
    
    foreach ($value in (To-Array $Values)) {
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        
        if ($value -match '^[0-9a-fA-F-]{32,36}$') {
            $sp = Get-ServicePrincipalById $value
            if ($sp) {
                $result.entities += $sp
                Add-Entity -Analysis $Analysis -CollectionName 'servicePrincipals' -Entity (ConvertTo-OrderedHashtable $sp)
                Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'servicePrincipal' -TargetId $sp.id -TargetDisplayName $sp.displayName
            }
        }
        else {
            $result.keywords += $value
            Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'keyword' -TargetId $value -TargetDisplayName $value
        }
    }
    
    return $result
}

function Resolve-NamedLocationAssignments {
    param([string[]]$Values, [string]$Scope, [hashtable]$PolicySummary, [hashtable]$Analysis)
    
    $result = @{ keywords = @(); entities = @() }
    
    foreach ($value in (To-Array $Values)) {
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        
        if ($value -match '^[0-9a-fA-F-]{32,36}$') {
            $location = Get-NamedLocationById $value
            if ($location) {
                $result.entities += [pscustomobject]$location
                Add-Entity -Analysis $Analysis -CollectionName 'namedLocations' -Entity $location
                Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'namedLocation' -TargetId $location.id -TargetDisplayName $location.displayName
            }
        }
        else {
            $result.keywords += $value
            Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'keyword' -TargetId $value -TargetDisplayName $value
        }
    }
    
    return $result
}

