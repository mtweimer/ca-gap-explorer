# API Reference

Complete reference for the CAGapCollector PowerShell module.

## Connection Commands

### Connect-CAGapGraph

Establishes a connection to Microsoft Graph.

```powershell
Connect-CAGapGraph [-UseDeviceCode] [-Interactive] [-ClientId <String>] 
                   [-ClientSecret <String>] [-TenantId <String>] 
                   [-CertificateThumbprint <String>] [-ManagedIdentity]
                   [-Scopes <String[]>]
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `-UseDeviceCode` | Switch | No | Use device code authentication flow |
| `-Interactive` | Switch | No | Use interactive browser authentication |
| `-ClientId` | String | For app auth | Application (client) ID |
| `-ClientSecret` | String | For secret auth | Client secret value |
| `-TenantId` | String | For app auth | Directory (tenant) ID |
| `-CertificateThumbprint` | String | For cert auth | Certificate thumbprint |
| `-ManagedIdentity` | Switch | No | Use Azure Managed Identity |
| `-Scopes` | String[] | No | Additional scopes to request |

#### Examples

```powershell
# Device code flow
Connect-CAGapGraph -UseDeviceCode

# Client credentials
Connect-CAGapGraph -ClientId "00000000-0000-0000-0000-000000000000" `
                   -ClientSecret "your-secret" `
                   -TenantId "your-tenant-id"

# Certificate-based
Connect-CAGapGraph -ClientId "00000000-0000-0000-0000-000000000000" `
                   -CertificateThumbprint "ABC123..." `
                   -TenantId "your-tenant-id"
```

---

### Disconnect-CAGapGraph

Disconnects from Microsoft Graph and clears the session.

```powershell
Disconnect-CAGapGraph
```

---

## Collection Commands

### Get-CAPolicies

Collects Conditional Access policies and resolves all relationships.

```powershell
Get-CAPolicies [-OutputPath <String>] [-ExpandGroups] [-ExpandRoles] 
               [-MaxDepth <Int32>] [-PolicyFilter <ScriptBlock>]
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `-OutputPath` | String | Yes | Directory for output files |
| `-ExpandGroups` | Switch | No | Expand group memberships (default: true) |
| `-ExpandRoles` | Switch | No | Expand role assignments (default: true) |
| `-MaxDepth` | Int32 | No | Maximum nesting depth for groups (default: 3) |
| `-PolicyFilter` | ScriptBlock | No | Filter policies by criteria |

#### Output Files

- `conditional_access_policies.json` - Full policy data with relationships
- `conditional_access_policies.csv` - Flattened policy summary
- `entities/users.json` - User entity details
- `entities/groups.json` - Group entity details
- `entities/roles.json` - Role entity details
- `entities/service_principals.json` - Application details
- `entities/named_locations.json` - Named location details
- `entities/counts.json` - Entity counts summary

#### Examples

```powershell
# Basic collection
Get-CAPolicies -OutputPath ./output

# Without group expansion (faster)
Get-CAPolicies -OutputPath ./output -ExpandGroups:$false

# Filter to enabled policies only
Get-CAPolicies -OutputPath ./output -PolicyFilter { $_.State -eq 'enabled' }

# Limit nesting depth
Get-CAPolicies -OutputPath ./output -MaxDepth 2
```

---

### Get-DirectoryObjects

Collects directory objects (users, groups, etc.) for entity resolution.

```powershell
Get-DirectoryObjects [-OutputPath <String>] [-Types <String[]>]
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `-OutputPath` | String | Yes | Directory for output files |
| `-Types` | String[] | No | Object types to collect (default: all) |

#### Examples

```powershell
# Collect all object types
Get-DirectoryObjects -OutputPath ./output

# Collect specific types
Get-DirectoryObjects -OutputPath ./output -Types User,Group
```

---

## Export Commands

### Export-CAGraph

Generates the graph visualization JSON from collected policy data.

```powershell
Export-CAGraph [-InputPath <String>] [-OutputPath <String>] 
               [-Format <String>] [-IncludeMetrics]
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `-InputPath` | String | Yes | Path to conditional_access_policies.json |
| `-OutputPath` | String | Yes | Directory for output files |
| `-Format` | String | No | Output format: Native, OpenGraph, Both (default: Native) |
| `-IncludeMetrics` | Switch | No | Include policy metrics in node properties |

#### Examples

```powershell
# Generate native format
Export-CAGraph -InputPath ./output/conditional_access_policies.json `
               -OutputPath ./output

# Generate OpenGraph format
Export-CAGraph -InputPath ./output/conditional_access_policies.json `
               -OutputPath ./output `
               -Format OpenGraph

# Generate both formats
Export-CAGraph -InputPath ./output/conditional_access_policies.json `
               -OutputPath ./output `
               -Format Both
```

---

### Export-OpenGraph

Exports graph data to BloodHound OpenGraph format.

```powershell
Export-OpenGraph [-InputPath <String>] [-OutputPath <String>]
                 [-IncludeTypes <String[]>] [-ExcludeTypes <String[]>]
                 [-SplitByType] [-Version <Int32>]
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `-InputPath` | String | Yes | Path to conditional_access_graph.json |
| `-OutputPath` | String | Yes | Directory for OpenGraph files |
| `-IncludeTypes` | String[] | No | Node types to include |
| `-ExcludeTypes` | String[] | No | Node types to exclude |
| `-SplitByType` | Switch | No | Create separate files per type |
| `-Version` | Int32 | No | OpenGraph schema version (default: 6) |

#### Examples

```powershell
# Full export
Export-OpenGraph -InputPath ./output/conditional_access_graph.json `
                 -OutputPath ./output/opengraph

# Entities only (no policies)
Export-OpenGraph -InputPath ./output/conditional_access_graph.json `
                 -OutputPath ./output/opengraph `
                 -ExcludeTypes Policy

# Split into multiple files
Export-OpenGraph -InputPath ./output/conditional_access_graph.json `
                 -OutputPath ./output/opengraph `
                 -SplitByType
```

---

## Analysis Commands

### Get-CAPolicyCoverage

Analyzes policy coverage for users and applications.

```powershell
Get-CAPolicyCoverage [-GraphPath <String>] [-GroupBy <String>]
                     [-OutputFormat <String>]
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `-GraphPath` | String | Yes | Path to graph JSON |
| `-GroupBy` | String | No | Group results by: Policy, GrantControl, Condition |
| `-OutputFormat` | String | No | Output format: Object, Table, Json |

#### Examples

```powershell
# Get coverage summary
Get-CAPolicyCoverage -GraphPath ./output/conditional_access_graph.json

# Group by grant control
Get-CAPolicyCoverage -GraphPath ./output/conditional_access_graph.json `
                     -GroupBy GrantControl

# Output as JSON
Get-CAPolicyCoverage -GraphPath ./output/conditional_access_graph.json `
                     -OutputFormat Json
```

---

### Get-CAExposures

Identifies entities not covered by Conditional Access policies.

```powershell
Get-CAExposures [-GraphPath <String>] [-EntityType <String>]
                [-MinimumCoverage <Int32>]
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `-GraphPath` | String | Yes | Path to graph JSON |
| `-EntityType` | String | No | Filter by entity type |
| `-MinimumCoverage` | Int32 | No | Minimum coverage percentage to flag |

#### Examples

```powershell
# Find all exposures
Get-CAExposures -GraphPath ./output/conditional_access_graph.json

# Find uncovered users only
Get-CAExposures -GraphPath ./output/conditional_access_graph.json `
                -EntityType User

# Find entities with less than 50% coverage
Get-CAExposures -GraphPath ./output/conditional_access_graph.json `
                -MinimumCoverage 50
```

---

## Utility Commands

### Test-CAGapConnection

Tests the current Microsoft Graph connection.

```powershell
Test-CAGapConnection
```

Returns `$true` if connected, `$false` otherwise.

---

### Get-CAGapVersion

Returns the module version information.

```powershell
Get-CAGapVersion
```

---

## Common Patterns

### Full Collection Pipeline

```powershell
# Connect
Connect-CAGapGraph -UseDeviceCode

# Collect everything
Get-CAPolicies -OutputPath ./output -Verbose
Get-DirectoryObjects -OutputPath ./output

# Generate graphs
Export-CAGraph -InputPath ./output/conditional_access_policies.json `
               -OutputPath ./output `
               -Format Both

# Analyze
$coverage = Get-CAPolicyCoverage -GraphPath ./output/conditional_access_graph.json
$exposures = Get-CAExposures -GraphPath ./output/conditional_access_graph.json

# Disconnect
Disconnect-CAGapGraph
```

### Automation Script

```powershell
# automation.ps1
param(
    [Parameter(Mandatory)]
    [string]$TenantId,
    [Parameter(Mandatory)]
    [string]$ClientId,
    [Parameter(Mandatory)]
    [SecureString]$ClientSecret
)

Import-Module CAGapCollector

try {
    Connect-CAGapGraph -ClientId $ClientId `
                       -ClientSecret (ConvertFrom-SecureString $ClientSecret -AsPlainText) `
                       -TenantId $TenantId
    
    Get-CAPolicies -OutputPath ./output
    Export-CAGraph -InputPath ./output/conditional_access_policies.json -OutputPath ./output
    
    Write-Host "Collection completed successfully"
}
finally {
    Disconnect-CAGapGraph
}
```

