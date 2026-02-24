/**
 * Decision Tree Builder for Conditional Access Policy Analysis
 * 
 * Builds a unified decision tree from multiple CA policies, showing:
 * - Condition evaluation paths
 * - Policy matching at each node
 * - Grant/session controls applied
 * - Gap detection for uncovered paths
 */

// Policy data extracted from raw policy JSON
export interface PolicyData {
  id: string
  displayName: string
  state: string
  assignments: {
    include: {
      users: { keywords: string[]; entities: { id: string; displayName: string }[] }
      groups: { keywords: string[]; entities: { id: string; displayName: string }[] }
      roles: { keywords: string[]; entities: { id: string; displayName: string }[] }
    }
    exclude: {
      users: { keywords: string[]; entities: { id: string; displayName: string }[] }
      groups: { keywords: string[]; entities: { id: string; displayName: string }[] }
      roles: { keywords: string[]; entities: { id: string; displayName: string }[] }
    }
  }
  applications?: {
    include?: { keywords?: string[]; entities?: { id: string; displayName: string }[] }
    exclude?: { keywords?: string[]; entities?: { id: string; displayName: string }[] }
  }
  conditions?: {
    locations?: {
      include?: { keywords?: string[]; entities?: { displayName: string }[] }
      exclude?: { keywords?: string[]; entities?: { displayName: string }[] }
    }
    platforms?: { include?: string[]; exclude?: string[] }
    clientAppTypes?: string[]
    userRiskLevels?: string[]
    signInRiskLevels?: string[]
    deviceFilter?: { mode?: string; rule?: string }
  }
  grantControls?: string[]
  accessControls?: {
    grant?: {
      operator?: string
      builtInControls?: string[]
      authenticationStrength?: { displayName?: string }
    }
    session?: Record<string, unknown>
  }
}

// Decision tree node types
export type NodeType = 'start' | 'condition' | 'policy' | 'control' | 'gap'

export interface DecisionNode {
  id: string
  type: NodeType
  label: string
  sublabel?: string
  conditionField?: string
  policies: string[]  // Policy IDs that reach this node
  policyNames: string[]  // Policy display names
  policyStates: Record<string, string>  // Policy ID -> state
  children: DecisionEdge[]
  isGap?: boolean
  grantControls?: string[]
  grantOperator?: string
}

export interface DecisionEdge {
  id: string
  source: string
  target: string
  label: string
  policies: string[]
  policyNames: string[]
  isGap: boolean
  isExclusion?: boolean
}

export interface DecisionTree {
  nodes: Map<string, DecisionNode>
  edges: DecisionEdge[]
  rootId: string
  stats: TreeStats
}

export interface TreeStats {
  totalPolicies: number
  totalNodes: number
  totalEdges: number
  gapCount: number
  overlapCount: number
  maxDepth: number
}

// Color assignment for policies
export interface PolicyColor {
  id: string
  name: string
  color: string
  state: string
}

const POLICY_COLORS = [
  '#4299e1', // blue
  '#B9A382', // khaki
  '#ed8936', // orange
  '#9f7aea', // purple
  '#f56565', // red
  '#7AB8D9', // sky blue
  '#ed64a6', // pink
  '#ecc94b', // yellow
  '#667eea', // indigo
  '#fc8181', // light red
]

/**
 * Assigns colors to policies for visualization
 */
export function assignPolicyColors(policies: PolicyData[]): PolicyColor[] {
  return policies.map((p, i) => ({
    id: p.id,
    name: p.displayName,
    color: POLICY_COLORS[i % POLICY_COLORS.length],
    state: p.state
  }))
}

/**
 * Main function to build the decision tree from policies
 */
export function buildDecisionTree(
  policies: PolicyData[],
  selectedPolicyIds?: Set<string>
): DecisionTree {
  const filteredPolicies = selectedPolicyIds
    ? policies.filter(p => selectedPolicyIds.has(p.id))
    : policies

  const nodes = new Map<string, DecisionNode>()
  const edges: DecisionEdge[] = []
  let nodeIdCounter = 0
  let edgeIdCounter = 0

  const generateNodeId = (prefix: string) => `${prefix}_${++nodeIdCounter}`
  const generateEdgeId = () => `edge_${++edgeIdCounter}`

  // Root node - Sign-in Request
  const rootId = 'start'
  nodes.set(rootId, {
    id: rootId,
    type: 'start',
    label: 'Sign-In Request',
    policies: filteredPolicies.map(p => p.id),
    policyNames: filteredPolicies.map(p => p.displayName),
    policyStates: Object.fromEntries(filteredPolicies.map(p => [p.id, p.state])),
    children: []
  })

  // Build tree by evaluating conditions in order
  // Order: User Scope -> App Scope -> Location -> Device -> Client App -> Risk -> Controls
  
  const conditionLayers = [
    { key: 'userScope', label: 'User Scope', evaluate: evaluateUserScope },
    { key: 'appScope', label: 'Application', evaluate: evaluateAppScope },
    { key: 'location', label: 'Location', evaluate: evaluateLocation },
    { key: 'device', label: 'Device', evaluate: evaluateDevice },
    { key: 'clientApp', label: 'Client App', evaluate: evaluateClientApp },
    { key: 'risk', label: 'Risk Level', evaluate: evaluateRisk },
  ]

  // Process each layer and build nodes
  let currentLayerNodeIds = [rootId]
  let maxDepth = 0

  conditionLayers.forEach((layer, layerIndex) => {
    const nextLayerNodeIds: string[] = []
    maxDepth = Math.max(maxDepth, layerIndex + 1)

    currentLayerNodeIds.forEach(parentNodeId => {
      const parentNode = nodes.get(parentNodeId)
      if (!parentNode || parentNode.policies.length === 0) return

      // Get policies at this node
      const policiesAtNode = filteredPolicies.filter(p => parentNode.policies.includes(p.id))
      
      // Evaluate the condition layer for each policy
      const branches = layer.evaluate(policiesAtNode)

      // Create nodes for each branch
      branches.forEach(branch => {
        if (branch.policies.length === 0) {
          // This is a gap - no policies cover this condition
          const gapNodeId = generateNodeId('gap')
          nodes.set(gapNodeId, {
            id: gapNodeId,
            type: 'gap',
            label: branch.label,
            sublabel: 'No policies',
            conditionField: layer.key,
            policies: [],
            policyNames: [],
            policyStates: {},
            children: [],
            isGap: true
          })

          const edge: DecisionEdge = {
            id: generateEdgeId(),
            source: parentNodeId,
            target: gapNodeId,
            label: branch.edgeLabel,
            policies: [],
            policyNames: [],
            isGap: true
          }
          edges.push(edge)
          parentNode.children.push(edge)
        } else {
          const nodeId = generateNodeId(layer.key)
          const branchPolicies = branch.policies
          const branchPolicyNames = branchPolicies.map(p => p.displayName)

          nodes.set(nodeId, {
            id: nodeId,
            type: 'condition',
            label: branch.label,
            sublabel: branch.sublabel,
            conditionField: layer.key,
            policies: branchPolicies.map(p => p.id),
            policyNames: branchPolicyNames,
            policyStates: Object.fromEntries(branchPolicies.map(p => [p.id, p.state])),
            children: [],
            isGap: false
          })

          const edge: DecisionEdge = {
            id: generateEdgeId(),
            source: parentNodeId,
            target: nodeId,
            label: branch.edgeLabel,
            policies: branchPolicies.map(p => p.id),
            policyNames: branchPolicyNames,
            isGap: false,
            isExclusion: branch.isExclusion
          }
          edges.push(edge)
          parentNode.children.push(edge)
          nextLayerNodeIds.push(nodeId)
        }
      })
    })

    currentLayerNodeIds = nextLayerNodeIds
  })

  // Add terminal control nodes for each leaf
  currentLayerNodeIds.forEach(nodeId => {
    const node = nodes.get(nodeId)
    if (!node || node.policies.length === 0) return

    const policiesAtNode = filteredPolicies.filter(p => node.policies.includes(p.id))
    
    // Group by control outcome
    const controlGroups = groupByControls(policiesAtNode)
    
    controlGroups.forEach(group => {
      const controlNodeId = generateNodeId('control')
      const isBlock = group.controls.includes('block')

      nodes.set(controlNodeId, {
        id: controlNodeId,
        type: 'control',
        label: isBlock ? 'Block Access' : 'Grant Access',
        sublabel: group.controls.join(', '),
        policies: group.policies.map(p => p.id),
        policyNames: group.policies.map(p => p.displayName),
        policyStates: Object.fromEntries(group.policies.map(p => [p.id, p.state])),
        children: [],
        grantControls: group.controls,
        grantOperator: group.operator
      })

      const edge: DecisionEdge = {
        id: generateEdgeId(),
        source: nodeId,
        target: controlNodeId,
        label: formatControlLabel(group.controls, group.operator),
        policies: group.policies.map(p => p.id),
        policyNames: group.policies.map(p => p.displayName),
        isGap: false
      }
      edges.push(edge)
      node.children.push(edge)
    })
  })

  // Calculate stats
  const gapCount = Array.from(nodes.values()).filter(n => n.isGap).length
  const overlapCount = Array.from(nodes.values()).filter(n => n.policies.length > 1).length

  return {
    nodes,
    edges,
    rootId,
    stats: {
      totalPolicies: filteredPolicies.length,
      totalNodes: nodes.size,
      totalEdges: edges.length,
      gapCount,
      overlapCount,
      maxDepth
    }
  }
}

// Condition evaluation functions

interface ConditionBranch {
  label: string
  sublabel?: string
  edgeLabel: string
  policies: PolicyData[]
  isExclusion?: boolean
}

function evaluateUserScope(policies: PolicyData[]): ConditionBranch[] {
  const branches: ConditionBranch[] = []
  
  // Group by user scope type
  const allUsers = policies.filter(p => 
    p.assignments?.include?.users?.keywords?.includes('All') ||
    p.assignments?.include?.users?.keywords?.includes('AllUsers')
  )
  
  const guestsOnly = policies.filter(p =>
    p.assignments?.include?.users?.keywords?.includes('GuestsOrExternalUsers') &&
    !p.assignments?.include?.users?.keywords?.includes('All')
  )
  
  const specificUsers = policies.filter(p =>
    !p.assignments?.include?.users?.keywords?.includes('All') &&
    !p.assignments?.include?.users?.keywords?.includes('AllUsers') &&
    !p.assignments?.include?.users?.keywords?.includes('GuestsOrExternalUsers') &&
    ((p.assignments?.include?.users?.entities?.length || 0) > 0 ||
     (p.assignments?.include?.groups?.entities?.length || 0) > 0 ||
     (p.assignments?.include?.roles?.entities?.length || 0) > 0)
  )

  if (allUsers.length > 0) {
    branches.push({
      label: 'All Users',
      sublabel: `${allUsers.length} policies`,
      edgeLabel: 'All Users',
      policies: allUsers
    })
  }

  if (guestsOnly.length > 0) {
    branches.push({
      label: 'Guests/External',
      sublabel: `${guestsOnly.length} policies`,
      edgeLabel: 'Guests',
      policies: guestsOnly
    })
  }

  if (specificUsers.length > 0) {
    branches.push({
      label: 'Specific Users/Groups',
      sublabel: `${specificUsers.length} policies`,
      edgeLabel: 'Specific',
      policies: specificUsers
    })
  }

  // Check for gaps - if no "All Users" policy exists
  if (allUsers.length === 0 && policies.length > 0) {
    branches.push({
      label: 'Other Users',
      edgeLabel: 'Other',
      policies: []  // Gap
    })
  }

  return branches
}

function evaluateAppScope(policies: PolicyData[]): ConditionBranch[] {
  const branches: ConditionBranch[] = []
  
  const allApps = policies.filter(p =>
    p.applications?.include?.keywords?.includes('All') ||
    p.applications?.include?.keywords?.includes('AllApplications')
  )
  
  const specificApps = policies.filter(p =>
    !p.applications?.include?.keywords?.includes('All') &&
    !p.applications?.include?.keywords?.includes('AllApplications') &&
    (p.applications?.include?.entities?.length || 0) > 0
  )
  
  const userActions = policies.filter(p =>
    (p as unknown as { applications?: { include?: { userActions?: string[] } } })
      .applications?.include?.userActions?.length
  )

  if (allApps.length > 0) {
    branches.push({
      label: 'All Cloud Apps',
      sublabel: `${allApps.length} policies`,
      edgeLabel: 'All Apps',
      policies: allApps
    })
  }

  if (specificApps.length > 0) {
    branches.push({
      label: 'Specific Apps',
      sublabel: `${specificApps.length} policies`,
      edgeLabel: 'Specific Apps',
      policies: specificApps
    })
  }

  if (userActions.length > 0) {
    branches.push({
      label: 'User Actions',
      sublabel: 'Register security info, etc.',
      edgeLabel: 'User Actions',
      policies: userActions
    })
  }

  return branches.length > 0 ? branches : [{
    label: 'Any Application',
    edgeLabel: 'Any',
    policies
  }]
}

function evaluateLocation(policies: PolicyData[]): ConditionBranch[] {
  const branches: ConditionBranch[] = []
  
  const allLocations = policies.filter(p =>
    !p.conditions?.locations?.include?.keywords?.length &&
    !p.conditions?.locations?.include?.entities?.length
  )
  
  const trustedOnly = policies.filter(p =>
    p.conditions?.locations?.include?.keywords?.includes('AllTrusted')
  )
  
  const excludeTrusted = policies.filter(p =>
    p.conditions?.locations?.include?.keywords?.includes('All') &&
    p.conditions?.locations?.exclude?.keywords?.includes('AllTrusted')
  )
  
  const specificLocations = policies.filter(p =>
    (p.conditions?.locations?.include?.entities?.length || 0) > 0
  )

  if (allLocations.length > 0) {
    branches.push({
      label: 'Any Location',
      sublabel: `${allLocations.length} policies`,
      edgeLabel: 'Any Location',
      policies: allLocations
    })
  }

  if (trustedOnly.length > 0) {
    branches.push({
      label: 'Trusted Only',
      sublabel: 'Named locations marked trusted',
      edgeLabel: 'Trusted',
      policies: trustedOnly
    })
  }

  if (excludeTrusted.length > 0) {
    branches.push({
      label: 'Untrusted Only',
      sublabel: 'All except trusted',
      edgeLabel: 'Untrusted',
      policies: excludeTrusted,
      isExclusion: true
    })
  }

  if (specificLocations.length > 0) {
    branches.push({
      label: 'Specific Locations',
      sublabel: `${specificLocations.length} policies`,
      edgeLabel: 'Named Locations',
      policies: specificLocations
    })
  }

  return branches.length > 0 ? branches : [{
    label: 'Any Location',
    edgeLabel: 'Any',
    policies
  }]
}

function evaluateDevice(policies: PolicyData[]): ConditionBranch[] {
  const branches: ConditionBranch[] = []
  
  const anyDevice = policies.filter(p => {
    const include = p.conditions?.platforms?.include
    return (!Array.isArray(include) || include.length === 0) && !p.conditions?.deviceFilter?.rule
  })
  
  const specificPlatforms = policies.filter(p => {
    const include = p.conditions?.platforms?.include
    return Array.isArray(include) && include.length > 0
  })
  
  const deviceFiltered = policies.filter(p =>
    p.conditions?.deviceFilter?.rule
  )

  if (anyDevice.length > 0) {
    branches.push({
      label: 'Any Device',
      sublabel: `${anyDevice.length} policies`,
      edgeLabel: 'Any Device',
      policies: anyDevice
    })
  }

  if (specificPlatforms.length > 0) {
    const platforms = new Set<string>()
    specificPlatforms.forEach(p => {
      const include = p.conditions?.platforms?.include
      if (Array.isArray(include)) {
        include.forEach(pl => platforms.add(pl))
      }
    })
    branches.push({
      label: 'Specific Platforms',
      sublabel: platforms.size > 0 ? Array.from(platforms).join(', ') : 'Custom platforms',
      edgeLabel: 'Platform Filter',
      policies: specificPlatforms
    })
  }

  if (deviceFiltered.length > 0) {
    branches.push({
      label: 'Device Filter',
      sublabel: 'Rule-based device targeting',
      edgeLabel: 'Device Rule',
      policies: deviceFiltered
    })
  }

  return branches.length > 0 ? branches : [{
    label: 'Any Device',
    edgeLabel: 'Any',
    policies
  }]
}

function evaluateClientApp(policies: PolicyData[]): ConditionBranch[] {
  const branches: ConditionBranch[] = []
  
  // Helper to safely check client app types
  const hasClientType = (types: unknown, type: string): boolean => {
    return Array.isArray(types) && types.includes(type)
  }
  
  const anyClient = policies.filter(p => {
    const types = p.conditions?.clientAppTypes
    return !Array.isArray(types) || types.length === 0 || types.includes('all')
  })
  
  const browserOnly = policies.filter(p => {
    const types = p.conditions?.clientAppTypes
    return hasClientType(types, 'browser') && !hasClientType(types, 'mobileAppsAndDesktopClients')
  })
  
  const modernClients = policies.filter(p => {
    const types = p.conditions?.clientAppTypes
    return hasClientType(types, 'mobileAppsAndDesktopClients')
  })
  
  const legacyAuth = policies.filter(p => {
    const types = p.conditions?.clientAppTypes
    return hasClientType(types, 'exchangeActiveSync') || hasClientType(types, 'other')
  })

  if (anyClient.length > 0) {
    branches.push({
      label: 'Any Client',
      sublabel: `${anyClient.length} policies`,
      edgeLabel: 'Any Client',
      policies: anyClient
    })
  }

  if (browserOnly.length > 0) {
    branches.push({
      label: 'Browser Only',
      sublabel: `${browserOnly.length} policies`,
      edgeLabel: 'Browser',
      policies: browserOnly
    })
  }

  if (modernClients.length > 0) {
    branches.push({
      label: 'Mobile/Desktop',
      sublabel: 'Modern auth clients',
      edgeLabel: 'Modern Auth',
      policies: modernClients
    })
  }

  if (legacyAuth.length > 0) {
    branches.push({
      label: 'Legacy Auth',
      sublabel: 'ActiveSync, Basic auth',
      edgeLabel: 'Legacy',
      policies: legacyAuth
    })
  }

  return branches.length > 0 ? branches : [{
    label: 'Any Client',
    edgeLabel: 'Any',
    policies
  }]
}

function evaluateRisk(policies: PolicyData[]): ConditionBranch[] {
  const branches: ConditionBranch[] = []
  
  // Helper to safely check if array contains value
  const hasRiskLevel = (levels: unknown, checkNone: boolean = false): boolean => {
    if (!Array.isArray(levels) || levels.length === 0) return false
    if (checkNone) return levels.includes('none')
    return levels.some((l: string) => l !== 'none')
  }
  
  const noRisk = policies.filter(p => {
    const userRisks = p.conditions?.userRiskLevels
    const signInRisks = p.conditions?.signInRiskLevels
    const noUserRisk = !Array.isArray(userRisks) || userRisks.length === 0 || userRisks.includes('none')
    const noSignInRisk = !Array.isArray(signInRisks) || signInRisks.length === 0 || signInRisks.includes('none')
    return noUserRisk && noSignInRisk
  })
  
  const userRisk = policies.filter(p => {
    const levels = p.conditions?.userRiskLevels
    return hasRiskLevel(levels)
  })
  
  const signInRisk = policies.filter(p => {
    const levels = p.conditions?.signInRiskLevels
    return hasRiskLevel(levels)
  })

  if (noRisk.length > 0) {
    branches.push({
      label: 'Any Risk Level',
      sublabel: `${noRisk.length} policies`,
      edgeLabel: 'Any Risk',
      policies: noRisk
    })
  }

  if (userRisk.length > 0) {
    const levels = new Set<string>()
    userRisk.forEach(p => {
      const userLevels = p.conditions?.userRiskLevels
      if (Array.isArray(userLevels)) {
        userLevels.forEach(l => levels.add(l))
      }
    })
    branches.push({
      label: 'User Risk',
      sublabel: Array.from(levels).filter(l => l !== 'none').join(', '),
      edgeLabel: 'User Risk',
      policies: userRisk
    })
  }

  if (signInRisk.length > 0) {
    const levels = new Set<string>()
    signInRisk.forEach(p => {
      const signInLevels = p.conditions?.signInRiskLevels
      if (Array.isArray(signInLevels)) {
        signInLevels.forEach(l => levels.add(l))
      }
    })
    branches.push({
      label: 'Sign-in Risk',
      sublabel: Array.from(levels).filter(l => l !== 'none').join(', '),
      edgeLabel: 'Sign-in Risk',
      policies: signInRisk
    })
  }

  return branches.length > 0 ? branches : [{
    label: 'Any Risk',
    edgeLabel: 'Any',
    policies
  }]
}

// Helper to group policies by their grant controls
interface ControlGroup {
  controls: string[]
  operator: string
  policies: PolicyData[]
}

function groupByControls(policies: PolicyData[]): ControlGroup[] {
  const groups = new Map<string, ControlGroup>()
  
  policies.forEach(policy => {
    const controls = policy.grantControls || 
      policy.accessControls?.grant?.builtInControls || 
      []
    const operator = policy.accessControls?.grant?.operator || 'OR'
    const authStrength = policy.accessControls?.grant?.authenticationStrength?.displayName
    
    const allControls = [...controls]
    if (authStrength) {
      allControls.push(`authStrength:${authStrength}`)
    }
    
    const key = `${allControls.sort().join('|')}:${operator}`
    
    if (!groups.has(key)) {
      groups.set(key, {
        controls: allControls,
        operator,
        policies: []
      })
    }
    groups.get(key)!.policies.push(policy)
  })
  
  return Array.from(groups.values())
}

function formatControlLabel(controls: string[], operator: string): string {
  if (controls.length === 0) return 'No controls'
  if (controls.includes('block')) return 'Block'
  
  const formatted = controls.map(c => {
    if (c === 'mfa') return 'MFA'
    if (c === 'compliantDevice') return 'Compliant'
    if (c === 'domainJoinedDevice') return 'Hybrid Join'
    if (c.startsWith('authStrength:')) return c.replace('authStrength:', '')
    return c
  })
  
  const joinWord = operator === 'AND' ? ' + ' : ' or '
  return formatted.slice(0, 2).join(joinWord) + (formatted.length > 2 ? '...' : '')
}

/**
 * Find overlapping policies at each node
 */
export function findOverlaps(tree: DecisionTree): Map<string, string[][]> {
  const overlaps = new Map<string, string[][]>()
  
  tree.nodes.forEach((node, nodeId) => {
    if (node.policies.length > 1) {
      overlaps.set(nodeId, [node.policyNames])
    }
  })
  
  return overlaps
}

/**
 * Find gaps in coverage
 */
export function findGaps(tree: DecisionTree): DecisionNode[] {
  return Array.from(tree.nodes.values()).filter(n => n.isGap)
}

/**
 * Get a simplified tree for display (collapse nodes with single children)
 */
export function simplifyTree(tree: DecisionTree): DecisionTree {
  // For now, return as-is. Can implement node collapsing later.
  return tree
}

