#Requires -Version 5.1
<#
.SYNOPSIS
    Exports graph data to BloodHound OpenGraph format.

.DESCRIPTION
    Transforms the Conditional Access graph data into BloodHound CE's OpenGraph
    JSON format for import and visualization.

.PARAMETER InputPath
    Path to the conditional_access_graph.json or conditional_access_policies.json file.

.PARAMETER OutputPath
    Directory path for OpenGraph output files.

.PARAMETER IncludeTypes
    Node types to include. Default is all types.

.PARAMETER ExcludeTypes
    Node types to exclude.

.PARAMETER SplitByType
    Create separate files per node type.

.PARAMETER Version
    OpenGraph schema version. Default is 6.

.EXAMPLE
    Export-OpenGraph -InputPath ./output/conditional_access_graph.json -OutputPath ./output/opengraph
    
    Exports to OpenGraph format.

.EXAMPLE
    Export-OpenGraph -InputPath ./output/conditional_access_graph.json -OutputPath ./output/opengraph -SplitByType
    
    Exports to separate files per type.
#>
function Export-OpenGraph {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$InputPath,

        [Parameter(Mandatory)]
        [string]$OutputPath,

        [Parameter()]
        [string[]]$IncludeTypes,

        [Parameter()]
        [string[]]$ExcludeTypes,

        [Parameter()]
        [switch]$SplitByType,

        [Parameter()]
        [int]$Version = 6
    )

    if (-not (Test-Path -Path $InputPath)) {
        throw "Input file not found: $InputPath"
    }

    if (-not (Test-Path -Path $OutputPath)) {
        New-Item -Path $OutputPath -ItemType Directory -Force | Out-Null
    }

    Write-Host "[CAGapCollector] Loading data for OpenGraph export..." -ForegroundColor Cyan

    $data = Get-Content -Path $InputPath -Raw | ConvertFrom-Json -Depth 100

    # Determine if input is graph or policy data
    $nodes = @()
    $edges = @()
    
    if ($data.nodes) {
        $nodes = $data.nodes
        $edges = $data.edges
    }
    elseif ($data.policies) {
        # Build from policy data
        Write-Host "[CAGapCollector] Building graph from policy data..." -ForegroundColor Cyan
        # This would reuse the graph building logic
        throw "Please provide conditional_access_graph.json. Use Export-CAGraph first to generate it."
    }

    # Type mapping to OpenGraph kinds
    $typeMapping = @{
        'user' = 'AZUser'
        'group' = 'AZGroup'
        'role' = 'AZRole'
        'servicePrincipal' = 'AZServicePrincipal'
        'policy' = 'CAPolicy'
        'namedLocation' = 'CANamedLocation'
        'device' = 'AZDevice'
        'organization' = 'AZTenant'
        'keyword' = 'CAKeyword'
        'condition' = 'CACondition'
        'authenticationContext' = 'CAAuthContext'
    }

    # Relationship mapping
    $relationshipMapping = @{
        'include:user' = 'CAPolicyIncludes'
        'exclude:user' = 'CAPolicyExcludes'
        'include:group' = 'CAPolicyIncludesGroup'
        'exclude:group' = 'CAPolicyExcludesGroup'
        'include:role' = 'CAPolicyIncludesRole'
        'exclude:role' = 'CAPolicyExcludesRole'
        'include:servicePrincipal' = 'CAPolicyIncludesApp'
        'exclude:servicePrincipal' = 'CAPolicyExcludesApp'
        'include:namedLocation' = 'CAPolicyIncludesLocation'
        'exclude:namedLocation' = 'CAPolicyExcludesLocation'
        'include:keyword' = 'CAPolicyIncludesKeyword'
        'exclude:keyword' = 'CAPolicyExcludesKeyword'
    }

    # Filter nodes
    $filteredNodes = $nodes
    if ($IncludeTypes) {
        $filteredNodes = $filteredNodes | Where-Object { $IncludeTypes -contains $_.type }
    }
    if ($ExcludeTypes) {
        $filteredNodes = $filteredNodes | Where-Object { $ExcludeTypes -notcontains $_.type }
    }

    Write-Host "[CAGapCollector] Converting $(@($filteredNodes).Count) nodes to OpenGraph format..." -ForegroundColor Cyan

    # Build OpenGraph data
    $openGraphData = [System.Collections.ArrayList]@()

    # Convert nodes
    foreach ($node in $filteredNodes) {
        $kind = $typeMapping[$node.type]
        if (-not $kind) { $kind = "CA$($node.type)" }

        $ogNode = [ordered]@{
            kind = $kind
            id = $node.id
            props = [ordered]@{
                displayname = $node.label
                name = $node.label
            }
        }

        # Add additional properties
        if ($node.properties) {
            $props = $node.properties
            if ($props.userPrincipalName) { $ogNode.props.userprincipalname = $props.userPrincipalName }
            if ($props.mail) { $ogNode.props.mail = $props.mail }
            if ($props.appId) { $ogNode.props.appid = $props.appId }
            if ($props.state) { $ogNode.props.state = $props.state }
            if ($props.grantControls) { $ogNode.props.grantcontrols = ($props.grantControls -join ',') }
        }

        [void]$openGraphData.Add($ogNode)
    }

    # Convert edges to relationships
    $nodeIds = @{}
    foreach ($node in $filteredNodes) {
        $nodeIds[$node.id] = $true
    }

    foreach ($edge in $edges) {
        # Only include edges where both nodes exist
        if (-not $nodeIds[$edge.from] -or -not $nodeIds[$edge.to]) {
            continue
        }

        $relType = $relationshipMapping[$edge.relationship]
        if (-not $relType) {
            $relType = "CA_$($edge.relationship -replace ':', '_')"
        }

        $ogEdge = [ordered]@{
            kind = 'Relationship'
            source = $edge.from
            target = $edge.to
            type = $relType
            props = [ordered]@{}
        }

        if ($edge.properties) {
            if ($edge.properties.via) {
                $ogEdge.props.via = ($edge.properties.via -join ' > ')
            }
            if ($edge.properties.description) {
                $ogEdge.props.description = $edge.properties.description
            }
        }

        [void]$openGraphData.Add($ogEdge)
    }

    # Build final OpenGraph structure
    $openGraph = [ordered]@{
        meta = [ordered]@{
            type = 'azure'
            version = $Version
            collected = (Get-Date).ToString('o')
            methods = 0
        }
        data = $openGraphData
    }

    if ($SplitByType) {
        # Group by type and save separately
        $byType = @{}
        foreach ($item in $openGraphData) {
            $kind = $item.kind
            if (-not $byType[$kind]) {
                $byType[$kind] = [System.Collections.ArrayList]@()
            }
            [void]$byType[$kind].Add($item)
        }

        foreach ($kind in $byType.Keys) {
            $typeGraph = [ordered]@{
                meta = $openGraph.meta
                data = $byType[$kind]
            }
            $typePath = Join-Path -Path $OutputPath -ChildPath "$($kind.ToLower()).json"
            $typeGraph | ConvertTo-Json -Depth 20 | Out-File -FilePath $typePath -Encoding utf8
            Write-Host "[CAGapCollector] Saved $kind to: $typePath" -ForegroundColor Green
        }
    }
    else {
        $outputFile = Join-Path -Path $OutputPath -ChildPath 'ca_opengraph.json'
        $openGraph | ConvertTo-Json -Depth 20 | Out-File -FilePath $outputFile -Encoding utf8
        Write-Host "[CAGapCollector] OpenGraph export saved to: $outputFile" -ForegroundColor Green
    }

    return [pscustomobject]@{
        NodesCount = @($filteredNodes).Count
        EdgesCount = @($edges | Where-Object { $nodeIds[$_.from] -and $nodeIds[$_.to] }).Count
        OutputPath = $OutputPath
        Version = $Version
        SplitByType = $SplitByType.IsPresent
    }
}

