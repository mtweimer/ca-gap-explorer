@{
    # Module manifest for CAGapCollector
    
    # Script module or binary module file associated with this manifest
    RootModule = 'CAGapCollector.psm1'
    
    # Version number of this module
    ModuleVersion = '1.0.0'
    
    # ID used to uniquely identify this module
    GUID = 'a8b9c0d1-e2f3-4a5b-6c7d-8e9f0a1b2c3d'
    
    # Author of this module
    Author = 'Hoplite Industries'
    
    # Company or vendor of this module
    CompanyName = 'Hoplite Industries'
    
    # Copyright statement for this module
    Copyright = '(c) 2024-2025 Hoplite Industries. All rights reserved.'
    
    # Description of the functionality provided by this module
    Description = 'Collects and analyzes Microsoft Entra ID Conditional Access Policies to identify security gaps and visualize policy relationships.'
    
    # Minimum version of PowerShell required by this module
    PowerShellVersion = '5.1'
    
    # Modules that must be imported into the global environment prior to importing this module
    RequiredModules = @(
        @{ ModuleName = 'Microsoft.Graph.Authentication'; ModuleVersion = '2.0.0' }
    )
    
    # Functions to export from this module
    FunctionsToExport = @(
        'Connect-CAGapGraph',
        'Disconnect-CAGapGraph',
        'Test-CAGapConnection',
        'Get-CAPolicies',
        'Get-DirectoryObjects',
        'Export-CAGraph',
        'Export-OpenGraph',
        'Get-CAPolicyCoverage',
        'Get-CAExposures',
        'Get-CAGapVersion'
    )
    
    # Cmdlets to export from this module
    CmdletsToExport = @()
    
    # Variables to export from this module
    VariablesToExport = @()
    
    # Aliases to export from this module
    AliasesToExport = @()
    
    # Private data to pass to the module
    PrivateData = @{
        PSData = @{
            # Tags applied to this module for online gallery discoverability
            Tags = @('Azure', 'AzureAD', 'EntraID', 'ConditionalAccess', 'Security', 'Identity', 'BloodHound', 'Graph')
            
            # License URI for this module
            LicenseUri = 'https://github.com/hoplite-industries/conditional-access-gap-analyzer/blob/main/LICENSE'
            
            # Project URI for this module
            ProjectUri = 'https://github.com/hoplite-industries/conditional-access-gap-analyzer'
            
            # Icon URI for this module
            # IconUri = ''
            
            # Release notes for this module
            ReleaseNotes = @'
## 1.0.0
- Initial release
- Collect Conditional Access Policies via Microsoft Graph
- Expand group memberships and role assignments
- Generate graph visualization data
- Export to BloodHound OpenGraph format
- Multiple authentication methods supported
'@
            
            # Prerelease tag
            # Prerelease = ''
        }
    }
}

