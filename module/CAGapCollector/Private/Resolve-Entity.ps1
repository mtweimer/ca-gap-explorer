#Requires -Version 5.1
<#
.SYNOPSIS
    Internal functions for resolving and caching entity information.
#>

function Get-PropertyValue {
    <#
    .SYNOPSIS
        Safely retrieves a property value from an object.
    #>
    param(
        [object]$Object,
        [string]$PropertyName
    )

    if (-not $Object) { return $null }
    if (-not $PropertyName) { return $null }

    # IDictionary (e.g., OrderedDictionary, Hashtable)
    if ($Object -is [System.Collections.IDictionary]) {
        $dict = [System.Collections.IDictionary]$Object
        if ($dict.Contains($PropertyName)) { return $dict[$PropertyName] }
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

    # Case-insensitive PSObject lookup
    foreach ($prop in $Object.PSObject.Properties) {
        if ([string]::Equals($prop.Name, $PropertyName, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $prop.Value
        }
    }

    return $null
}

function To-Array {
    <#
    .SYNOPSIS
        Converts a value to an array.
    #>
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
    <#
    .SYNOPSIS
        Converts a PSObject to an ordered hashtable.
    #>
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

function Get-UserById {
    <#
    .SYNOPSIS
        Retrieves a user by ID with caching.
    #>
    param([string]$Id)

    if (-not $Id) { return $null }

    if ($script:UserCache.ContainsKey($Id)) {
        return $script:UserCache[$Id]
    }

    try {
        $user = Get-MgUser -UserId $Id -Select Id,DisplayName,UserPrincipalName,Mail,AccountEnabled -ErrorAction Stop
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
        Write-Verbose "Failed to resolve user $($Id): $($_.Exception.Message)"
    }

    return $null
}

function Get-GroupById {
    <#
    .SYNOPSIS
        Retrieves a group by ID with caching.
    #>
    param([string]$Id)

    if (-not $Id) { return $null }

    if ($script:GroupCache.ContainsKey($Id)) {
        return $script:GroupCache[$Id]
    }

    try {
        $group = Get-MgGroup -GroupId $Id -Select Id,DisplayName,Mail,MailEnabled,SecurityEnabled,GroupTypes -ErrorAction Stop
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
        Write-Verbose "Failed to resolve group $($Id): $($_.Exception.Message)"
    }

    return $null
}

function Get-ServicePrincipalById {
    <#
    .SYNOPSIS
        Retrieves a service principal by ID with caching.
    #>
    param([string]$Id)

    if (-not $Id) { return $null }

    if ($script:ServicePrincipalCache.ContainsKey($Id)) {
        return $script:ServicePrincipalCache[$Id]
    }

    try {
        $sp = Get-MgServicePrincipal -ServicePrincipalId $Id -Select Id,DisplayName,AppId,ServicePrincipalType -ErrorAction Stop
        if ($sp) {
            $entity = [pscustomobject]@{
                id = $sp.Id
                displayName = $sp.DisplayName
                appId = $sp.AppId
                servicePrincipalType = $sp.ServicePrincipalType
                type = 'servicePrincipal'
            }
            $script:ServicePrincipalCache[$Id] = $entity
            return $entity
        }
    }
    catch {
        Write-Verbose "Failed to get service principal by ID $($Id): $($_.Exception.Message)"
        
        # Try resolving by appId
        try {
            $byApp = Get-MgServicePrincipal -Filter "appId eq '$Id'" -Select Id,DisplayName,AppId,ServicePrincipalType -ErrorAction Stop
            $sp = $byApp | Select-Object -First 1
            if ($sp) {
                $entity = [pscustomobject]@{
                    id = $sp.Id
                    displayName = $sp.DisplayName
                    appId = $sp.AppId
                    servicePrincipalType = $sp.ServicePrincipalType
                    type = 'servicePrincipal'
                }
                $script:ServicePrincipalCache[$entity.id] = $entity
                return $entity
            }
        }
        catch {
            Write-Verbose "Failed to find service principal by appId $($Id): $($_.Exception.Message)"
        }
    }

    return $null
}

function Get-NamedLocationById {
    <#
    .SYNOPSIS
        Retrieves a named location by ID with caching.
    #>
    param([string]$Id)

    if (-not $Id) { return $null }

    # Initialize cache if empty
    if ($script:NamedLocationCache.Count -eq 0) {
        Initialize-NamedLocations
    }

    if ($script:NamedLocationCache.ContainsKey($Id)) {
        return $script:NamedLocationCache[$Id]
    }

    return $null
}

function Initialize-NamedLocations {
    <#
    .SYNOPSIS
        Loads all named locations into the cache.
    #>
    if ($script:NamedLocationCache.Count -gt 0) {
        return
    }

    try {
        $locations = Get-MgIdentityConditionalAccessNamedLocation -All -ErrorAction Stop
        foreach ($location in $locations) {
            $odataType = $location.AdditionalProperties['@odata.type']
            $typeName = if ($odataType) { $odataType.Split('.')[-1] } else { 'namedLocation' }
            
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

function Initialize-RoleTemplates {
    <#
    .SYNOPSIS
        Loads all directory role templates into the cache.
    #>
    if ($script:RoleTemplateCache.Count -gt 0) {
        return
    }

    try {
        $roles = Get-MgDirectoryRole -All -ErrorAction Stop
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
        $templates = Get-MgDirectoryRoleTemplate -All -ErrorAction Stop
        foreach ($template in $templates) {
            if (-not $script:RoleTemplateCache.ContainsKey($template.Id)) {
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

function Clear-EntityCaches {
    <#
    .SYNOPSIS
        Clears all entity caches.
    #>
    $script:UserCache.Clear()
    $script:GroupCache.Clear()
    $script:GroupMembersCache.Clear()
    $script:RoleMembersCache.Clear()
    $script:ServicePrincipalCache.Clear()
    $script:NamedLocationCache.Clear()
    $script:RoleTemplateCache.Clear()
}

