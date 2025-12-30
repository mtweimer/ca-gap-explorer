[CmdletBinding()]
param(
    [string]$OutputDir = $env:OUTPUT_DIR,
    [string[]]$Scopes = @(
        'Policy.Read.All',
        'Directory.Read.All',
        'Group.Read.All',
        'Application.Read.All',
        'RoleManagement.Read.Directory'
    ),
    [string]$TenantId,
    [string]$RawPoliciesPath,
    [string]$RawNamedLocationsPath,
    [switch]$UseDeviceCode,
    [switch]$SkipConnect,
    [switch]$SkipDisconnect,
    [switch]$ExportSubset
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$WarningPreference = 'Continue'
$InformationPreference = 'Continue'

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message"
}

function Write-Success {
    param([string]$Message)
    Write-Host "[ OK ] $Message" -ForegroundColor Green
}

function Write-ErrorMessage {
    param([string]$Message)
    Write-Host "[ERR ] $Message" -ForegroundColor Red
}

function Get-PropertyValue {
    param(
        [object]$Object,
        [string]$PropertyName
    )

    if (-not $Object) { return $null }
    if (-not $PropertyName) { return $null }

    # IDictionary (e.g., OrderedDictionary)
    if ($Object -is [System.Collections.IDictionary]) {
        $dict = [System.Collections.IDictionary]$Object
        if ($dict.Contains($PropertyName)) { return $dict[$PropertyName] }
        # case-insensitive lookup
        foreach ($key in $dict.Keys) {
            if ([string]::Equals([string]$key, $PropertyName, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $dict[$key]
            }
        }
        return $null
    }

    # PSObject property
    $property = $Object.PSObject.Properties[$PropertyName]
    if ($property) { return $property.Value }

    # case-insensitive PSObject lookup
    foreach ($prop in $Object.PSObject.Properties) {
        if ([string]::Equals($prop.Name, $PropertyName, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $prop.Value
        }
    }

    return $null
}

function To-Array {
    param($Value)
    if ($null -eq $Value) {
        return @()
    }
    if ($Value -is [string]) {
        return @($Value)
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        return @($Value)
    }
    return @($Value)
}

function ConvertTo-OrderedHashtable {
    param([psobject]$Object)

    $hash = [ordered]@{}
    if (-not $Object) {
        return $hash
    }

    foreach ($prop in $Object.PSObject.Properties) {
        $value = $prop.Value
        if ($value -is [System.Collections.IEnumerable] -and -not ($value -is [string])) {
            $hash[$prop.Name] = @($value)
        }
        else {
            $hash[$prop.Name] = $value
        }
    }

    return $hash
}

$script:UserCache = @{}
$script:GroupCache = @{}
$script:GroupMembersCache = @{}
$script:RoleMembersCache = @{}
$script:ServicePrincipalCache = @{}
$script:NamedLocationCache = @{}
$script:RoleTemplateCache = @{}
$script:RelationshipKeyCache = [System.Collections.Generic.HashSet[string]]::new()

function Get-UserById {
    param([string]$Id)

    if (-not $Id) {
        return $null
    }

    if ($script:UserCache.Contains($Id)) {
        return $script:UserCache[$Id]
    }

    try {
        $user = Get-MgUser -UserId $Id -Select Id,DisplayName,UserPrincipalName,Mail,AccountEnabled
        if ($user) {
            $entity = [pscustomobject]@{
                id = $user.Id
                displayName = $user.DisplayName
                userPrincipalName = $user.UserPrincipalName
                mail = $user.Mail
                accountEnabled = $user.AccountEnabled
                type = 'user'
            }
            $script:UserCache[$Id] = $entity
            return $entity
        }
    }
    catch {
        Write-Warning "Failed to resolve user $($Id): $($_.Exception.Message)"
    }

    return $null
}

function Get-GroupById {
    param([string]$Id)

    if (-not $Id) {
        return $null
    }

    if ($script:GroupCache.Contains($Id)) {
        return $script:GroupCache[$Id]
    }

    try {
        $group = Get-MgGroup -GroupId $Id -Select Id,DisplayName,Mail,MailEnabled,SecurityEnabled,GroupTypes
        if ($group) {
            $entity = [pscustomobject]@{
                id = $group.Id
                displayName = $group.DisplayName
                mail = $group.Mail
                mailEnabled = $group.MailEnabled
                securityEnabled = $group.SecurityEnabled
                groupTypes = $group.GroupTypes
                type = 'group'
            }
            $script:GroupCache[$Id] = $entity
            return $entity
        }
    }
    catch {
        Write-Warning "Failed to resolve group $($Id): $($_.Exception.Message)"
    }

    return $null
}

function Get-ServicePrincipalById {
    param([string]$Id)

    if (-not $Id) {
        return $null
    }

    if ($script:ServicePrincipalCache.Contains($Id)) {
        return $script:ServicePrincipalCache[$Id]
    }

    try {
        $sp = Get-MgServicePrincipal -ServicePrincipalId $Id -Select Id,DisplayName,AppId,ServicePrincipalType -ErrorAction Stop
        if ($sp) {
            $entity = [pscustomobject]@{
                id = (Get-PropertyValue -Object $sp -PropertyName 'Id')
                displayName = (Get-PropertyValue -Object $sp -PropertyName 'DisplayName')
                appId = (Get-PropertyValue -Object $sp -PropertyName 'AppId')
                servicePrincipalType = (Get-PropertyValue -Object $sp -PropertyName 'ServicePrincipalType')
                type = 'servicePrincipal'
            }
            $script:ServicePrincipalCache[$Id] = $entity
            return $entity
        }
    }
    catch {
        Write-Warning "Failed to get service principal by object id $($Id): $($_.Exception.Message)"
        # If the value was actually an AppId, try resolve by appId filter
        try {
            $cmd = Get-Command Get-MgServicePrincipal -ErrorAction SilentlyContinue
            $params = @{ 
                Filter = ("appId eq '{0}'" -f $Id)
                Select = 'Id,DisplayName,AppId,ServicePrincipalType'
                All    = $true
            }
            if ($cmd -and $cmd.Parameters.ContainsKey('ConsistencyLevel')) { $params['ConsistencyLevel'] = 'eventual' }
            $byApp = Get-MgServicePrincipal @params -ErrorAction Stop
            $sp = $byApp | Select-Object -First 1
            if ($sp) {
                $entity = [pscustomobject]@{
                    id = (Get-PropertyValue -Object $sp -PropertyName 'Id')
                    displayName = (Get-PropertyValue -Object $sp -PropertyName 'DisplayName')
                    appId = (Get-PropertyValue -Object $sp -PropertyName 'AppId')
                    servicePrincipalType = (Get-PropertyValue -Object $sp -PropertyName 'ServicePrincipalType')
                    type = 'servicePrincipal'
                }
                $script:ServicePrincipalCache[$entity.id] = $entity
                return $entity
            }
        }
        catch {
            Write-Warning "Failed to find service principal by appId $($Id): $($_.Exception.Message)"
        }
    }

    return $null
}

function Initialize-NamedLocations {
    $namedLocationCount = if ($script:NamedLocationCache) { ($script:NamedLocationCache.Keys | Measure-Object).Count } else { 0 }
    if ($namedLocationCount -gt 0) {
        return
    }

    try {
        $locations = Get-MgIdentityConditionalAccessNamedLocation -All
        foreach ($location in $locations) {
            $odataType = $location.PSObject.Properties['AdditionalProperties']?.Value?['@odata.type']
            $typeName = if ($odataType) { $odataType.Split('.')[-1] } else { 'namedLocation' }
            
            # Use Get-PropertyValue to safely access properties (handles both direct and AdditionalProperties)
            $isTrustedVal = Get-PropertyValue -Object $location -PropertyName 'IsTrusted'
            
            $entry = [ordered]@{
                id = $location.Id
                displayName = $location.DisplayName
                type = $typeName
                isTrusted = $isTrustedVal
            }

            if ($typeName -eq 'ipNamedLocation') {
                $ranges = @()
                $ipRangesVal = Get-PropertyValue -Object $location -PropertyName 'IpRanges'
                foreach ($range in (To-Array $ipRangesVal)) {
                    $cidr = Get-PropertyValue -Object $range -PropertyName 'CidrAddress'
                    if ($cidr) {
                        $ranges += $cidr
                    }
                }
                $entry.ipRanges = $ranges
            }
            elseif ($typeName -eq 'countryNamedLocation') {
                $countriesVal = Get-PropertyValue -Object $location -PropertyName 'CountriesAndRegions'
                $includeUnknownVal = Get-PropertyValue -Object $location -PropertyName 'IncludeUnknownCountriesAndRegions'
                $entry.countriesAndRegions = To-Array $countriesVal
                $entry.includeUnknownCountriesAndRegions = $includeUnknownVal
            }

            $script:NamedLocationCache[$location.Id] = $entry
        }
    }
    catch {
        Write-Warning "Failed to load named locations: $($_.Exception.Message)"
    }
}

function Get-NamedLocationById {
    param([string]$Id)

    if (-not $Id) {
        return $null
    }

    Initialize-NamedLocations

    if ($script:NamedLocationCache.Contains($Id)) {
        return $script:NamedLocationCache[$Id]
    }

    return $null
}

function Initialize-RoleTemplates {
    $roleTemplateCount = if ($script:RoleTemplateCache) { ($script:RoleTemplateCache.Keys | Measure-Object).Count } else { 0 }
    if ($roleTemplateCount -gt 0) {
        return
    }

    try {
        $roles = Get-MgDirectoryRole -All
        foreach ($role in $roles) {
            if ($role.RoleTemplateId) {
                $script:RoleTemplateCache[$role.RoleTemplateId] = [ordered]@{
                    id = $role.RoleTemplateId
                    displayName = $role.DisplayName
                    description = $role.Description
                    roleId = $role.Id
                }
            }
        }
    }
    catch {
        Write-Warning "Failed to load directory roles: $($_.Exception.Message)"
    }

    try {
        $templates = Get-MgDirectoryRoleTemplate -All
        foreach ($template in $templates) {
            if (-not $script:RoleTemplateCache.Contains($template.Id)) {
                $script:RoleTemplateCache[$template.Id] = [ordered]@{
                    id = $template.Id
                    displayName = $template.DisplayName
                    description = $template.Description
                }
            }
            elseif (-not $script:RoleTemplateCache[$template.Id].displayName) {
                $script:RoleTemplateCache[$template.Id].displayName = $template.DisplayName
            }
        }
    }
    catch {
        Write-Warning "Failed to load directory role templates: $($_.Exception.Message)"
    }
}

function Add-Entity {
    param(
        [Parameter(Mandatory)] [hashtable]$Analysis,
        [Parameter(Mandatory)] [string]$CollectionName,
        [Parameter(Mandatory)] [hashtable]$Entity
    )

    if (-not $Entity['id']) {
        return
    }

    if (-not ($Analysis.entities.Contains($CollectionName))) {
        $Analysis.entities[$CollectionName] = @{}
    }

    $collection = $Analysis.entities[$CollectionName]
    # OrderedDictionary doesn't have ContainsKey; use .Contains for keys and indexer for assignment
    if (-not ($collection.Contains($Entity['id']))) {
        $collection[$Entity['id']] = $Entity
    }
}

function Add-KeywordEntity {
    param(
        [hashtable]$Analysis,
        [string]$Keyword,
        [string]$Category
    )

    if (-not $Keyword) {
        return
    }

    if (-not $Analysis.entities.keywords.ContainsKey($Keyword)) {
        $Analysis.entities.keywords[$Keyword] = @{
            keyword = $Keyword
            categories = @()
        }
    }

    $entry = $Analysis.entities.keywords[$Keyword]
    if ($Category -and -not ($entry.categories -contains $Category)) {
        $entry.categories += $Category
    }
}

function Add-Relationship {
    param(
        [hashtable]$Analysis,
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
        # Item was added (wasn't already present), so proceed
    }
    else {
        # Duplicate relationship, skip
        return
    }

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

    try {
        $count = $Analysis.relationships.Add($relationship)
        Write-Verbose "Added relationship: $PolicyName -> $TargetDisplayName ($Scope)"
        Write-Verbose "  Relationships count after add: $($Analysis.relationships.Count)"
    }
    catch {
        Write-Warning "Failed to add relationship: $($_.Exception.Message)"
        Write-Warning "  Exception details: $($_.Exception | Format-List * | Out-String)"
    }
}

function Expand-GroupMembersInternal {
    param(
        [string]$GroupId,
        [string[]]$Path,
        [hashtable]$Visited
    )

    $results = @()

    if (-not $Visited) {
        $Visited = @{}
    }

    if ($Visited.Contains($GroupId)) {
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
        $command = Get-Command Get-MgGroupMember -ErrorAction Stop
        $parameters = @{
            GroupId = $GroupId
            All     = $true
        }
        if ($command.Parameters.ContainsKey('ConsistencyLevel')) {
            $parameters['ConsistencyLevel'] = 'eventual'
        }
        $members = Get-MgGroupMember @parameters
    }
    catch {
        Write-Warning "Failed to enumerate members for group $($GroupId): $($_.Exception.Message)"
        return $results
    }

    foreach ($member in $members) {
        if (-not $member) {
            continue
        }

        $props = $member.AdditionalProperties
        $odataType = $props['@odata.type']

        switch ($odataType) {
            '#microsoft.graph.user' {
                $user = $null
                if ($props) {
                    $user = [pscustomobject]@{
                        id = $member.Id
                        displayName = $props['displayName']
                        userPrincipalName = $props['userPrincipalName']
                        mail = $props['mail']
                        accountEnabled = $props['accountEnabled']
                        type = 'user'
                    }
                    if (-not $user.displayName) {
                        $user = Get-UserById $member.Id
                    }
                    else {
                        $script:UserCache[$member.Id] = $user
                    }
                }
                else {
                    $user = Get-UserById $member.Id
                }

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
                if (-not $childGroup -and $displayName) {
                    $childGroup = [pscustomobject]@{
                        id = $member.Id
                        displayName = $displayName
                        type = 'group'
                    }
                    $script:GroupCache[$member.Id] = $childGroup
                }

                $results += [pscustomobject]@{
                    id = $member.Id
                    type = 'group'
                    displayName = if ($childGroup) { $childGroup.displayName } else { $member.Id }
                    via = @($currentPath)
                }

                $nested = Expand-GroupMembersInternal -GroupId $member.Id -Path $currentPath -Visited $Visited
                if ($nested) {
                    $results += $nested
                }
            }
            '#microsoft.graph.servicePrincipal' {
                $sp = $null
                if ($props) {
                    $sp = [pscustomobject]@{
                        id = $member.Id
                        displayName = $props['displayName']
                        appId = $props['appId']
                        servicePrincipalType = $props['servicePrincipalType']
                        type = 'servicePrincipal'
                    }
                    if (-not $sp.displayName) {
                        $sp = Get-ServicePrincipalById $member.Id
                    }
                    else {
                        $script:ServicePrincipalCache[$member.Id] = $sp
                    }
                }
                else {
                    $sp = Get-ServicePrincipalById $member.Id
                }

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
    param([string]$GroupId)

    if (-not $GroupId) {
        return @()
    }

    if ($script:GroupMembersCache.ContainsKey($GroupId)) {
        return $script:GroupMembersCache[$GroupId]
    }

    $members = Expand-GroupMembersInternal -GroupId $GroupId -Path @() -Visited @{}
    $script:GroupMembersCache[$GroupId] = $members
    return $members
}

function Get-RoleMembersExpanded {
    param([string]$RoleTemplateId)

    if (-not $RoleTemplateId) {
        return @()
    }

    if ($script:RoleMembersCache.ContainsKey($RoleTemplateId)) {
        return $script:RoleMembersCache[$RoleTemplateId]
    }

    $members = @()

    try {
        # Find the activated role instance by role template ID
        $activatedRole = Get-MgDirectoryRole -All | Where-Object { $_.RoleTemplateId -eq $RoleTemplateId } | Select-Object -First 1
        
        if ($activatedRole) {
            Write-Verbose "Expanding members for role: $($activatedRole.DisplayName) (ID: $($activatedRole.Id))"
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
            Write-Verbose "  Found $($members.Count) user members"
        } else {
            Write-Warning "Role with template ID $RoleTemplateId is not activated in this tenant"
        }
    }
    catch {
        Write-Warning "Failed to expand members for role template $($RoleTemplateId): $($_.Exception.Message)"
    }

    $script:RoleMembersCache[$RoleTemplateId] = $members
    return $members
}

function Resolve-UserAssignments {
    param(
        [string[]]$Values,
        [string]$Scope,
        [hashtable]$PolicySummary,
        [hashtable]$Analysis
    )

    $result = @{ keywords = @(); entities = @() }

    foreach ($value in (To-Array $Values)) {
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        if ($value -match '^[0-9a-fA-F-]{32,36}$' -and $value.Length -ge 32) {
            $user = Get-UserById $value
            if ($user) {
                $entity = [pscustomobject]@{
                    id = $user.id
                    displayName = $user.displayName
                    userPrincipalName = $user.userPrincipalName
                    mail = $user.mail
                    type = 'user'
                }
                $result.entities += $entity
                Add-Entity -Analysis $Analysis -CollectionName 'users' -Entity (ConvertTo-OrderedHashtable $entity)
                Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'user' -TargetId $entity.id -TargetDisplayName $entity.displayName -Via $null -Description 'User assignment'
            }
            else {
                $entity = [pscustomobject]@{
                    id = $value
                    displayName = $null
                    userPrincipalName = $null
                    type = 'user'
                }
                $result.entities += $entity
                Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'user' -TargetId $entity.id -TargetDisplayName $entity.id -Via $null -Description 'User assignment (unresolved)'
            }
        }
        else {
            $result.keywords += $value
            Add-KeywordEntity -Analysis $Analysis -Keyword $value -Category 'users'
            Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'keyword' -TargetId $value -TargetDisplayName $value -Via $null -Description 'User keyword assignment'
        }
    }

    return $result
}

function Resolve-GroupAssignments {
    param(
        [string[]]$Values,
        [string]$Scope,
        [hashtable]$PolicySummary,
        [hashtable]$Analysis
    )

    $result = @{ keywords = @(); entities = @() }

    foreach ($value in (To-Array $Values)) {
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        if ($value -match '^[0-9a-fA-F-]{32,36}$' -and $value.Length -ge 32) {
            $group = Get-GroupById $value
            $members = Get-GroupMembersExpanded $value
            $entity = [pscustomobject]@{
                id = if ($group) { $group.id } else { $value }
                displayName = if ($group) { $group.displayName } else { $value }
                mail = if ($group) { $group.mail } else { $null }
                groupTypes = if ($group) { $group.groupTypes } else { $null }
                memberCount = (@($members | Where-Object { $_.type -ne 'group' })).Count
                members = $members
                type = 'group'
            }
            $result.entities += $entity
            Add-Entity -Analysis $Analysis -CollectionName 'groups' -Entity (ConvertTo-OrderedHashtable $entity)
            Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'group' -TargetId $entity.id -TargetDisplayName $entity.displayName -Via $null -Description 'Group assignment'

            foreach ($member in $members) {
                if (-not $member) {
                    continue
                }

                $collectionName = switch ($member.type) {
                    'user' { 'users' }
                    'group' { 'groups' }
                    'servicePrincipal' { 'servicePrincipals' }
                    'device' { 'devices' }
                    default { 'keywords' }
                }

                $entityHash = ConvertTo-OrderedHashtable ([pscustomobject]$member)
                Add-Entity -Analysis $Analysis -CollectionName $collectionName -Entity $entityHash
                Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType $member.type -TargetId $member.id -TargetDisplayName $member.displayName -Via $member.via -Description 'Group membership expansion'
            }
        }
        else {
            $result.keywords += $value
            Add-KeywordEntity -Analysis $Analysis -Keyword $value -Category 'groups'
            Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'keyword' -TargetId $value -TargetDisplayName $value -Via $null -Description 'Group keyword assignment'
        }
    }

    return $result
}

function Resolve-RoleAssignments {
    param(
        [string[]]$Values,
        [string]$Scope,
        [hashtable]$PolicySummary,
        [hashtable]$Analysis
    )

    $result = @{ keywords = @(); entities = @() }

    if (@(To-Array $Values).Count -gt 0) {
        Initialize-RoleTemplates
    }

    foreach ($value in (To-Array $Values)) {
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        if ($script:RoleTemplateCache.ContainsKey($value)) {
            $role = $script:RoleTemplateCache[$value]
            
            # Expand role members
            $roleMembers = Get-RoleMembersExpanded -RoleTemplateId $role.id
            
            # Safely get count (handle empty array or null)
            $memberCount = 0
            if ($roleMembers) {
                $memberCount = @($roleMembers).Count
            }
            
            $entity = [pscustomobject]@{
                id = $role.id
                displayName = $role.displayName
                description = $role.description
                roleId = if ($role.Contains('roleId')) { $role.roleId } else { $null }
                memberCount = $memberCount
                members = if ($roleMembers) { $roleMembers } else { @() }
                type = 'role'
            }
            $result.entities += $entity
            Add-Entity -Analysis $Analysis -CollectionName 'roles' -Entity (ConvertTo-OrderedHashtable $entity)
            Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'role' -TargetId $entity.id -TargetDisplayName $entity.displayName -Via $null -Description 'Role assignment'
            
            # Add relationships for each role member
            if ($roleMembers) {
                foreach ($member in $roleMembers) {
                    Add-Entity -Analysis $Analysis -CollectionName 'users' -Entity (ConvertTo-OrderedHashtable $member)
                    Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'user' -TargetId $member.id -TargetDisplayName $member.displayName -Via @($role.displayName) -Description 'User via role'
                }
            }
        }
        else {
            $result.keywords += $value
            Add-KeywordEntity -Analysis $Analysis -Keyword $value -Category 'roles'
            Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'role' -TargetId $value -TargetDisplayName $value -Via $null -Description 'Unresolved role assignment'
        }
    }

    return $result
}

function Resolve-ApplicationAssignments {
    param(
        [string[]]$Values,
        [string]$Scope,
        [hashtable]$PolicySummary,
        [hashtable]$Analysis
    )

    $result = @{ keywords = @(); entities = @() }

    foreach ($value in (To-Array $Values)) {
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        if ($value -match '^[0-9a-fA-F-]{32,36}$' -and $value.Length -ge 32) {
            $sp = Get-ServicePrincipalById $value
            if ($sp) {
                $entity = [pscustomobject]@{
                    id = $sp.id
                    displayName = $sp.displayName
                    appId = $sp.appId
                    servicePrincipalType = $sp.servicePrincipalType
                    type = 'servicePrincipal'
                }
                $result.entities += $entity
                Add-Entity -Analysis $Analysis -CollectionName 'servicePrincipals' -Entity (ConvertTo-OrderedHashtable $entity)
                Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'servicePrincipal' -TargetId $entity.id -TargetDisplayName $entity.displayName -Via $null -Description 'Application assignment'
            }
            else {
                $entity = [pscustomobject]@{
                    id = $value
                    displayName = $null
                    type = 'servicePrincipal'
                }
                $result.entities += $entity
                Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'servicePrincipal' -TargetId $entity.id -TargetDisplayName $entity.id -Via $null -Description 'Application assignment (unresolved)'
            }
        }
        else {
            $result.keywords += $value
            Add-KeywordEntity -Analysis $Analysis -Keyword $value -Category 'applications'
            Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'keyword' -TargetId $value -TargetDisplayName $value -Via $null -Description 'Application keyword assignment'
        }
    }

    return $result
}

function Resolve-NamedLocationAssignments {
    param(
        [string[]]$Values,
        [string]$Scope,
        [hashtable]$PolicySummary,
        [hashtable]$Analysis
    )

    $result = @{ keywords = @(); entities = @() }

    foreach ($value in (To-Array $Values)) {
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        if ($value -match '^[0-9a-fA-F-]{32,36}$' -and $value.Length -ge 32) {
            $location = Get-NamedLocationById $value
            if ($location) {
                # $location is a hashtable, use Get-PropertyValue or hashtable indexer
                $entity = [pscustomobject]@{
                    id = (Get-PropertyValue -Object $location -PropertyName 'id')
                    displayName = (Get-PropertyValue -Object $location -PropertyName 'displayName')
                    type = (Get-PropertyValue -Object $location -PropertyName 'type')
                    isTrusted = (Get-PropertyValue -Object $location -PropertyName 'isTrusted')
                    ipRanges = (Get-PropertyValue -Object $location -PropertyName 'ipRanges')
                    countriesAndRegions = (Get-PropertyValue -Object $location -PropertyName 'countriesAndRegions')
                    includeUnknownCountriesAndRegions = (Get-PropertyValue -Object $location -PropertyName 'includeUnknownCountriesAndRegions')
                }
                $result.entities += $entity
                Add-Entity -Analysis $Analysis -CollectionName 'namedLocations' -Entity (ConvertTo-OrderedHashtable $entity)
                Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'namedLocation' -TargetId $entity.id -TargetDisplayName $entity.displayName -Via $null -Description 'Named location assignment'
            }
            else {
                $entity = [pscustomobject]@{
                    id = $value
                    displayName = $null
                    type = 'namedLocation'
                }
                $result.entities += $entity
                Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'namedLocation' -TargetId $entity.id -TargetDisplayName $entity.id -Via $null -Description 'Named location assignment (unresolved)'
            }
        }
        else {
            $result.keywords += $value
            Add-KeywordEntity -Analysis $Analysis -Keyword $value -Category 'namedLocations'
            Add-Relationship -Analysis $Analysis -PolicyId $PolicySummary.id -PolicyName $PolicySummary.displayName -Scope $Scope -TargetType 'keyword' -TargetId $value -TargetDisplayName $value -Via $null -Description 'Named location keyword assignment'
        }
    }

    return $result
}

function Resolve-GuestExternalUsers {
    param($GuestsObject)

    if (-not $GuestsObject) {
        return $null
    }

    $externalTenants = Get-PropertyValue -Object $GuestsObject -PropertyName 'ExternalTenants'
    $tenants = @{}
    if ($externalTenants) {
        $tenants['membershipKind'] = (Get-PropertyValue -Object $externalTenants -PropertyName 'MembershipKind')
        $tenants['members'] = To-Array (Get-PropertyValue -Object $externalTenants -PropertyName 'Members')
    }

    return @{
        guestOrExternalUserTypes = To-Array (Get-PropertyValue -Object $GuestsObject -PropertyName 'GuestOrExternalUserTypes')
        externalTenants = $tenants
    }
}

function Format-UserEntity {
    param($Entity)
    if (-not $Entity) { return $null }
    $displayName = if ($Entity.PSObject.Properties['displayName']) { $Entity.displayName } else { 'Unknown' }
    $id = if ($Entity.PSObject.Properties['id']) { $Entity.id } else { 'no-id' }
    $upn = if ($Entity.PSObject.Properties['userPrincipalName'] -and $Entity.userPrincipalName) { "<$($Entity.userPrincipalName)>" } else { '' }
    $mail = if ($Entity.PSObject.Properties['mail'] -and $Entity.mail -and $Entity.mail -ne $Entity.userPrincipalName) { "[$($Entity.mail)]" } else { '' }
    return ("$displayName $upn $mail [$id]".Trim())
}

function Format-GroupEntity {
    param($Entity)
    if (-not $Entity) { return $null }
    $mc = $null
    if ($Entity.PSObject.Properties['memberCount']) { $mc = $Entity.memberCount }
    $memberCount = if ($null -ne $mc -and $mc -ge 0) { "members: $mc" } else { '' }
    return ("$($Entity.displayName) [$($Entity.id)] $memberCount".Trim())
}

function Format-RoleEntity {
    param($Entity)
    if (-not $Entity) { return $null }
    $displayName = if ($Entity.PSObject.Properties['displayName']) { $Entity.displayName } else { 'Unknown' }
    $id = if ($Entity.PSObject.Properties['id']) { $Entity.id } else { 'no-id' }
    return ("$displayName [$id]".Trim())
}

function Format-ServicePrincipalEntity {
    param($Entity)
    if (-not $Entity) { return $null }
    $displayName = if ($Entity.PSObject.Properties['displayName']) { $Entity.displayName } else { 'Unknown' }
    $id = if ($Entity.PSObject.Properties['id']) { $Entity.id } else { 'no-id' }
    $appId = if ($Entity.PSObject.Properties['appId'] -and $Entity.appId) { "appId: $($Entity.appId)" } else { '' }
    return ("$displayName [$id] $appId".Trim())
}

function Format-NamedLocationEntity {
    param($Entity)
    if (-not $Entity) { return $null }
    $details = @()
    if ($Entity.PSObject.Properties['type'] -and $Entity.type) { $details += $Entity.type }
    if ($Entity.PSObject.Properties['isTrusted'] -and $null -ne $Entity.isTrusted) { $details += "trusted=$($Entity.isTrusted)" }
    if ($Entity.PSObject.Properties['ipRanges'] -and $Entity.ipRanges) { $details += "ipRanges=$(($Entity.ipRanges) -join ', ')" }
    if ($Entity.PSObject.Properties['countriesAndRegions'] -and $Entity.countriesAndRegions) { $details += "regions=$(($Entity.countriesAndRegions) -join ', ')" }
    $detailStr = if ($details.Count -gt 0) { " $($details -join ' ')" } else { '' }
    return "$($Entity.displayName) [$($Entity.id)]$detailStr".Trim()
}

function Format-AssignmentList {
    param($Assignment)

    $parts = @()
    if (-not $Assignment) {
        return ''
    }

    foreach ($keyword in (To-Array $Assignment.keywords)) {
        if ($keyword) {
            $parts += "keyword:$keyword"
        }
    }

    foreach ($entity in (To-Array $Assignment.entities)) {
        if (-not $entity) { continue }
        switch ($entity.type) {
            'user' { $parts += (Format-UserEntity $entity) }
            'group' { $parts += (Format-GroupEntity $entity) }
            'role' { $parts += (Format-RoleEntity $entity) }
            'servicePrincipal' { $parts += (Format-ServicePrincipalEntity $entity) }
            'namedLocation' { $parts += (Format-NamedLocationEntity $entity) }
            default { $parts += "$($entity.type):$($entity.displayName) [$($entity.id)]" }
        }
    }

    return ($parts -join '; ')
}

function Format-GroupMembers {
    param($Groups)

    $entries = @()
    foreach ($group in (To-Array $Groups)) {
        foreach ($member in (To-Array $group.members)) {
            $via = if ($member.via) { ($member.via -join ' > ') } else { $group.displayName }
            switch ($member.type) {
                'user' {
                    $entries += "User: $(Format-UserEntity $member) via $via"
                }
                'group' {
                    $entries += "Group: $(Format-GroupEntity $member) via $via"
                }
                'servicePrincipal' {
                    $entries += "ServicePrincipal: $(Format-ServicePrincipalEntity $member) via $via"
                }
                'device' {
                    $entries += "Device: $($member.displayName) [$($member.id)] via $via"
                }
                default {
                    $entries += "$($member.type): $($member.displayName) [$($member.id)] via $via"
                }
            }
        }
    }

    return ($entries -join '; ')
}

function Format-ServicePrincipalAssignment {
    param($Assignment)

    $parts = @()
    if (-not $Assignment) { return '' }

    foreach ($keyword in (To-Array $Assignment.keywords)) {
        $parts += "keyword:$keyword"
    }

    foreach ($entity in (To-Array $Assignment.entities)) {
        $parts += (Format-ServicePrincipalEntity $entity)
    }

    return ($parts -join '; ')
}

function Format-NamedLocationAssignment {
    param($Assignment)

    $parts = @()
    if (-not $Assignment) { return '' }

    foreach ($keyword in (To-Array $Assignment.keywords)) {
        $parts += "keyword:$keyword"
    }

    foreach ($entity in (To-Array $Assignment.entities)) {
        $parts += (Format-NamedLocationEntity $entity)
    }

    return ($parts -join '; ')
}

function Format-SimpleList {
    param($Values)
    return ((To-Array $Values) -join '; ')
}

function Format-GrantControls {
    param($Grant)

    if (-not $Grant) { return '' }

    $parts = @()
    $op = Get-PropertyValue -Object $Grant -PropertyName 'operator'
    if ($op) { $parts += ("operator={0}" -f $op) }
    $builtIns = Get-PropertyValue -Object $Grant -PropertyName 'builtInControls'
    if ($builtIns) { $parts += ("builtIn={0}" -f (@($builtIns) -join ', ')) }
    $tou = Get-PropertyValue -Object $Grant -PropertyName 'termsOfUse'
    if ($tou) { $parts += ("termsOfUse={0}" -f (@($tou) -join ', ')) }
    $custom = Get-PropertyValue -Object $Grant -PropertyName 'customAuthenticationFactors'
    if ($custom) { $parts += ("customFactors={0}" -f (@($custom) -join ', ')) }
    $strength = Get-PropertyValue -Object $Grant -PropertyName 'authenticationStrength'
    if ($strength) {
        $sid = Get-PropertyValue -Object $strength -PropertyName 'id'
        $sname = Get-PropertyValue -Object $strength -PropertyName 'displayName'
        if ($sid) { $parts += ("authStrengthId={0}" -f $sid) }
        if ($sname) { $parts += ("authStrengthName={0}" -f $sname) }
    }
    $req = Get-PropertyValue -Object $Grant -PropertyName 'authenticationStrengthRequirement'
    if ($req) { $parts += ("authStrengthRequirement={0}" -f $req) }

    return ($parts -join ' | ')
}

function Format-SessionControls {
    param($Session)

    if (-not $Session) { return '' }

    $parts = @()

    $aer = Get-PropertyValue -Object $Session -PropertyName 'applicationEnforcedRestrictions'
    if ($aer) {
        $aerEnabled = Get-PropertyValue -Object $aer -PropertyName 'isEnabled'
        $parts += ("applicationEnforcedRestrictions={0}" -f $aerEnabled)
    }
    $cas = Get-PropertyValue -Object $Session -PropertyName 'cloudAppSecurity'
    if ($cas) {
        $casEnabled = Get-PropertyValue -Object $cas -PropertyName 'isEnabled'
        $casType = Get-PropertyValue -Object $cas -PropertyName 'cloudAppSecurityType'
        $parts += ("cloudAppSecurity={0} type={1}" -f $casEnabled, $casType)
    }
    $pb = Get-PropertyValue -Object $Session -PropertyName 'persistentBrowser'
    if ($pb) {
        $pbEnabled = Get-PropertyValue -Object $pb -PropertyName 'isEnabled'
        $pbMode = Get-PropertyValue -Object $pb -PropertyName 'mode'
        $parts += ("persistentBrowser={0} mode={1}" -f $pbEnabled, $pbMode)
    }
    $sif = Get-PropertyValue -Object $Session -PropertyName 'signInFrequency'
    if ($sif) {
        $val = Get-PropertyValue -Object $sif -PropertyName 'value'
        $typ = Get-PropertyValue -Object $sif -PropertyName 'type'
        $enf = Get-PropertyValue -Object $sif -PropertyName 'enforceFrequency'
        $parts += ("signInFrequency={0} {1} enforcement={2}" -f $val, $typ, $enf)
    }
    $na = Get-PropertyValue -Object $Session -PropertyName 'networkAccess'
    if ($na) {
        $naEnabled = Get-PropertyValue -Object $na -PropertyName 'isEnabled'
        $naType = Get-PropertyValue -Object $na -PropertyName 'networkAccessType'
        $parts += ("networkAccess={0} type={1}" -f $naEnabled, $naType)
    }
    $drd = Get-PropertyValue -Object $Session -PropertyName 'disableResilienceDefaults'
    if ($drd -ne $null) {
        $parts += ("disableResilienceDefaults={0}" -f $drd)
    }

    return ($parts -join ' | ')
}

function Build-GrantSummary {
    param($GrantControls)

    if (-not $GrantControls) { return $null }

    $summary = @{}
    $summary.operator = (Get-PropertyValue -Object $GrantControls -PropertyName 'Operator')
    $summary.builtInControls = To-Array (Get-PropertyValue -Object $GrantControls -PropertyName 'BuiltInControls')
    $summary.termsOfUse = To-Array (Get-PropertyValue -Object $GrantControls -PropertyName 'TermsOfUse')
    $summary.customAuthenticationFactors = To-Array (Get-PropertyValue -Object $GrantControls -PropertyName 'CustomAuthenticationFactors')
    $summary.authenticationStrength = ConvertTo-OrderedHashtable (Get-PropertyValue -Object $GrantControls -PropertyName 'AuthenticationStrength')
    $summary.authenticationStrengthRequirement = (Get-PropertyValue -Object $GrantControls -PropertyName 'AuthenticationStrengthRequirement')
    return $summary
}

function Build-SessionSummary {
    param($SessionControls)

    if (-not $SessionControls) { return $null }

    $summary = [ordered]@{}
    
    # Helper function to check if a property has meaningful content
    function Has-MeaningfulContent {
        param($Object)
        if (-not $Object) { return $false }
        
        # If it's a hashtable or ordered dictionary, check if it has non-null values
        if ($Object -is [System.Collections.IDictionary]) {
            foreach ($key in $Object.Keys) {
                if ($Object[$key] -ne $null) {
                    return $true
                }
            }
            return $false
        }
        
        # For PSObjects, check properties
        if ($Object -is [PSObject] -or $Object.PSObject) {
            foreach ($prop in $Object.PSObject.Properties) {
                if ($prop.Name -ne 'AdditionalProperties' -and $prop.Value -ne $null) {
                    return $true
                }
            }
            return $false
        }
        
        return $false
    }
    
    # Try to get each session control property, convert it, and check if it has content
    try {
        $aer = Get-PropertyValue -Object $SessionControls -PropertyName 'ApplicationEnforcedRestrictions'
        if ($aer) {
            $aerHash = ConvertTo-OrderedHashtable $aer
            if (Has-MeaningfulContent $aerHash) {
                $summary.applicationEnforcedRestrictions = $aerHash
            }
        }
    } catch { 
        Write-Verbose "ApplicationEnforcedRestrictions not available: $($_.Exception.Message)"
    }
    
    try {
        $cas = Get-PropertyValue -Object $SessionControls -PropertyName 'CloudAppSecurity'
        if ($cas) {
            $casHash = ConvertTo-OrderedHashtable $cas
            if (Has-MeaningfulContent $casHash) {
                $summary.cloudAppSecurity = $casHash
            }
        }
    } catch { 
        Write-Verbose "CloudAppSecurity not available: $($_.Exception.Message)"
    }
    
    try {
        $pb = Get-PropertyValue -Object $SessionControls -PropertyName 'PersistentBrowser'
        if ($pb) {
            $pbHash = ConvertTo-OrderedHashtable $pb
            if (Has-MeaningfulContent $pbHash) {
                $summary.persistentBrowser = $pbHash
            }
        }
    } catch { 
        Write-Verbose "PersistentBrowser not available: $($_.Exception.Message)"
    }
    
    try {
        $sif = Get-PropertyValue -Object $SessionControls -PropertyName 'SignInFrequency'
        if ($sif) {
            $sifHash = ConvertTo-OrderedHashtable $sif
            if (Has-MeaningfulContent $sifHash) {
                $summary.signInFrequency = $sifHash
            }
        }
    } catch { 
        Write-Verbose "SignInFrequency not available: $($_.Exception.Message)"
    }
    
    try {
        $na = Get-PropertyValue -Object $SessionControls -PropertyName 'NetworkAccess'
        if ($na) {
            $naHash = ConvertTo-OrderedHashtable $na
            if (Has-MeaningfulContent $naHash) {
                $summary.networkAccess = $naHash
            }
        }
    } catch { 
        Write-Verbose "NetworkAccess not available: $($_.Exception.Message)"
    }
    
    try {
        $drd = Get-PropertyValue -Object $SessionControls -PropertyName 'DisableResilienceDefaults'
        if ($drd -ne $null) {
            $summary.disableResilienceDefaults = $drd
        }
    } catch { 
        Write-Verbose "DisableResilienceDefaults not available: $($_.Exception.Message)"
    }
    
    # Add missing session controls - only if they have actual content
    try {
        $cae = Get-PropertyValue -Object $SessionControls -PropertyName 'ContinuousAccessEvaluation'
        if ($cae) {
            $caeHash = ConvertTo-OrderedHashtable $cae
            if (Has-MeaningfulContent $caeHash) {
                $summary.continuousAccessEvaluation = $caeHash
            }
        }
    } catch { 
        Write-Verbose "ContinuousAccessEvaluation not available: $($_.Exception.Message)"
    }
    
    try {
        $ssis = Get-PropertyValue -Object $SessionControls -PropertyName 'SecureSignInSession'
        if ($ssis) {
            $ssisHash = ConvertTo-OrderedHashtable $ssis
            if (Has-MeaningfulContent $ssisHash) {
                $summary.secureSignInSession = $ssisHash
            }
        }
    } catch { 
        Write-Verbose "SecureSignInSession not available: $($_.Exception.Message)"
    }
    
    try {
        $tp = Get-PropertyValue -Object $SessionControls -PropertyName 'TokenProtection'
        if ($tp) {
            $tpHash = ConvertTo-OrderedHashtable $tp
            if (Has-MeaningfulContent $tpHash) {
                $summary.tokenProtection = $tpHash
            }
        }
    } catch { 
        Write-Verbose "TokenProtection not available: $($_.Exception.Message)"
    }
    
    try {
        $gsa = Get-PropertyValue -Object $SessionControls -PropertyName 'GlobalSecureAccessSecurityProfile'
        if ($gsa) {
            $gsaHash = ConvertTo-OrderedHashtable $gsa
            if (Has-MeaningfulContent $gsaHash) {
                $summary.globalSecureAccessSecurityProfile = $gsaHash
            }
        }
    } catch { 
        Write-Verbose "GlobalSecureAccessSecurityProfile not available: $($_.Exception.Message)"
    }
    
    # Only return summary if it has actual content
    if ($summary.Count -eq 0) {
        return $null
    }
    
    return $summary
}

if (-not $OutputDir) {
    $resolvedParent = Resolve-Path -LiteralPath (Join-Path -Path $PSScriptRoot -ChildPath '..')
    $OutputDir = Join-Path -Path $resolvedParent -ChildPath 'output'
}

if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -Path $OutputDir -ItemType Directory -Force | Out-Null
}

$OutputDir = (Resolve-Path -LiteralPath $OutputDir).Path

if (-not $PSBoundParameters.ContainsKey('UseDeviceCode')) {
    $UseDeviceCode = $true
}

# Check if required cmdlets are available; only import if missing
$requiredCmdlets = @('Connect-MgGraph', 'Get-MgIdentityConditionalAccessPolicy')
$needsImport = $false
foreach ($cmd in $requiredCmdlets) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        $needsImport = $true
        break
    }
}

if ($needsImport) {
    Write-Host "[INFO] Loading Microsoft Graph modules..." -ForegroundColor Cyan
    # Import with timeout protection - run in job with 30 second timeout
    $importJob = Start-Job -ScriptBlock {
        $ErrorActionPreference = 'SilentlyContinue'
        Import-Module Microsoft.Graph.Authentication -Force 2>$null
        Import-Module Microsoft.Graph.Identity.SignIns -Force 2>$null
    }
    $completed = Wait-Job $importJob -Timeout 30
    if (-not $completed) {
        Stop-Job $importJob
        Remove-Job $importJob -Force
        Write-Host "[WARN] Module import timed out. Continuing anyway..." -ForegroundColor Yellow
    } else {
        Remove-Job $importJob -Force
    }
}

# Guard profile selection: only attempt if the cmdlet exists
$selectProfileCmd = Get-Command -Name Select-MgProfile -ErrorAction SilentlyContinue
if ($selectProfileCmd) {
    try {
        Select-MgProfile -Name beta -ErrorAction Stop
    }
    catch {
        Write-Warning "Failed to select Graph beta profile: $($_.Exception.Message)"
    }
}
else {
    Write-Verbose 'Select-MgProfile not available; continuing with default Graph profile.'
}

# If caller requested to reuse existing connection, ensure context exists
if ($SkipConnect) {
    $preContext = Get-MgContext
    if (-not $preContext -or -not $preContext.Account) {
        Write-Error 'No existing Microsoft Graph connection found. Run Connect-MgGraph first or omit -SkipConnect.'
        return
    }
}

if (-not $SkipConnect) {
    Write-Info "Connecting to Microsoft Graph using device code flow..."
    Write-Info "When the device login prompt appears, browse to https://microsoft.com/devicelogin, enter the code, and approve the requested scopes."
    try {
        $connectParams = @{}
        # Only include Scopes if the caller explicitly provided them; otherwise reuse app's pre-consented scopes
        if ($PSBoundParameters.ContainsKey('Scopes') -and $Scopes -and ($Scopes | Measure-Object).Count -gt 0) {
            $connectParams['Scopes'] = $Scopes
        }
        $connectParams['ContextScope'] = 'Process'
        if ($TenantId) { $connectParams['TenantId'] = $TenantId }
        if ($UseDeviceCode) { $connectParams['UseDeviceCode'] = $true }
        Connect-MgGraph @connectParams -NoWelcome
    }
    catch {
        Write-ErrorMessage "Failed to connect to Microsoft Graph: $($_.Exception.Message)"
        throw
    }
}

$context = Get-MgContext
Write-Success "Connected as $($context.Account)"

if (-not $context.Scopes) {
    Write-Warning 'No scopes detected in context; ensure the delegated account has the required permissions.'
}

Write-Info "Retrieving conditional access policies..."

# Optional: use local raw files for modeling/testing
if ($RawPoliciesPath -and (Test-Path -LiteralPath $RawPoliciesPath)) {
    Write-Info "Loading policies from raw file: $RawPoliciesPath"
    $policies = Get-Content -Path $RawPoliciesPath -Raw | ConvertFrom-Json -Depth 100
}
else {
    $policies = @()
    try {
        # Stream with paging feedback to make long runs visible
        $page = 0
        $pageSize = 0
        $policiesEnum = Get-MgIdentityConditionalAccessPolicy -PageSize 50 -All:$false
        do {
            $page++
            $current = $policiesEnum
            if ($current) {
                $count = ($current | Measure-Object).Count
                $pageSize = $count
                $policies += $current
                $totalSoFar = ($policies | Measure-Object).Count
                Write-Info ("Fetched page {0} - {1} policies (total so far: {2})" -f $page, $count, $totalSoFar)
            }
            $policiesEnum = $null
            try { $policiesEnum = Get-MgIdentityConditionalAccessPolicy -PageSize 50 -All:$false -Page $page } catch { $policiesEnum = $null }
        } while ($policiesEnum)
        if (($policies | Measure-Object).Count -eq 0) {
            # fallback to -All if paging not supported in module
            $policies = Get-MgIdentityConditionalAccessPolicy -All
        }
    }
    catch {
        Write-ErrorMessage "Failed to retrieve conditional access policies: $($_.Exception.Message)"
        throw
    }
}

if (-not $policies) {
    Write-Info 'No policies returned. If the script appeared to hang earlier, confirm the device login was completed successfully.'
}

$totalPolicies = ($policies | Measure-Object).Count
Write-Info "Retrieved $totalPolicies conditional access policies."

$analysis = [ordered]@{
    generatedAt = (Get-Date).ToString('o')
    metadata = [ordered]@{
        account = $context.Account
        tenantId = $context.TenantId
        scopes = $context.Scopes
        profile = (Get-PropertyValue -Object $context -PropertyName 'Profile')
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

# Optional: preload named locations from raw file for faster local testing
if ($RawNamedLocationsPath -and (Test-Path -LiteralPath $RawNamedLocationsPath)) {
    try {
        Write-Info "Loading named locations from raw file: $RawNamedLocationsPath"
        $rawLocations = Get-Content -Path $RawNamedLocationsPath -Raw | ConvertFrom-Json -Depth 50
        $rawArray = if ($rawLocations -is [System.Collections.IEnumerable] -and -not ($rawLocations -is [string])) { @($rawLocations) } else { @($rawLocations) }
        foreach ($loc in $rawArray) {
            $odataType = $loc.AdditionalProperties['@odata.type']
            $typeName = if ($odataType) { $odataType.Split('.')[-1] } else { 'namedLocation' }
            $entry = [ordered]@{
                id = $loc.Id
                displayName = $loc.DisplayName
                type = $typeName
                isTrusted = $loc.AdditionalProperties['isTrusted']
                ipRanges = @()
                countriesAndRegions = @()
            }
            foreach ($r in ($loc.AdditionalProperties['ipRanges'] | ForEach-Object { $_ })) {
                if ($r['cidrAddress']) { $entry.ipRanges += $r['cidrAddress'] }
            }
            Add-Entity -Analysis $analysis -CollectionName 'namedLocations' -Entity $entry
        }
        Write-Info "Preloaded named locations from raw file."
    }
    catch {
        Write-Warning "Failed to preload named locations from raw file: $($_.Exception.Message)"
    }
}

$csvRows = [System.Collections.ArrayList]@()

$policyIndex = 0
foreach ($policy in $policies) {
    $policyIndex++
    $percent = if ($totalPolicies -gt 0) { [int](($policyIndex / $totalPolicies) * 100) } else { 100 }
    Write-Progress -Activity 'Analyzing Conditional Access policies' -Status "$policyIndex of $totalPolicies" -PercentComplete $percent
    if (($policyIndex % 5) -eq 0 -or $policyIndex -eq 1 -or $policyIndex -eq $totalPolicies) {
        Write-Info ("Processing policy {0}/{1}: {2}" -f $policyIndex, $totalPolicies, ($policy.DisplayName ?? $policy.Id))
    }

    $policySummary = [ordered]@{
        id = $policy.Id
        displayName = $policy.DisplayName
        state = $policy.State
        createdDateTime = $policy.CreatedDateTime
        modifiedDateTime = $policy.ModifiedDateTime
        description = $policy.Description
    }

    $conditions = Get-PropertyValue -Object $policy -PropertyName 'Conditions'
    $grantControls = Build-GrantSummary (Get-PropertyValue -Object $policy -PropertyName 'GrantControls')
    $sessionControls = Build-SessionSummary (Get-PropertyValue -Object $policy -PropertyName 'SessionControls')

    $usersCondition = Get-PropertyValue -Object $conditions -PropertyName 'Users'
    $applicationsCondition = Get-PropertyValue -Object $conditions -PropertyName 'Applications'
    $platformsCondition = Get-PropertyValue -Object $conditions -PropertyName 'Platforms'
    $devicesCondition = Get-PropertyValue -Object $conditions -PropertyName 'Devices'
    $locationsCondition = Get-PropertyValue -Object $conditions -PropertyName 'Locations'

    $includeUsers = Resolve-UserAssignments -Values (Get-PropertyValue -Object $usersCondition -PropertyName 'IncludeUsers') -Scope 'include' -PolicySummary $policySummary -Analysis $analysis
    $excludeUsers = Resolve-UserAssignments -Values (Get-PropertyValue -Object $usersCondition -PropertyName 'ExcludeUsers') -Scope 'exclude' -PolicySummary $policySummary -Analysis $analysis

    $includeGroups = Resolve-GroupAssignments -Values (Get-PropertyValue -Object $usersCondition -PropertyName 'IncludeGroups') -Scope 'include' -PolicySummary $policySummary -Analysis $analysis
    $excludeGroups = Resolve-GroupAssignments -Values (Get-PropertyValue -Object $usersCondition -PropertyName 'ExcludeGroups') -Scope 'exclude' -PolicySummary $policySummary -Analysis $analysis

    $includeRoles = Resolve-RoleAssignments -Values (Get-PropertyValue -Object $usersCondition -PropertyName 'IncludeRoles') -Scope 'include' -PolicySummary $policySummary -Analysis $analysis
    $excludeRoles = Resolve-RoleAssignments -Values (Get-PropertyValue -Object $usersCondition -PropertyName 'ExcludeRoles') -Scope 'exclude' -PolicySummary $policySummary -Analysis $analysis

    $includeServicePrincipals = Resolve-ApplicationAssignments -Values (Get-PropertyValue -Object $usersCondition -PropertyName 'IncludeServicePrincipals') -Scope 'include' -PolicySummary $policySummary -Analysis $analysis
    $excludeServicePrincipals = Resolve-ApplicationAssignments -Values (Get-PropertyValue -Object $usersCondition -PropertyName 'ExcludeServicePrincipals') -Scope 'exclude' -PolicySummary $policySummary -Analysis $analysis

    $includeApplications = Resolve-ApplicationAssignments -Values (Get-PropertyValue -Object $applicationsCondition -PropertyName 'IncludeApplications') -Scope 'include' -PolicySummary $policySummary -Analysis $analysis
    $excludeApplications = Resolve-ApplicationAssignments -Values (Get-PropertyValue -Object $applicationsCondition -PropertyName 'ExcludeApplications') -Scope 'exclude' -PolicySummary $policySummary -Analysis $analysis

    $includeLocations = Resolve-NamedLocationAssignments -Values (Get-PropertyValue -Object $locationsCondition -PropertyName 'IncludeLocations') -Scope 'include' -PolicySummary $policySummary -Analysis $analysis
    $excludeLocations = Resolve-NamedLocationAssignments -Values (Get-PropertyValue -Object $locationsCondition -PropertyName 'ExcludeLocations') -Scope 'exclude' -PolicySummary $policySummary -Analysis $analysis

    $policySummary.assignments = [ordered]@{
        include = [ordered]@{
            users = $includeUsers
            groups = $includeGroups
            roles = $includeRoles
            servicePrincipals = $includeServicePrincipals
        }
        exclude = [ordered]@{
            users = $excludeUsers
            groups = $excludeGroups
            roles = $excludeRoles
            servicePrincipals = $excludeServicePrincipals
        }
    }

    $policySummary.targetResources = [ordered]@{
        applications = [ordered]@{
            include = $includeApplications
            exclude = $excludeApplications
            includeUserActions = To-Array (Get-PropertyValue -Object $applicationsCondition -PropertyName 'IncludeUserActions')
            excludeUserActions = To-Array (Get-PropertyValue -Object $applicationsCondition -PropertyName 'ExcludeUserActions')
            includeAuthenticationContextClassReferences = To-Array (Get-PropertyValue -Object $applicationsCondition -PropertyName 'IncludeAuthenticationContextClassReferences')
            excludeAuthenticationContextClassReferences = To-Array (Get-PropertyValue -Object $applicationsCondition -PropertyName 'ExcludeAuthenticationContextClassReferences')
        }
    }

    # Extract insider risk levels (Microsoft Purview)
    $insiderRiskLevels = To-Array (Get-PropertyValue -Object $conditions -PropertyName 'InsiderRiskLevels')
    
    # Extract authentication flows
    $authenticationFlows = Get-PropertyValue -Object $conditions -PropertyName 'AuthenticationFlows'
    $authFlowTransferMethods = To-Array (Get-PropertyValue -Object $authenticationFlows -PropertyName 'TransferMethods')
    
    # Extract device filter details
    $deviceFilter = Get-PropertyValue -Object $devicesCondition -PropertyName 'DeviceFilter'
    $deviceFilterMode = Get-PropertyValue -Object $deviceFilter -PropertyName 'Mode'
    $deviceFilterRule = Get-PropertyValue -Object $deviceFilter -PropertyName 'Rule'

    $policySummary.conditions = [ordered]@{
        clientAppTypes = To-Array (Get-PropertyValue -Object $conditions -PropertyName 'ClientAppTypes')
        platforms = [ordered]@{
            include = To-Array (Get-PropertyValue -Object $platformsCondition -PropertyName 'IncludePlatforms')
            exclude = To-Array (Get-PropertyValue -Object $platformsCondition -PropertyName 'ExcludePlatforms')
        }
        deviceStates = [ordered]@{
            include = To-Array (Get-PropertyValue -Object $devicesCondition -PropertyName 'IncludeDeviceStates')
            exclude = To-Array (Get-PropertyValue -Object $devicesCondition -PropertyName 'ExcludeDeviceStates')
            filter = ConvertTo-OrderedHashtable (Get-PropertyValue -Object $devicesCondition -PropertyName 'DeviceFilter')
        }
        deviceFilter = [ordered]@{
            configured = ($deviceFilter -ne $null)
            mode = $deviceFilterMode
            rule = $deviceFilterRule
        }
        signInRiskLevels = To-Array (Get-PropertyValue -Object $conditions -PropertyName 'SignInRiskLevels')
        userRiskLevels = To-Array (Get-PropertyValue -Object $conditions -PropertyName 'UserRiskLevels')
        servicePrincipalRiskLevels = To-Array (Get-PropertyValue -Object $conditions -PropertyName 'ServicePrincipalRiskLevels')
        insiderRiskLevels = [ordered]@{
            configured = ((@($insiderRiskLevels)).Count -gt 0)
            levels = $insiderRiskLevels
        }
        authenticationFlows = [ordered]@{
            configured = ($authenticationFlows -ne $null)
            transferMethods = $authFlowTransferMethods
        }
        locations = [ordered]@{
            include = $includeLocations
            exclude = $excludeLocations
            includeUnknownLocations = Get-PropertyValue -Object $locationsCondition -PropertyName 'IncludeUnknownLocations'
            excludeUnknownLocations = Get-PropertyValue -Object $locationsCondition -PropertyName 'ExcludeUnknownLocations'
        }
        users = [ordered]@{
            includeGuestsOrExternalUsers = Resolve-GuestExternalUsers (Get-PropertyValue -Object $usersCondition -PropertyName 'IncludeGuestsOrExternalUsers')
            excludeGuestsOrExternalUsers = Resolve-GuestExternalUsers (Get-PropertyValue -Object $usersCondition -PropertyName 'ExcludeGuestsOrExternalUsers')
        }
    }

    $policySummary.accessControls = [ordered]@{
        grant = $grantControls
        session = $sessionControls
    }

    [void]$analysis.policies.Add($policySummary)
    if (($policyIndex % 10) -eq 0 -or $policyIndex -eq $totalPolicies) {
        $checkpoint = Join-Path -Path $OutputDir -ChildPath ('checkpoint_{0:000}.json' -f $policyIndex)
        (ConvertTo-Json $analysis -Depth 20) | Out-File -FilePath $checkpoint -Encoding utf8
        Write-Info ("Checkpoint written: {0}" -f $checkpoint)
    }

    $csvRow = [pscustomobject]@{
        PolicyId = $policySummary.id
        PolicyName = $policySummary.displayName
        State = $policySummary.state
        CreatedDateTime = $policySummary.createdDateTime
        ModifiedDateTime = $policySummary.modifiedDateTime
        IncludeUsers = Format-AssignmentList $includeUsers
        ExcludeUsers = Format-AssignmentList $excludeUsers
        IncludeGroups = Format-AssignmentList $includeGroups
        ExcludeGroups = Format-AssignmentList $excludeGroups
        IncludeGroupMembers = Format-GroupMembers $includeGroups.entities
        ExcludeGroupMembers = Format-GroupMembers $excludeGroups.entities
        IncludeRoles = Format-AssignmentList $includeRoles
        ExcludeRoles = Format-AssignmentList $excludeRoles
        IncludeServicePrincipals = Format-ServicePrincipalAssignment $includeServicePrincipals
        ExcludeServicePrincipals = Format-ServicePrincipalAssignment $excludeServicePrincipals
        IncludeApplications = Format-ServicePrincipalAssignment $includeApplications
        ExcludeApplications = Format-ServicePrincipalAssignment $excludeApplications
        IncludeUserActions = Format-SimpleList (Get-PropertyValue -Object $policySummary.targetResources.applications -PropertyName 'includeUserActions')
        ExcludeUserActions = Format-SimpleList (Get-PropertyValue -Object $policySummary.targetResources.applications -PropertyName 'excludeUserActions')
        IncludeNamedLocations = Format-NamedLocationAssignment $includeLocations
        ExcludeNamedLocations = Format-NamedLocationAssignment $excludeLocations
        IncludeUnknownLocations = (Get-PropertyValue -Object $policySummary.conditions.locations -PropertyName 'includeUnknownLocations')
        ExcludeUnknownLocations = (Get-PropertyValue -Object $policySummary.conditions.locations -PropertyName 'excludeUnknownLocations')
        ClientAppTypes = Format-SimpleList $policySummary.conditions.clientAppTypes
        PlatformsInclude = Format-SimpleList (Get-PropertyValue -Object $policySummary.conditions.platforms -PropertyName 'include')
        PlatformsExclude = Format-SimpleList (Get-PropertyValue -Object $policySummary.conditions.platforms -PropertyName 'exclude')
        DeviceStatesInclude = Format-SimpleList (Get-PropertyValue -Object $policySummary.conditions.deviceStates -PropertyName 'include')
        DeviceStatesExclude = Format-SimpleList (Get-PropertyValue -Object $policySummary.conditions.deviceStates -PropertyName 'exclude')
        UserRiskLevels = Format-SimpleList $policySummary.conditions.userRiskLevels
        SignInRiskLevels = Format-SimpleList $policySummary.conditions.signInRiskLevels
        ServicePrincipalRiskLevels = Format-SimpleList $policySummary.conditions.servicePrincipalRiskLevels
        # NEW: Insider risk levels
        InsiderRisk_Configured = $policySummary.conditions.insiderRiskLevels.configured
        InsiderRiskLevels = Format-SimpleList $policySummary.conditions.insiderRiskLevels.levels
        # NEW: Authentication flows
        AuthenticationFlows_Configured = $policySummary.conditions.authenticationFlows.configured
        AuthenticationFlows = Format-SimpleList $policySummary.conditions.authenticationFlows.transferMethods
        # NEW: Device filter
        DeviceFilter_Configured = $policySummary.conditions.deviceFilter.configured
        DeviceFilter_Mode = $policySummary.conditions.deviceFilter.mode
        DeviceFilter_Rule = $policySummary.conditions.deviceFilter.rule
        # NEW: Authentication contexts
        IncludeAuthenticationContexts = Format-SimpleList $policySummary.targetResources.applications.includeAuthenticationContextClassReferences
        ExcludeAuthenticationContexts = Format-SimpleList $policySummary.targetResources.applications.excludeAuthenticationContextClassReferences
        GrantControls = Format-GrantControls $grantControls
        SessionControls = Format-SessionControls $sessionControls
        # NEW: Additional session controls - use Get-PropertyValue for hashtable access
        Session_ContinuousAccessEvaluation = if ($sessionControls) { 
            $cae = Get-PropertyValue -Object $sessionControls -PropertyName 'continuousAccessEvaluation'
            if ($cae) { Get-PropertyValue -Object $cae -PropertyName 'mode' } else { $null }
        } else { $null }
        Session_TokenProtection = if ($sessionControls) { 
            $tp = Get-PropertyValue -Object $sessionControls -PropertyName 'tokenProtection'
            if ($tp) { Get-PropertyValue -Object $tp -PropertyName 'isEnabled' } else { $null }
        } else { $null }
        Session_SecureSignIn = if ($sessionControls) { 
            $ssi = Get-PropertyValue -Object $sessionControls -PropertyName 'secureSignInSession'
            if ($ssi) { Get-PropertyValue -Object $ssi -PropertyName 'isEnabled' } else { $null }
        } else { $null }
        Session_GlobalSecureAccessProfile = if ($sessionControls -and (Get-PropertyValue -Object $sessionControls -PropertyName 'globalSecureAccessSecurityProfile')) { $true } else { $false }
    }

    [void]$csvRows.Add($csvRow)
}

Write-Progress -Activity 'Analyzing Conditional Access policies' -Completed -Status 'Done'

Write-Info "DEBUG: analysis object type: $($analysis.GetType().FullName)"
Write-Info "DEBUG: relationships property exists: $($analysis.relationships -ne $null)"
Write-Info "DEBUG: relationships type: $($analysis.relationships.GetType().FullName)"
$relationshipCount = @($analysis.relationships).Count
Write-Info "Total relationships captured: $relationshipCount"
Write-Info "DEBUG: First 3 relationships:"
@($analysis.relationships) | Select-Object -First 3 | ForEach-Object {
    Write-Info "  - $($_.policyName) -> $($_.targetDisplayName) ($($_.scope))"
}

$csvPath = Join-Path -Path $OutputDir -ChildPath 'conditional_access_policies.csv'
$jsonPath = Join-Path -Path $OutputDir -ChildPath 'conditional_access_policies.json'

$csvRows | Export-Csv -Path $csvPath -NoTypeInformation -Encoding UTF8
(ConvertTo-Json $analysis -Depth 20) | Out-File -FilePath $jsonPath -Encoding utf8

Write-Success "Exported CSV to $csvPath"
Write-Success "Exported JSON to $jsonPath"

if (-not $SkipDisconnect) {
    try {
        Disconnect-MgGraph | Out-Null
        Write-Info 'Disconnected from Microsoft Graph.'
    }
    catch {
        Write-Warning "Failed to disconnect cleanly: $($_.Exception.Message)"
    }
}

