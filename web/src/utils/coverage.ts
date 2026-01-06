import type { GraphData, GraphNode, ObjectsIndex } from '../types/graph'

export type CoverageByType = {
  covered: Set<string>
  excluded: Set<string>
  uncovered: Set<string>
  total: number
  actualTotal: number // The real total from counts.json
  coveredCount?: number // Optional count when using "All"
  uncoveredCount?: number // Optional count when using "All"
}

export type GrantControlCoverage = {
  grantControl: string
  policyCount: number
  policyIds: string[]
  users: CoverageByType
  applications: CoverageByType
  networks: NetworkCoverage
}

export type NetworkCoverage = {
  includedLocations: Set<string>
  excludedLocations: Set<string>
  isGlobal: boolean
  note: string
}

export type CoverageResult = {
  byGrantControl: Map<string, GrantControlCoverage>
  overall: {
    users: CoverageByType
    applications: CoverageByType
    networks: NetworkCoverage
  }
}

// Helper to get all user IDs from index
function getAllUserIds(index: ObjectsIndex): Set<string> {
  return new Set(index.users.keys())
}

// Helper to get all application/SP IDs from index
function getAllAppIds(index: ObjectsIndex): Set<string> {
  return new Set(index.servicePrincipals.keys())
}


// Expand group members to user IDs
// First try to get members from the group entity itself (from policy data)
// Then fall back to graph edges
function expandGroupMembers(groupId: string, graphData: GraphData, groupEntity?: any): Set<string> {
  const members = new Set<string>()
  
  // If group entity is provided with members array, use it
  if (groupEntity?.members && Array.isArray(groupEntity.members)) {
    for (const member of groupEntity.members) {
      if (member.id && member.type === 'user') {
        members.add(member.id)
      }
    }
    return members
  }
  
  // Fall back to graph edges
  for (const edge of graphData.edges) {
    if (edge.from === groupId && edge.to && edge.relationship.toLowerCase().includes('user')) {
      const targetNode = graphData.nodes.find((n) => n.id === edge.to)
      if (targetNode && targetNode.type === 'user') {
        members.add(edge.to)
      }
    }
  }
  return members
}

// Expand role members to user IDs
// First try to get members from the role entity itself (from policy data)
// Then fall back to graph edges
function expandRoleMembers(roleId: string, graphData: GraphData, roleEntity?: any): Set<string> {
  const members = new Set<string>()
  
  // If role entity is provided with members array, use it
  if (roleEntity?.members && Array.isArray(roleEntity.members)) {
    for (const member of roleEntity.members) {
      if (member.id && member.type === 'user') {
        members.add(member.id)
      }
    }
    return members
  }
  
  // Fall back to graph edges
  for (const edge of graphData.edges) {
    if (edge.from === roleId && edge.to && edge.relationship.toLowerCase().includes('user')) {
      const targetNode = graphData.nodes.find((n) => n.id === edge.to)
      if (targetNode && targetNode.type === 'user') {
        members.add(edge.to)
      }
    }
  }
  return members
}

// Calculate user coverage for a set of policies
function calculateUserCoverage(
  policies: GraphNode[],
  graphData: GraphData,
  index: ObjectsIndex
): CoverageByType {
  const allUsers = getAllUserIds(index)
  const actualTotal = index.totals.user
  const covered = new Set<string>()
  const excluded = new Set<string>()

  for (const policy of policies) {
    const assignments = policy.properties?.assignments as any
    
    if (!assignments) continue

    // Check for "All" keyword in include
    const includeUsers = assignments.include?.users
    const includeKeywords = includeUsers?.keywords || []
    const hasAllUsers = includeKeywords.some((kw: string) => 
      kw === 'All' || kw === 'AllUsers' || kw === 'all' || kw === 'allusers'
    )

    if (hasAllUsers) {
      // If "All" is present, we conceptually cover everyone EXCEPT exclusions
      // We'll calculate coverage as: actualTotal - excluded
      // So we don't need to add all users here, we'll calculate at the end
    } else {
      // Add explicitly included users
      const includeUserEntities = includeUsers?.entities || []
      for (const entity of includeUserEntities) {
        if (entity.id) covered.add(entity.id)
      }

      // Add users from included groups
      const includeGroups = assignments.include?.groups?.entities || []
      for (const group of includeGroups) {
        const members = expandGroupMembers(group.id, graphData, group)
        for (const userId of members) covered.add(userId)
      }

      // Add users from included roles
      const includeRoles = assignments.include?.roles?.entities || []
      for (const role of includeRoles) {
        const members = expandRoleMembers(role.id, graphData, role)
        for (const userId of members) covered.add(userId)
      }
    }

    // Track excluded users
    const excludeUsers = assignments.exclude?.users?.entities || []
    for (const entity of excludeUsers) {
      if (entity.id) {
        excluded.add(entity.id)
      }
    }

    // Track users from excluded groups
    const excludeGroups = assignments.exclude?.groups?.entities || []
    for (const group of excludeGroups) {
      const members = expandGroupMembers(group.id, graphData, group)
      for (const userId of members) {
        excluded.add(userId)
      }
    }

    // Track users from excluded roles
    const excludeRoles = assignments.exclude?.roles?.entities || []
    for (const role of excludeRoles) {
      const members = expandRoleMembers(role.id, graphData, role)
      for (const userId of members) {
        excluded.add(userId)
      }
    }

    // If "All" was specified, covered = all users minus exclusions
    if (hasAllUsers) {
      // We can't enumerate all users, but we can say covered count = actualTotal - excluded.size
      // For the Set, we'll keep it empty and calculate coverage count differently
      // Mark this by setting a special flag or handle in the return
    }
  }

  // Check if any policy had "All"
  let hasAllInAnyPolicy = false
  for (const policy of policies) {
    const assignments = policy.properties?.assignments as any
    if (!assignments) continue
    const includeKeywords = assignments.include?.users?.keywords || []
    if (includeKeywords.some((kw: string) => kw === 'All' || kw === 'AllUsers' || kw === 'all' || kw === 'allusers')) {
      hasAllInAnyPolicy = true
      break
    }
  }

  let coveredCount: number
  let uncoveredCount: number

  if (hasAllInAnyPolicy) {
    // "All" means actualTotal minus exclusions
    coveredCount = actualTotal - excluded.size
    uncoveredCount = excluded.size
  } else {
    // No "All", use explicit coverage
    // Remove excluded from covered
    for (const userId of excluded) {
      covered.delete(userId)
    }
    coveredCount = covered.size
    uncoveredCount = actualTotal - covered.size
  }

  const uncovered = new Set<string>()
  // For display purposes, uncovered are the excluded ones when "All" is used
  if (hasAllInAnyPolicy) {
    for (const userId of excluded) {
      uncovered.add(userId)
    }
  } else {
    for (const userId of allUsers) {
      if (!covered.has(userId) && !excluded.has(userId)) {
        uncovered.add(userId)
      }
    }
  }

  return {
    covered: hasAllInAnyPolicy ? new Set() : covered, // Empty set when "All" is used, count is in actualTotal
    excluded,
    uncovered,
    total: allUsers.size,
    actualTotal: actualTotal,
    // Add a special property to indicate "All" coverage
    coveredCount: coveredCount, // Actual number covered
    uncoveredCount: uncoveredCount // Actual number uncovered
  } as any
}

// Helper to check if an array of keywords contains "All" for applications
function hasAllAppsKeyword(keywords: unknown): boolean {
  if (!Array.isArray(keywords)) return false
  const allKeywords = ['all', 'allapps', 'allapplications', 'allcloudapps', 'none']
  return keywords.some((kw: unknown) => {
    if (typeof kw !== 'string') return false
    return allKeywords.includes(kw.toLowerCase())
  })
}

// Calculate application coverage for a set of policies
function calculateAppCoverage(
  policies: GraphNode[],
  _graphData: GraphData,
  index: ObjectsIndex
): CoverageByType {
  const allApps = getAllAppIds(index)
  // Use servicePrincipal count (enterprise apps) as the primary total for CA policies
  // CA policies target "All cloud apps" which means service principals, not app registrations
  // Check both camelCase and lowercase keys since counts.json uses lowercase
  const totals = index.totals as Record<string, number>
  const actualTotal = totals.servicePrincipal || totals.serviceprincipal || totals.application || allApps.size || 1
  const covered = new Set<string>()
  const excluded = new Set<string>()

  for (const policy of policies) {
    const targetResources = policy.properties?.targetResources as any
    
    if (!targetResources) continue

    // Handle multiple possible structures for application data
    const applications = targetResources.applications || targetResources
    
    // Check for "All" keyword in include - look in multiple possible locations
    let includeKeywords: unknown[] = []
    
    // Try different keyword locations based on different data structures
    if (applications.include?.keywords) {
      includeKeywords = applications.include.keywords
    } else if (applications.includeApplications) {
      // Some policies use includeApplications with keywords directly
      includeKeywords = Array.isArray(applications.includeApplications) ? applications.includeApplications : []
    } else if (targetResources.includeApplications) {
      includeKeywords = Array.isArray(targetResources.includeApplications) ? targetResources.includeApplications : []
    }
    
    const hasAllApps = hasAllAppsKeyword(includeKeywords)

    if (hasAllApps) {
      // If "All" is present, we conceptually cover all apps EXCEPT exclusions
    } else {
      // Add explicitly included apps - try both structures
      const includeEntities = applications.include?.entities || 
                             applications.include?.servicePrincipals?.entities ||
                             applications.entities || []
      for (const entity of includeEntities) {
        if (entity.id) covered.add(entity.id)
      }
    }

    // Track excluded apps - try multiple locations
    // Note: excludeKeywords collected here for potential future use
    if (applications.exclude?.keywords) {
      // Future: handle exclude keywords
    } else if (applications.excludeApplications) {
      // Future: handle excludeApplications array
    } else if (targetResources.excludeApplications) {
      // Future: handle targetResources.excludeApplications
    }
    
    const excludeEntities = applications.exclude?.entities ||
                           applications.exclude?.servicePrincipals?.entities ||
                           []
    for (const entity of excludeEntities) {
      if (entity.id) {
        excluded.add(entity.id)
      }
    }
  }

  // Check if any policy had "All"
  let hasAllInAnyPolicy = false
  for (const policy of policies) {
    const targetResources = policy.properties?.targetResources as any
    if (!targetResources) continue
    const applications = targetResources.applications || targetResources
    
    // Check multiple keyword locations
    const includeKeywords = applications.include?.keywords || 
                           applications.includeApplications ||
                           targetResources.includeApplications || []
    
    if (hasAllAppsKeyword(includeKeywords)) {
      hasAllInAnyPolicy = true
      break
    }
  }

  let coveredCount: number
  let uncoveredCount: number

  if (hasAllInAnyPolicy) {
    // "All" means actualTotal minus exclusions
    coveredCount = actualTotal - excluded.size
    uncoveredCount = excluded.size
  } else {
    // No "All", use explicit coverage
    // Remove excluded from covered
    for (const appId of excluded) {
      covered.delete(appId)
    }
    coveredCount = covered.size
    uncoveredCount = actualTotal - covered.size
  }

  const uncovered = new Set<string>()
  // For display purposes, uncovered are the excluded ones when "All" is used
  if (hasAllInAnyPolicy) {
    for (const appId of excluded) {
      uncovered.add(appId)
    }
  } else {
    for (const appId of allApps) {
      if (!covered.has(appId) && !excluded.has(appId)) {
        uncovered.add(appId)
      }
    }
  }

  return {
    covered: hasAllInAnyPolicy ? new Set() : covered,
    excluded,
    uncovered,
    total: allApps.size,
    actualTotal: actualTotal,
    coveredCount: coveredCount,
    uncoveredCount: uncoveredCount
  } as any
}

// Calculate network/location coverage for a set of policies
function calculateNetworkCoverage(
  policies: GraphNode[],
  _graphData: GraphData,
  _index: ObjectsIndex
): NetworkCoverage {
  const includedLocations = new Set<string>()
  const excludedLocations = new Set<string>()
  let isGlobal = false
  const notes: string[] = []

  for (const policy of policies) {
    const conditions = policy.properties?.conditions as any
    
    if (!conditions?.locations) continue

    const includeLocations = conditions.locations.include?.keywords || []
    const hasAll = includeLocations.some((kw: string) => kw === 'All' || kw === 'all')
    const hasAllTrusted = includeLocations.some((kw: string) => kw === 'AllTrusted' || kw === 'alltrusted')

    if (hasAll) {
      isGlobal = true
    }

    // Track included named locations
    const includeLocationEntities = conditions.locations.include?.namedLocations?.entities || []
    for (const loc of includeLocationEntities) {
      if (loc.id) includedLocations.add(loc.id)
    }

    // Track excluded named locations
    const excludeLocationEntities = conditions.locations.exclude?.namedLocations?.entities || []
    for (const loc of excludeLocationEntities) {
      if (loc.id) excludedLocations.add(loc.id)
    }

    if (hasAllTrusted) {
      notes.push('Includes all trusted locations')
    }
  }

  let note = 'Network coverage is context-dependent on user location'
  if (isGlobal && excludedLocations.size > 0) {
    note = `Applied globally except from ${excludedLocations.size} excluded location(s)`
  } else if (isGlobal) {
    note = 'Applied globally from all locations'
  } else if (includedLocations.size > 0) {
    note = `Applied from ${includedLocations.size} specific location(s)`
  }

  return {
    includedLocations,
    excludedLocations,
    isGlobal,
    note: notes.length > 0 ? notes.join('; ') + '. ' + note : note
  }
}

// Group policies by grant control
export function groupPoliciesByGrantControl(
  graphData: GraphData,
  policyIds: Set<string>
): Map<string, GraphNode[]> {
  const grouped = new Map<string, GraphNode[]>()

  for (const node of graphData.nodes) {
    if (node.type !== 'policy' || !policyIds.has(node.id)) continue

    const grantControls = Array.isArray(node.properties?.grantControls)
      ? (node.properties?.grantControls as string[])
      : []

    if (grantControls.length === 0) {
      // No grant control specified
      if (!grouped.has('(none)')) grouped.set('(none)', [])
      grouped.get('(none)')!.push(node)
    } else {
      // Add to each grant control group
      for (const gc of grantControls) {
        const key = String(gc).toLowerCase()
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key)!.push(node)
      }
    }
  }

  return grouped
}

// Calculate coverage grouped by grant control
export function calculateCoverageByGrantControl(
  graphData: GraphData,
  policyIds: Set<string>,
  index: ObjectsIndex
): CoverageResult {
  const grouped = groupPoliciesByGrantControl(graphData, policyIds)
  const byGrantControl = new Map<string, GrantControlCoverage>()

  // Calculate coverage for each grant control group
  for (const [grantControl, policies] of grouped.entries()) {
    const userCoverage = calculateUserCoverage(policies, graphData, index)
    const appCoverage = calculateAppCoverage(policies, graphData, index)
    const networkCoverage = calculateNetworkCoverage(policies, graphData, index)

    byGrantControl.set(grantControl, {
      grantControl,
      policyCount: policies.length,
      policyIds: policies.map((p) => p.id),
      users: userCoverage,
      applications: appCoverage,
      networks: networkCoverage
    })
  }

  // Calculate overall coverage (union of all policies)
  const allPolicies = graphData.nodes.filter((n) => n.type === 'policy' && policyIds.has(n.id))
  const overallUsers = calculateUserCoverage(allPolicies, graphData, index)
  const overallApps = calculateAppCoverage(allPolicies, graphData, index)
  const overallNetworks = calculateNetworkCoverage(allPolicies, graphData, index)

  return {
    byGrantControl,
    overall: {
      users: overallUsers,
      applications: overallApps,
      networks: overallNetworks
    }
  }
}

// Calculate coverage grouped by condition (for "By Condition" view)
export function calculateCoverageByCondition(
  graphData: GraphData,
  policyIds: Set<string>,
  index: ObjectsIndex
): Map<string, GrantControlCoverage> {
  const result = new Map<string, GrantControlCoverage>()
  
  // Import condition grouping from policyGrouping
  const allPolicies = graphData.nodes.filter((n) => n.type === 'policy' && policyIds.has(n.id))
  
  // Group by condition type
  const conditionGroups = new Map<string, GraphNode[]>()
  
  for (const policy of allPolicies) {
    const conditions = policy.properties?.conditions as any
    if (!conditions) continue

    // Check which conditions this policy has
    const policyConditions: string[] = []
    
    if (conditions.userRiskLevels?.length > 0) policyConditions.push('User Risk')
    if (conditions.signInRiskLevels?.length > 0) policyConditions.push('Sign-In Risk')
    if (conditions.servicePrincipalRiskLevels?.length > 0) policyConditions.push('Service Principal Risk')
    if (conditions.platforms && (conditions.platforms.includePlatforms?.length > 0 || conditions.platforms.excludePlatforms?.length > 0)) {
      policyConditions.push('Device Platform')
    }
    if (conditions.clientAppTypes && conditions.clientAppTypes.length > 0 && !conditions.clientAppTypes.includes('all')) {
      policyConditions.push('Client App Type')
    }
    if (conditions.locations && (conditions.locations.include || conditions.locations.exclude)) {
      policyConditions.push('Location')
    }
    
    // If no specific conditions, mark as "All Conditions"
    if (policyConditions.length === 0) {
      policyConditions.push('All Conditions')
    }
    
    // Add policy to each condition group
    for (const cond of policyConditions) {
      if (!conditionGroups.has(cond)) conditionGroups.set(cond, [])
      conditionGroups.get(cond)!.push(policy)
    }
  }
  
  // Calculate coverage for each condition group
  for (const [condition, policies] of conditionGroups.entries()) {
    const userCoverage = calculateUserCoverage(policies, graphData, index)
    const appCoverage = calculateAppCoverage(policies, graphData, index)
    const networkCoverage = calculateNetworkCoverage(policies, graphData, index)

    result.set(condition, {
      grantControl: condition, // Reusing the same type, but it's actually a condition
      policyCount: policies.length,
      policyIds: policies.map((p) => p.id),
      users: userCoverage,
      applications: appCoverage,
      networks: networkCoverage
    })
  }
  
  return result
}
