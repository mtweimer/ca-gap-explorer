#Requires -Version 5.1
<#
.SYNOPSIS
    Disconnects from Microsoft Graph and clears the session.

.DESCRIPTION
    Terminates the Microsoft Graph connection and clears all cached data.

.EXAMPLE
    Disconnect-CAGapGraph
    
    Disconnects from Microsoft Graph.
#>
function Disconnect-CAGapGraph {
    [CmdletBinding()]
    param()

    try {
        # Clear entity caches
        Clear-EntityCaches
        Clear-RelationshipCache

        # Disconnect from Graph
        Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null

        $script:Connected = $false
        $script:ConnectionInfo = $null

        Write-Host "[CAGapCollector] Disconnected from Microsoft Graph." -ForegroundColor Green
    }
    catch {
        Write-Warning "Error during disconnect: $($_.Exception.Message)"
    }
}

<#
.SYNOPSIS
    Tests if connected to Microsoft Graph.

.DESCRIPTION
    Returns true if there is an active Microsoft Graph connection.

.EXAMPLE
    Test-CAGapConnection
    
    Returns $true if connected, $false otherwise.
#>
function Test-CAGapConnection {
    [CmdletBinding()]
    param()

    try {
        $context = Get-MgContext
        return ($null -ne $context -and $null -ne $context.Account)
    }
    catch {
        return $false
    }
}

<#
.SYNOPSIS
    Gets the current module version.

.DESCRIPTION
    Returns version information for the CAGapCollector module.

.EXAMPLE
    Get-CAGapVersion
    
    Returns the module version and other metadata.
#>
function Get-CAGapVersion {
    [CmdletBinding()]
    param()

    $manifestPath = Join-Path -Path $script:ModuleRoot -ChildPath 'CAGapCollector.psd1'
    $manifest = Import-PowerShellDataFile -Path $manifestPath

    [pscustomobject]@{
        ModuleName = 'CAGapCollector'
        Version = $manifest.ModuleVersion
        Author = $manifest.Author
        Description = $manifest.Description
        ProjectUri = $manifest.PrivateData.PSData.ProjectUri
        Connected = $script:Connected
        ConnectionInfo = $script:ConnectionInfo
    }
}

