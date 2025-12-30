#Requires -Version 5.1
<#
.SYNOPSIS
    Generates graph visualization data from collected policy data.

.DESCRIPTION
    Transforms the collected Conditional Access policy data into a graph format
    suitable for visualization in the web UI.

.PARAMETER InputPath
    Path to the conditional_access_policies.json file.

.PARAMETER OutputPath
    Directory path for output files.

.PARAMETER Format
    Output format: Native, OpenGraph, or Both. Default is Native.

.PARAMETER IncludeMetrics
    Include policy metrics in node properties.

.EXAMPLE
    Export-CAGraph -InputPath ./output/conditional_access_policies.json -OutputPath ./output
    
    Generates the graph JSON in native format.

.EXAMPLE
    Export-CAGraph -InputPath ./output/conditional_access_policies.json -OutputPath ./output -Format Both
    
    Generates both native and OpenGraph formats.
#>
function Export-CAGraph {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$InputPath,

        [Parameter(Mandatory)]
        [string]$OutputPath,

        [Parameter()]
        [ValidateSet('Native', 'OpenGraph', 'Both')]
        [string]$Format = 'Native',

        [Parameter()]
        [switch]$IncludeMetrics
    )

    if (-not (Test-Path -Path $InputPath)) {
        throw "Input file not found: $InputPath"
    }

    if (-not (Test-Path -Path $OutputPath)) {
        New-Item -Path $OutputPath -ItemType Directory -Force | Out-Null
    }

    Write-Host "[CAGapCollector] Loading policy data from $InputPath..." -ForegroundColor Cyan

    $policyData = Get-Content -Path $InputPath -Raw | ConvertFrom-Json -Depth 100

    $graph = [ordered]@{
        generatedAt = (Get-Date).ToString('o')
        metadata = $policyData.metadata
        nodes = @()
        edges = @()
    }

    $nodeIndex = @{}
    $edgeCache = [System.Collections.Generic.HashSet[string]]::new()

    function Add-GraphNode {
        param([string]$Id, [string]$Label, [string]$Type, [object]$Properties)

        if (-not $Id) { return }
        if ($nodeIndex.ContainsKey($Id)) { return }

        $node = [ordered]@{
            id = $Id
            label = $Label
            type = $Type
            properties = $Properties
        }

        $nodeIndex[$Id] = $node
    }

    function Add-GraphEdge {
        param([string]$FromId, [string]$ToId, [string]$Relationship, [hashtable]$Properties)

        if (-not $FromId -or -not $ToId) { return }

        $edgeKey = "$FromId|$ToId|$Relationship"
        if ($edgeCache.Add($edgeKey)) {
            $graph.edges += [ordered]@{
                from = $FromId
                to = $ToId
                relationship = $Relationship
                properties = $Properties
            }
        }
    }

    Write-Host "[CAGapCollector] Building graph from $($policyData.policies.Count) policies..." -ForegroundColor Cyan

    foreach ($policy in $policyData.policies) {
        $policyId = $policy.id
        $policyName = $policy.displayName

        # Build grant controls list
        $grantList = @()
        if ($policy.accessControls.grant) {
            $grant = $policy.accessControls.grant
            if ($grant.builtInControls) { $grantList += @($grant.builtInControls) }
            if ($grant.authenticationStrength.displayName) {
                $grantList += "authStrength:$($grant.authenticationStrength.displayName)"
            }
        }

        # Build conditions summary
        $conditionsSummary = @()
        if ($policy.conditions) {
            if ($policy.conditions.userRiskLevels -and @($policy.conditions.userRiskLevels).Count -gt 0) {
                $conditionsSummary += "UserRisk: $($policy.conditions.userRiskLevels -join ',')"
            }
            if ($policy.conditions.signInRiskLevels -and @($policy.conditions.signInRiskLevels).Count -gt 0) {
                $conditionsSummary += "SignInRisk: $($policy.conditions.signInRiskLevels -join ',')"
            }
        }

        # Build session summary
        $sessionSummary = @()
        if ($policy.accessControls.session) {
            $session = $policy.accessControls.session
            if ($session.signInFrequency) { $sessionSummary += "SignInFrequency" }
            if ($session.persistentBrowser) { $sessionSummary += "PersistentBrowser" }
            if ($session.cloudAppSecurity) { $sessionSummary += "CloudAppSecurity" }
        }

        # Add policy node
        Add-GraphNode -Id $policyId -Label $policyName -Type 'policy' -Properties @{
            state = $policy.state
            createdDateTime = $policy.createdDateTime
            modifiedDateTime = $policy.modifiedDateTime
            grantControls = @($grantList)
            conditionsSummary = $conditionsSummary
            sessionControlsSummary = $sessionSummary
            assignments = $policy.assignments
            targetResources = $policy.targetResources
            conditions = $policy.conditions
            accessControls = $policy.accessControls
        }
    }

    # Process relationships
    if ($policyData.relationships) {
        Write-Host "[CAGapCollector] Processing $($policyData.relationships.Count) relationships..." -ForegroundColor Cyan

        foreach ($rel in $policyData.relationships) {
            $targetId = $rel.targetId
            $targetType = $rel.targetType
            $targetName = $rel.targetDisplayName

            # Add target node if not exists
            if ($targetId -and -not $nodeIndex.ContainsKey($targetId)) {
                Add-GraphNode -Id $targetId -Label $targetName -Type $targetType -Properties @{
                    displayName = $targetName
                }
            }

            # Add edge
            Add-GraphEdge -FromId $rel.policyId -ToId $targetId -Relationship "$($rel.scope):$targetType" -Properties @{
                policyName = $rel.policyName
                targetDisplayName = $targetName
                via = $rel.via
                description = $rel.description
            }
        }
    }

    # Add entity nodes from entities collection
    if ($policyData.entities) {
        foreach ($entityType in @('users', 'groups', 'roles', 'servicePrincipals', 'namedLocations')) {
            $singularType = $entityType.TrimEnd('s')
            if ($singularType -eq 'namedLocation') { $singularType = 'namedLocation' }
            
            $collection = $policyData.entities.$entityType
            if ($collection) {
                foreach ($entityId in $collection.PSObject.Properties.Name) {
                    $entity = $collection.$entityId
                    $label = if ($entity.displayName) { $entity.displayName } else { $entityId }
                    Add-GraphNode -Id $entityId -Label $label -Type $singularType -Properties $entity
                }
            }
        }
    }

    $graph.nodes = @($nodeIndex.Values)

    Write-Host "[CAGapCollector] Graph built: $($graph.nodes.Count) nodes, $($graph.edges.Count) edges" -ForegroundColor Green

    # Save outputs
    if ($Format -eq 'Native' -or $Format -eq 'Both') {
        $nativePath = Join-Path -Path $OutputPath -ChildPath 'conditional_access_graph.json'
        $graph | ConvertTo-Json -Depth 20 | Out-File -FilePath $nativePath -Encoding utf8
        Write-Host "[CAGapCollector] Native graph saved to: $nativePath" -ForegroundColor Green
    }

    if ($Format -eq 'OpenGraph' -or $Format -eq 'Both') {
        Export-OpenGraph -InputPath $InputPath -OutputPath $OutputPath
    }

    return [pscustomobject]@{
        NodesCount = $graph.nodes.Count
        EdgesCount = $graph.edges.Count
        OutputPath = $OutputPath
        Format = $Format
    }
}

