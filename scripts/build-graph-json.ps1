param(
    [string]$InputJsonPath = (Join-Path -Path (Join-Path -Path $PSScriptRoot -ChildPath '..') -ChildPath 'output/conditional_access_policies.json'),
    [string]$OutputJsonPath = (Join-Path -Path (Join-Path -Path $PSScriptRoot -ChildPath '..') -ChildPath 'output/conditional_access_graph.json')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $InputJsonPath)) {
    throw "Input JSON not found at $InputJsonPath. Run collect-conditional-access.ps1 first."
}

Write-Host "Loading policy data from $InputJsonPath" -ForegroundColor Cyan
$policyData = Get-Content -Path $InputJsonPath -Raw | ConvertFrom-Json -Depth 100

$graph = [ordered]@{
    generatedAt = (Get-Date).ToString('o')
    metadata = $policyData.metadata
    nodes = @()
    edges = @()
}

$nodeIndex = @{}

function Get-Prop {
    param([object]$o, [string]$name)
    if (-not $o -or -not $name) { return $null }
    if ($o -is [System.Collections.IDictionary]) {
        $d = [System.Collections.IDictionary]$o
        if ($d.Contains($name)) { return $d[$name] }
        foreach ($k in $d.Keys) { if ([string]::Equals([string]$k, $name, [System.StringComparison]::OrdinalIgnoreCase)) { return $d[$k] } }
        return $null
    }
    $p = $o.PSObject.Properties[$name]
    if ($p) { return $p.Value }
    foreach ($pp in $o.PSObject.Properties) { if ([string]::Equals($pp.Name, $name, [System.StringComparison]::OrdinalIgnoreCase)) { return $pp.Value } }
    return $null
}

function Add-Node {
    param(
        [string]$Id,
        [string]$Label,
        [string]$Type,
        [object]$Properties
    )

    if (-not $Id) { return }
    if ($nodeIndex.ContainsKey($Id)) { return }

    $node = [ordered]@{
        id = $Id
        label = $Label
        type = $Type
        properties = $Properties
    }

    $nodeIndex[$Id] = $node
    $graph.nodes += $node
}

$script:EdgeCache = [System.Collections.Generic.HashSet[string]]::new()

function Add-Edge {
    param(
        [string]$FromId,
        [string]$ToId,
        [string]$Relationship,
        [hashtable]$Properties
    )

    if (-not $FromId -or -not $ToId) { return }

    # Deduplicate edges: same from/to/relationship = same edge
    $edgeKey = "$FromId|$ToId|$Relationship"
    if ($script:EdgeCache.Add($edgeKey)) {
    $graph.edges += [ordered]@{
        from = $FromId
        to = $ToId
        relationship = $Relationship
        properties = $Properties
    }
    }
}

# Resolve a generic keyword (e.g., "All", "None") to a concrete domain and label
function Resolve-KeywordContext {
    param(
        [object]$PolicyObj,
        [string]$Scope,   # include | exclude
        [string]$Keyword  # e.g., All, AllUsers, None, AllTrusted
    )

    $result = @{ type = $null; label = $null }
    if (-not $PolicyObj) { return $result }

    # Helper to normalize keywords collection to array
    function To-Array { param($x) if ($null -eq $x) { return @() } return @($x) }

    # Check assignments → users/groups/roles/servicePrincipals for keywords
    $assign = Get-Prop $PolicyObj 'assignments'
    if ($assign) {
        $scoped = Get-Prop $assign $Scope
        if ($scoped) {
            $users = Get-Prop $scoped 'users'
            $userKws = To-Array (Get-Prop $users 'keywords')
            if (-not $result.type -and (@($userKws)).Count -gt 0) {
                if (@($userKws) -contains 'All' -or @($userKws) -contains 'AllUsers') { $result.type = 'user'; $result.label = 'All Users' }
                elseif (@($userKws) -contains 'None') { $result.type = 'user'; $result.label = 'No Users' }
            }

            $sps = Get-Prop $scoped 'servicePrincipals'
            $spKws = To-Array (Get-Prop $sps 'keywords')
            if (-not $result.type -and (@($spKws)).Count -gt 0) {
                if (@($spKws) -contains 'All' -or @($spKws) -contains 'AllApps') { $result.type = 'servicePrincipal'; $result.label = 'All Applications' }
                elseif (@($spKws) -contains 'None') { $result.type = 'servicePrincipal'; $result.label = 'No Applications' }
            }
        }
    }

    # Check targetResources → applications
    if (-not $result.type) {
        $tr = Get-Prop $PolicyObj 'targetResources'
        if ($tr) {
            $apps = Get-Prop $tr 'applications'
            if ($apps) {
                $appsScoped = Get-Prop $apps $Scope
                $appKws = To-Array (Get-Prop $appsScoped 'keywords')
                if ((@($appKws)).Count -gt 0) {
                    if (@($appKws) -contains 'All' -or @($appKws) -contains 'AllApps') { $result.type = 'servicePrincipal'; $result.label = 'All Applications' }
                    elseif (@($appKws) -contains 'None') { $result.type = 'servicePrincipal'; $result.label = 'No Applications' }
                }
            }
        }
    }

    # Check conditions → locations
    if (-not $result.type) {
        $conds = Get-Prop $PolicyObj 'conditions'
        $locs = Get-Prop $conds 'locations'
        if ($locs) {
            $locScoped = Get-Prop $locs $Scope
            $locKws = To-Array (Get-Prop $locScoped 'keywords')
            if ((@($locKws)).Count -gt 0) {
                if ((@($locKws)) | Where-Object { $_ -match 'AllTrusted' }) { $result.type = 'namedLocation'; $result.label = 'All Trusted Locations' }
                elseif ((@($locKws)) -contains 'All') { $result.type = 'namedLocation'; $result.label = 'All Locations' }
            }
        }
    }

    return $result
}

foreach ($policy in $policyData.policies) {
    $policyId = $policy.id
    $policyName = $policy.displayName

    # derive grant controls (flatten)
    $grant = Get-Prop (Get-Prop $policy 'accessControls') 'grant'
    $grantList = @()
    if ($grant) {
        $builtIn = Get-Prop $grant 'builtInControls'
        if ($builtIn) { $grantList += @($builtIn) }
        $authName = Get-Prop (Get-Prop $grant 'authenticationStrength') 'displayName'
        if ($authName) { $grantList += ("authStrength:" + $authName) }
        $req = Get-Prop $grant 'authenticationStrengthRequirement'
        if ($req) { $grantList += ("authRequirement:" + $req) }
    }

    # compute metrics from relationships for this policy
    $rels = @()
    if ($policyData.relationships) {
        $rels = @($policyData.relationships | Where-Object { $_.policyId -eq $policyId })
    }
    $metric = [ordered]@{
        includes = [ordered]@{ users = 0; groups = 0; roles = 0; servicePrincipals = 0; namedLocations = 0 }
        excludes = [ordered]@{ users = 0; groups = 0; roles = 0; servicePrincipals = 0; namedLocations = 0 }
        totalEdges = (@($rels)).Count
    }
    foreach ($r in $rels) {
        $t = $r.targetType
        $scope = $r.scope
        if ($scope -eq 'include') {
            if ($metric.includes.Contains($t)) { $metric.includes[$t] = [int]$metric.includes[$t] + 1 }
        }
        elseif ($scope -eq 'exclude') {
            if ($metric.excludes.Contains($t)) { $metric.excludes[$t] = [int]$metric.excludes[$t] + 1 }
        }
    }

    # Build comprehensive conditions summary for policy node
    $conditionsSummary = @()
    $conds = Get-Prop $policy 'conditions'
    if ($conds) {
        $userRisk = Get-Prop $conds 'userRiskLevels'
        if ($userRisk -and @($userRisk).Count -gt 0) { $conditionsSummary += "UserRisk: $($userRisk -join ',')" }
        
        $signInRisk = Get-Prop $conds 'signInRiskLevels'
        if ($signInRisk -and @($signInRisk).Count -gt 0) { $conditionsSummary += "SignInRisk: $($signInRisk -join ',')" }
        
        $insiderRisk = Get-Prop $conds 'insiderRiskLevels'
        if ($insiderRisk -and (Get-Prop $insiderRisk 'configured')) { 
            $levels = Get-Prop $insiderRisk 'levels'
            if ($levels) { $conditionsSummary += "InsiderRisk: $($levels -join ',')" }
        }
        
        $authFlows = Get-Prop $conds 'authenticationFlows'
        if ($authFlows -and (Get-Prop $authFlows 'configured')) {
            $methods = Get-Prop $authFlows 'transferMethods'
            if ($methods) { $conditionsSummary += "AuthFlows: $($methods -join ',')" }
        }
        
        $deviceFilter = Get-Prop $conds 'deviceFilter'
        if ($deviceFilter -and (Get-Prop $deviceFilter 'configured')) {
            $conditionsSummary += "DeviceFilter: $(Get-Prop $deviceFilter 'mode')"
        }
    }
    
    # Build session controls summary
    $sessionSummary = @()
    $session = Get-Prop (Get-Prop $policy 'accessControls') 'session'
    if ($session) {
        if (Get-Prop $session 'signInFrequency') { $sessionSummary += "SignInFrequency" }
        if (Get-Prop $session 'persistentBrowser') { $sessionSummary += "PersistentBrowser" }
        if (Get-Prop $session 'continuousAccessEvaluation') { $sessionSummary += "CAE" }
        if (Get-Prop $session 'tokenProtection') { $sessionSummary += "TokenProtection" }
        if (Get-Prop $session 'cloudAppSecurity') { $sessionSummary += "CloudAppSecurity" }
    }

    Add-Node -Id $policyId -Label $policyName -Type 'policy' -Properties (@{
        state = $policy.state
        createdDateTime = $policy.createdDateTime
        modifiedDateTime = $policy.modifiedDateTime
        grantControls = @($grantList)
        conditionsSummary = $conditionsSummary
        sessionControlsSummary = $sessionSummary
        metrics = $metric
        # Include full policy data for detailed modal view
        assignments = $policy.assignments
        targetResources = $policy.targetResources
        conditions = $policy.conditions
        accessControls = $policy.accessControls
    })

    # Add entity nodes once per collection; guard for missing or non-dictionary entities
    $entityCollections = @()
    if ($policyData.entities -and ($policyData.entities -is [System.Collections.IDictionary])) {
        $entityCollections = $policyData.entities.Keys
    }

    foreach ($collectionName in $entityCollections) {
        $collection = $policyData.entities[$collectionName]
        if (-not $collection) { continue }
        $entityKeys = @()
        if ($collection -is [System.Collections.IDictionary]) { $entityKeys = $collection.Keys }
        foreach ($entityKey in $entityKeys) {
            $entity = $collection[$entityKey]
            if (-not $entity) { continue }
            $label = if ($entity.displayName) { $entity.displayName } else { $entity.id }
            Add-Node -Id $entity.id -Label $label -Type $collectionName.TrimEnd('s') -Properties ($entity | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
        }
    }

    # Add relationships if present, and create nodes for target entities
    if ($policyData.relationships -and ($policyData.relationships -is [System.Collections.IEnumerable])) {
        Write-Host "Processing $($policyData.relationships.Count) relationships..." -ForegroundColor Cyan
    foreach ($relationship in $policyData.relationships) {
            if (-not $relationship) { continue }
            
            # Create a node for the target entity if it doesn't exist
            $targetId = $relationship.targetId
            $targetDisplayName = $relationship.targetDisplayName
            $targetType = $relationship.targetType
            
            # SPECIAL CASE: keyword → resolve to domain-specific node (Users/Applications/Locations)
            if ($targetType -eq 'keyword') {
                $policyObjForRel = ($policyData.policies | Where-Object { $_.id -eq $relationship.policyId } | Select-Object -First 1)
                $resolved = Resolve-KeywordContext -PolicyObj $policyObjForRel -Scope $relationship.scope -Keyword $targetDisplayName
                if ($resolved.type) {
                    $kwNodeId = ("kw:{0}:{1}:{2}:{3}" -f $relationship.policyId, $relationship.scope, $resolved.type, $targetDisplayName)
                    if (-not $nodeIndex.ContainsKey($kwNodeId)) {
                        Add-Node -Id $kwNodeId -Label $resolved.label -Type $resolved.type -Properties (@{ keyword = $targetDisplayName; scope = $relationship.scope; targetType = $resolved.type })
                    }
                    Add-Edge -FromId $relationship.policyId -ToId $kwNodeId -Relationship ("{0}:{1}" -f $relationship.scope, $resolved.type) -Properties (@{
                        policyName = $relationship.policyName
                        targetDisplayName = $resolved.label
                        via = $relationship.via
                        description = $relationship.description
                    })
                    continue
                }
            }

            if ($targetId -and -not $nodeIndex.ContainsKey($targetId)) {
                $targetLabel = if ($targetDisplayName) { $targetDisplayName } else { $targetId }
                # Try to find the full entity data from policy assignments
                $fullEntity = $null
                foreach ($pol in $policyData.policies) {
                    $assignments = Get-Prop $pol 'assignments'
                    if ($assignments) {
                        foreach ($scope in @('include', 'exclude')) {
                            $scopeData = Get-Prop $assignments $scope
                            if ($scopeData) {
                                foreach ($category in @('users', 'groups', 'roles', 'servicePrincipals')) {
                                    $categoryData = Get-Prop $scopeData $category
                                    $entities = Get-Prop $categoryData 'entities'
                                    if ($entities) {
                                        foreach ($ent in @($entities)) {
                                            if ((Get-Prop $ent 'id') -eq $targetId) {
                                                $fullEntity = $ent
                                                break
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    # Also check targetResources
                    $targetRes = Get-Prop $pol 'targetResources'
                    if ($targetRes) {
                        $apps = Get-Prop $targetRes 'applications'
                        if ($apps) {
                            foreach ($scope in @('include', 'exclude')) {
                                $scopeApps = Get-Prop $apps $scope
                                $appEntities = Get-Prop $scopeApps 'entities'
                                if ($appEntities) {
                                    foreach ($ent in @($appEntities)) {
                                        if ((Get-Prop $ent 'id') -eq $targetId) {
                                            $fullEntity = $ent
                                            break
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                
                # Create the node with available data
                $props = if ($fullEntity) { ($fullEntity | ConvertTo-Json -Depth 10 | ConvertFrom-Json) } else { @{ displayName = $targetDisplayName } }
                Add-Node -Id $targetId -Label $targetLabel -Type $targetType -Properties $props
            }
            
            # Add the edge
            Add-Edge -FromId $relationship.policyId -ToId $relationship.targetId -Relationship ("{0}:{1}" -f $relationship.scope, $relationship.targetType) -Properties (@{
            policyName = $relationship.policyName
            targetDisplayName = $relationship.targetDisplayName
            via = $relationship.via
            description = $relationship.description
        })
    }
}

    # Also synthesize edges for Guest / External users from conditions.users
    $condsUsers = Get-Prop (Get-Prop $policy 'conditions') 'users'
    if ($condsUsers) {
        foreach ($scope in @('include', 'exclude')) {
            $scoped = $null
            if ($scope -eq 'include') { $scoped = Get-Prop $condsUsers 'includeGuestsOrExternalUsers' }
            else { $scoped = Get-Prop $condsUsers 'excludeGuestsOrExternalUsers' }
            if (-not $scoped) { continue }

            $types = Get-Prop $scoped 'guestOrExternalUserTypes'
            $typesList = @()
            if ($types -is [string]) { $typesList = $types -split ',' }
            elseif ($types) { $typesList = @($types) }
            $typesList = @($typesList | Where-Object { $_ -and $_ -ne '' } | ForEach-Object { $_.Trim() })
            if (@($typesList).Count -gt 0) {
                $guestNodeId = ("guestTypes:{0}:{1}" -f $policyId, $scope)
                $guestLabel = if ((@($typesList)).Count -gt 1) { "Guest / External Users ($( (@($typesList)).Count ) types)" } else { "Guest / External Users" }
                Add-Node -Id $guestNodeId -Label $guestLabel -Type 'user' -Properties (@{ userTypes = $typesList })
                Add-Edge -FromId $policyId -ToId $guestNodeId -Relationship ("{0}:{1}" -f $scope, 'user') -Properties (@{ policyName = $policyName; description = 'Guest / External user types' })
            }

            $ext = Get-Prop $scoped 'externalTenants'
            $members = Get-Prop $ext 'members'
            if ($members) {
                foreach ($m in @($members)) {
                    $tid = Get-Prop $m 'id'
                    if (-not $tid) { continue }
                    $tname = Get-Prop $m 'displayName'
                    $tlabel = if ($tname) { $tname } else { $tid }
                    Add-Node -Id $tid -Label $tlabel -Type 'organization' -Properties ($m | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
                    Add-Edge -FromId $policyId -ToId $tid -Relationship ("{0}:{1}" -f $scope, 'organization') -Properties (@{ policyName = $policyName; description = 'External tenant' })
                }
            }
        }
    }
    
    # NEW: Add nodes and edges for authentication contexts
    $targetRes = Get-Prop $policy 'targetResources'
    if ($targetRes) {
        $apps = Get-Prop $targetRes 'applications'
        if ($apps) {
            $includeAuthContexts = Get-Prop $apps 'includeAuthenticationContextClassReferences'
            $excludeAuthContexts = Get-Prop $apps 'excludeAuthenticationContextClassReferences'
            
            foreach ($authCtx in @($includeAuthContexts)) {
                if ($authCtx) {
                    $authCtxNodeId = "authContext:${authCtx}"
                    $authCtxLabel = "Auth Context: $authCtx"
                    Add-Node -Id $authCtxNodeId -Label $authCtxLabel -Type 'authenticationContext' -Properties (@{ classReference = $authCtx })
                    Add-Edge -FromId $policyId -ToId $authCtxNodeId -Relationship "requires:authContext" -Properties (@{ policyName = $policyName; scope = 'include' })
                }
            }
            
            foreach ($authCtx in @($excludeAuthContexts)) {
                if ($authCtx) {
                    $authCtxNodeId = "authContext:${authCtx}"
                    $authCtxLabel = "Auth Context: $authCtx"
                    Add-Node -Id $authCtxNodeId -Label $authCtxLabel -Type 'authenticationContext' -Properties (@{ classReference = $authCtx })
                    Add-Edge -FromId $policyId -ToId $authCtxNodeId -Relationship "excludes:authContext" -Properties (@{ policyName = $policyName; scope = 'exclude' })
                }
            }
        }
    }
    
    # NEW: Add nodes and edges for insider risk conditions (only if there are actual levels)
    $policyConditions = Get-Prop $policy 'conditions'
    if ($policyConditions) {
        $insiderRisk = Get-Prop $policyConditions 'insiderRiskLevels'
        if ($insiderRisk -and (Get-Prop $insiderRisk 'configured')) {
            $levels = Get-Prop $insiderRisk 'levels'
            # Only create nodes if levels array has items
            if ($levels -and @($levels).Count -gt 0) {
                foreach ($level in @($levels)) {
                    if ($level) {
                        $riskNodeId = "insiderRisk:${level}:${policyId}"
                        $riskLabel = "Insider Risk: $level"
                        Add-Node -Id $riskNodeId -Label $riskLabel -Type 'condition' -Properties (@{ conditionType = 'insiderRisk'; level = $level })
                        Add-Edge -FromId $policyId -ToId $riskNodeId -Relationship "condition:insiderRisk" -Properties (@{ policyName = $policyName; level = $level })
                    }
                }
            }
        }
        
        # NEW: Add nodes and edges for authentication flows (only if there are actual methods)
        $authFlows = Get-Prop $policyConditions 'authenticationFlows'
        if ($authFlows -and (Get-Prop $authFlows 'configured')) {
            $transferMethods = Get-Prop $authFlows 'transferMethods'
            # Only create nodes if transferMethods array has items
            if ($transferMethods -and @($transferMethods).Count -gt 0) {
                foreach ($method in @($transferMethods)) {
                    if ($method) {
                        $flowNodeId = "authFlow:${method}:${policyId}"
                        $flowLabel = "Auth Flow: $method"
                        Add-Node -Id $flowNodeId -Label $flowLabel -Type 'condition' -Properties (@{ conditionType = 'authenticationFlow'; method = $method })
                        Add-Edge -FromId $policyId -ToId $flowNodeId -Relationship "condition:authFlow" -Properties (@{ policyName = $policyName; method = $method })
                    }
                }
            }
        }
        
        # NEW: Add node and edge for device filter (only if there's an actual rule)
        $deviceFilter = Get-Prop $policyConditions 'deviceFilter'
        if ($deviceFilter -and (Get-Prop $deviceFilter 'configured')) {
            $filterRule = Get-Prop $deviceFilter 'rule'
            # Only create node if there's an actual filter rule
            if ($filterRule) {
                $filterMode = Get-Prop $deviceFilter 'mode'
                $filterNodeId = "deviceFilter:${policyId}"
                $filterLabel = "Device Filter ($filterMode)"
                Add-Node -Id $filterNodeId -Label $filterLabel -Type 'condition' -Properties (@{ conditionType = 'deviceFilter'; mode = $filterMode; rule = $filterRule })
                Add-Edge -FromId $policyId -ToId $filterNodeId -Relationship "condition:deviceFilter" -Properties (@{ policyName = $policyName; mode = $filterMode })
            }
        }
    }
}

# Fallback: synthesize edges from per-policy summaries when relationships are absent
Write-Host "Checking edge fallback: graph.edges exists? $($null -ne $graph.edges), count = $(if ($graph.edges) { $graph.edges.Count } else { 0 })" -ForegroundColor Magenta
if (-not $graph.edges -or (@($graph.edges).Count -eq 0)) {
    Write-Host 'Synthesizing edges from policy assignment summaries (no relationships array found)...' -ForegroundColor Yellow

function Ensure-EntityNode {
        param([string]$Id, [string]$Label, [string]$Type, [object]$Props)
        if (-not $Id) { return }
        if (-not $nodeIndex.ContainsKey($Id)) {
            Add-Node -Id $Id -Label $Label -Type $Type -Properties $Props
        }
    }

    function Add-Edges-From-Assignment {
        param(
            [string]$PolicyId,
            [string]$PolicyName,
            [string]$Scope, # include | exclude
            [string]$TargetType, # user|group|role|servicePrincipal|namedLocation|keyword
            $Assignment
        )

        if (-not $Assignment) { return }

        function Get-Entity-Collection {
            param([string]$pluralType)
            if (-not $policyData.entities) { return @() }
            $collection = Get-Prop $policyData.entities $pluralType
            if (-not $collection) { return @() }
            $vals = @()
            if ($collection -is [System.Collections.IDictionary]) { $vals = @($collection.Values) }
            return @($vals)
        }

        function Expand-All-Keyword {
            param([string]$kw)
            $expanded = @()
            if ($TargetType -eq 'user') {
                if ($kw -match '^All' -or $kw -eq 'AllUsers') {
                    $expanded = Get-Entity-Collection -pluralType 'users'
                }
            }
            elseif ($TargetType -eq 'servicePrincipal') {
                if ($kw -match '^All') {
                    $expanded = Get-Entity-Collection -pluralType 'servicePrincipals'
                }
            }
            elseif ($TargetType -eq 'namedLocation') {
                $allNamed = Get-Entity-Collection -pluralType 'namedLocations'
                if ($kw -match '^AllTrusted') {
                    $expanded = @($allNamed | Where-Object { ($_ | Select-Object -ExpandProperty isTrusted -ErrorAction SilentlyContinue) -eq $true })
                }
                elseif ($kw -match '^All') {
                    $expanded = $allNamed
                }
            }
            return @($expanded)
        }

        # keywords -> edges to keyword nodes
        $keywords = $Assignment.keywords
        if ($keywords) {
            foreach ($kw in @($keywords)) {
                if (-not $kw) { continue }
                # Create a unique keyword node ID scoped by policy + scope + targetType to avoid duplication
                $kwId = ("kw:{0}:{1}:{2}:{3}" -f $PolicyId, $Scope, $TargetType, $kw)
                
                # Make keyword labels more descriptive based on context
                $kwLabel = $kw
                if ($kw -match '^All' -or $kw -eq 'AllUsers') {
                    if ($TargetType -eq 'user') { $kwLabel = 'All Users' }
                    elseif ($TargetType -eq 'servicePrincipal') { $kwLabel = 'All Applications' }
                    elseif ($TargetType -eq 'group') { $kwLabel = 'All Groups' }
                    elseif ($TargetType -eq 'role') { $kwLabel = 'All Roles' }
                    elseif ($TargetType -eq 'namedLocation') { $kwLabel = 'All Locations' }
                }
                elseif ($kw -match 'AllTrusted') {
                    $kwLabel = 'All Trusted Locations'
                }
                elseif ($kw -eq 'None') {
                    if ($TargetType -eq 'user') { $kwLabel = 'No Users' }
                    elseif ($TargetType -eq 'servicePrincipal') { $kwLabel = 'No Applications' }
                    else { $kwLabel = 'None' }
                }
                
                Ensure-EntityNode -Id $kwId -Label $kwLabel -Type 'keyword' -Props @{ keyword = $kw; scope = $Scope; targetType = $TargetType; originalKeyword = $kw }
                Add-Edge -FromId $PolicyId -ToId $kwId -Relationship ("{0}:{1}" -f $Scope, 'keyword') -Properties (@{ policyName = $PolicyName; targetType = $TargetType })

                # Expand certain keywords into concrete edges for analysis/visualization
                $expandedTargets = Expand-All-Keyword -kw $kw
                if ($expandedTargets -and @($expandedTargets).Count -gt 0) {
                    foreach ($t in $expandedTargets) {
                        $tid = $t.id
                        if (-not $tid) { continue }
                        $tlabel = if ($t.displayName) { $t.displayName } elseif ($t.userPrincipalName) { $t.userPrincipalName } else { $tid }
                        Ensure-EntityNode -Id $tid -Label $tlabel -Type $TargetType -Props ($t | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
                        Add-Edge -FromId $PolicyId -ToId $tid -Relationship ("{0}:{1}" -f $Scope, $TargetType) -Properties (@{ policyName = $PolicyName; targetDisplayName = $tlabel; expandedFrom = $kw })
                    }
                }
            }
        }

        # entities
        $entities = $Assignment.entities
        if ($entities) {
            foreach ($e in @($entities)) {
                $eid = $e.id
                $elabel = if ($e.displayName) { $e.displayName } elseif ($e.userPrincipalName) { $e.userPrincipalName } else { $eid }
                $props = ($e | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
                $type = $TargetType
                Ensure-EntityNode -Id $eid -Label $elabel -Type $type -Props $props
                $viaVal = Get-Prop $e 'via'
                $edgeProps = @{ policyName = $PolicyName; targetDisplayName = $elabel }
                if ($viaVal) { $edgeProps['via'] = $viaVal }
                Add-Edge -FromId $PolicyId -ToId $eid -Relationship ("{0}:{1}" -f $Scope, $type) -Properties $edgeProps
            }
        }
    }

    foreach ($p in $policyData.policies) {
        $policyId2 = $p.id; $policyName2 = $p.displayName

        $assign = Get-Prop $p 'assignments'
        if ($assign) {
            $inc = Get-Prop $assign 'include'; $exc = Get-Prop $assign 'exclude'
            if ($inc) {
                Add-Edges-From-Assignment -PolicyId $policyId2 -PolicyName $policyName2 -Scope 'include' -TargetType 'user' -Assignment (Get-Prop $inc 'users')
                Add-Edges-From-Assignment -PolicyId $policyId2 -PolicyName $policyName2 -Scope 'include' -TargetType 'group' -Assignment (Get-Prop $inc 'groups')
                Add-Edges-From-Assignment -PolicyId $policyId2 -PolicyName $policyName2 -Scope 'include' -TargetType 'role' -Assignment (Get-Prop $inc 'roles')
                Add-Edges-From-Assignment -PolicyId $policyId2 -PolicyName $policyName2 -Scope 'include' -TargetType 'servicePrincipal' -Assignment (Get-Prop $inc 'servicePrincipals')
            }
            if ($exc) {
                Add-Edges-From-Assignment -PolicyId $policyId2 -PolicyName $policyName2 -Scope 'exclude' -TargetType 'user' -Assignment (Get-Prop $exc 'users')
                Add-Edges-From-Assignment -PolicyId $policyId2 -PolicyName $policyName2 -Scope 'exclude' -TargetType 'group' -Assignment (Get-Prop $exc 'groups')
                Add-Edges-From-Assignment -PolicyId $policyId2 -PolicyName $policyName2 -Scope 'exclude' -TargetType 'role' -Assignment (Get-Prop $exc 'roles')
                Add-Edges-From-Assignment -PolicyId $policyId2 -PolicyName $policyName2 -Scope 'exclude' -TargetType 'servicePrincipal' -Assignment (Get-Prop $exc 'servicePrincipals')
            }
        }

        $apps = Get-Prop (Get-Prop $p 'targetResources') 'applications'
        if ($apps) {
            Add-Edges-From-Assignment -PolicyId $policyId2 -PolicyName $policyName2 -Scope 'include' -TargetType 'servicePrincipal' -Assignment (Get-Prop $apps 'include')
            Add-Edges-From-Assignment -PolicyId $policyId2 -PolicyName $policyName2 -Scope 'exclude' -TargetType 'servicePrincipal' -Assignment (Get-Prop $apps 'exclude')
        }

        $locs = Get-Prop (Get-Prop $p 'conditions') 'locations'
        if ($locs) {
            Add-Edges-From-Assignment -PolicyId $policyId2 -PolicyName $policyName2 -Scope 'include' -TargetType 'namedLocation' -Assignment (Get-Prop $locs 'include')
            Add-Edges-From-Assignment -PolicyId $policyId2 -PolicyName $policyName2 -Scope 'exclude' -TargetType 'namedLocation' -Assignment (Get-Prop $locs 'exclude')
        }

        # Guest / External users from conditions.users
        $condsUsers2 = Get-Prop (Get-Prop $p 'conditions') 'users'
        if ($condsUsers2) {
            foreach ($scope in @('include', 'exclude')) {
                $scoped = $null
                if ($scope -eq 'include') { $scoped = Get-Prop $condsUsers2 'includeGuestsOrExternalUsers' }
                else { $scoped = Get-Prop $condsUsers2 'excludeGuestsOrExternalUsers' }
                if (-not $scoped) { continue }

                $types = Get-Prop $scoped 'guestOrExternalUserTypes'
                $typesList = @()
                if ($types -is [string]) { $typesList = $types -split ',' }
                elseif ($types) { $typesList = @($types) }
                $typesList = @($typesList | Where-Object { $_ -and $_ -ne '' } | ForEach-Object { $_.Trim() })
                if (@($typesList).Count -gt 0) {
                    $guestNodeId = ("guestTypes:{0}:{1}" -f $policyId2, $scope)
                    $guestLabel = if ((@($typesList)).Count -gt 1) { "Guest / External Users ($( (@($typesList)).Count ) types)" } else { "Guest / External Users" }
                    Ensure-EntityNode -Id $guestNodeId -Label $guestLabel -Type 'user' -Props @{ userTypes = $typesList }
                    Add-Edge -FromId $policyId2 -ToId $guestNodeId -Relationship ("{0}:{1}" -f $scope, 'user') -Properties (@{ policyName = $policyName2; description = 'Guest / External user types' })
                }

                $ext = Get-Prop $scoped 'externalTenants'
                $members = Get-Prop $ext 'members'
                if ($members) {
                    foreach ($m in @($members)) {
                        $tid = Get-Prop $m 'id'
                        if (-not $tid) { continue }
                        $tname = Get-Prop $m 'displayName'
                        $tlabel = if ($tname) { $tname } else { $tid }
                        Ensure-EntityNode -Id $tid -Label $tlabel -Type 'organization' -Props ($m | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
                        Add-Edge -FromId $policyId2 -ToId $tid -Relationship ("{0}:{1}" -f $scope, 'organization') -Properties (@{ policyName = $policyName2; description = 'External tenant' })
                    }
                }
            }
        }
    }
}

# Populate the final nodes array from the nodeIndex
$graph.nodes = @($nodeIndex.Values)

Write-Host "Total nodes in index: $($nodeIndex.Keys.Count)" -ForegroundColor Cyan
Write-Host "Total nodes in graph.nodes: $($graph.nodes.Count)" -ForegroundColor Cyan
Write-Host "Total edges: $($graph.edges.Count)" -ForegroundColor Cyan

$graph | ConvertTo-Json -Depth 20 | Out-File -FilePath $OutputJsonPath -Encoding utf8
Write-Host "Graph JSON written to $OutputJsonPath" -ForegroundColor Green
