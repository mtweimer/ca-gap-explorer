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
    Get-ChildItem -Path $privatePath -Filter '*.ps1' -Recurse | ForEach-Object {
        try {
            . $_.FullName
            Write-Verbose "Imported private function: $($_.BaseName)"
        }
        catch {
            Write-Warning "Failed to import $($_.FullName): $_"
        }
    }
}

# Import public functions
$publicPath = Join-Path -Path $PSScriptRoot -ChildPath 'Public'
if (Test-Path -Path $publicPath) {
    Get-ChildItem -Path $publicPath -Filter '*.ps1' -Recurse | ForEach-Object {
        try {
            . $_.FullName
            Write-Verbose "Imported public function: $($_.BaseName)"
        }
        catch {
            Write-Warning "Failed to import $($_.FullName): $_"
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

# Export module member
Export-ModuleMember -Function @(
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

