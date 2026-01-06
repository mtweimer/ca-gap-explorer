#Requires -Version 5.1
<#
.SYNOPSIS
    CAGapCollector - Conditional Access Gap Analyzer PowerShell Module

.DESCRIPTION
    Collects and analyzes Microsoft Entra ID Conditional Access Policies to identify 
    security gaps and visualize policy relationships.

.NOTES
    Author: Hoplite Industries
    Version: 1.0.0
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Module-level variables
$script:ModuleRoot = $PSScriptRoot
$script:Connected = $false
$script:ConnectionInfo = $null

# Caches for entity resolution
$script:UserCache = @{}
$script:GroupCache = @{}
$script:GroupMembersCache = @{}
$script:RoleMembersCache = @{}
$script:ServicePrincipalCache = @{}
$script:NamedLocationCache = @{}
$script:RoleTemplateCache = @{}

# Import private functions
$privatePath = Join-Path -Path $PSScriptRoot -ChildPath 'Private'
if (Test-Path -Path $privatePath) {
    $privateFiles = @(Get-ChildItem -Path $privatePath -Filter '*.ps1' -File -ErrorAction SilentlyContinue)
    foreach ($file in $privateFiles) {
        try {
            . $file.FullName
            Write-Verbose "Imported private function: $($file.BaseName)"
        }
        catch {
            Write-Warning "Failed to import $($file.FullName): $_"
        }
    }
}

# Import public functions
$publicPath = Join-Path -Path $PSScriptRoot -ChildPath 'Public'
if (Test-Path -Path $publicPath) {
    $publicFiles = @(Get-ChildItem -Path $publicPath -Filter '*.ps1' -File -ErrorAction SilentlyContinue)
    foreach ($file in $publicFiles) {
        try {
            . $file.FullName
            Write-Verbose "Imported public function: $($file.BaseName)"
        }
        catch {
            Write-Warning "Failed to import $($file.FullName): $_"
        }
    }
}

# Module cleanup
$MyInvocation.MyCommand.ScriptBlock.Module.OnRemove = {
    # Clear caches
    $script:UserCache.Clear()
    $script:GroupCache.Clear()
    $script:GroupMembersCache.Clear()
    $script:RoleMembersCache.Clear()
    $script:ServicePrincipalCache.Clear()
    $script:NamedLocationCache.Clear()
    $script:RoleTemplateCache.Clear()
    
    # Disconnect if connected
    if ($script:Connected) {
        try {
            Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
        }
        catch {
            # Ignore disconnect errors on module unload
        }
    }
}

# Export module member - Public functions from Public/*.ps1
Export-ModuleMember -Function @(
    # Connection management (Disconnect-CAGapGraph.ps1)
    'Connect-CAGapGraph',
    'Disconnect-CAGapGraph',
    'Test-CAGapConnection',
    'Get-CAGapVersion',
    # Collection functions
    'Get-CAPolicies',          # Get-CAPolicies.ps1
    'Get-DirectoryObjects',    # Get-CAAnalysis.ps1
    # Export functions
    'Export-CAGraph',          # Export-CAGraph.ps1
    'Export-OpenGraph',        # Export-OpenGraph.ps1
    # Analysis functions (Get-CAAnalysis.ps1)
    'Get-CAPolicyCoverage',
    'Get-CAExposures'
)

