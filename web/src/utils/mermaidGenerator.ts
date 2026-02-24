/**
 * Mermaid Diagram Generator for CA Policy Decision Trees
 * 
 * Converts the decision tree structure into Mermaid flowchart syntax
 * with support for:
 * - Subgraphs for condition layers
 * - Edge labels showing policy paths
 * - Visual differentiation for gaps and overlaps
 * - Stacked layer visualization
 */

import type { DecisionTree, DecisionNode, DecisionEdge, PolicyColor } from './decisionTreeBuilder'

export interface MermaidConfig {
  direction?: 'TD' | 'LR' | 'BT' | 'RL'
  showPolicyNames?: boolean
  showPolicyCounts?: boolean
  highlightGaps?: boolean
  highlightOverlaps?: boolean
  maxLabelLength?: number
}

const DEFAULT_CONFIG: MermaidConfig = {
  direction: 'TD',
  showPolicyNames: false,
  showPolicyCounts: true,
  highlightGaps: true,
  highlightOverlaps: true,
  maxLabelLength: 30
}

/**
 * Generate Mermaid flowchart syntax from a decision tree
 */
export function generateMermaidDiagram(
  tree: DecisionTree,
  policyColors: PolicyColor[],
  config: MermaidConfig = {}
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const lines: string[] = []
  
  // Header
  lines.push(`flowchart ${cfg.direction}`)
  lines.push('')
  
  // Organize nodes by type/layer for subgraphs
  const startNodes: DecisionNode[] = []
  const conditionNodes: DecisionNode[] = []
  const controlNodes: DecisionNode[] = []
  const gapNodes: DecisionNode[] = []
  
  tree.nodes.forEach(node => {
    switch (node.type) {
      case 'start':
        startNodes.push(node)
        break
      case 'condition':
        conditionNodes.push(node)
        break
      case 'control':
        controlNodes.push(node)
        break
      case 'gap':
        gapNodes.push(node)
        break
    }
  })
  
  // Generate nodes by subgraph
  lines.push('    subgraph entry [Sign-In Entry Point]')
  startNodes.forEach(node => {
    lines.push(`        ${generateNodeDefinition(node, cfg)}`)
  })
  lines.push('    end')
  lines.push('')
  
  if (conditionNodes.length > 0) {
    // Group condition nodes by their field
    const conditionsByField = new Map<string, DecisionNode[]>()
    conditionNodes.forEach(node => {
      const field = node.conditionField || 'other'
      if (!conditionsByField.has(field)) {
        conditionsByField.set(field, [])
      }
      conditionsByField.get(field)!.push(node)
    })
    
    // Create subgraphs for each condition type
    const fieldLabels: Record<string, string> = {
      userScope: 'User Scope',
      appScope: 'Application Scope',
      location: 'Location Conditions',
      device: 'Device Conditions',
      clientApp: 'Client Application',
      risk: 'Risk Evaluation'
    }
    
    conditionsByField.forEach((nodes, field) => {
      const label = fieldLabels[field] || field
      const subgraphId = `cond_${field}`
      lines.push(`    subgraph ${subgraphId} [${label}]`)
      nodes.forEach(node => {
        lines.push(`        ${generateNodeDefinition(node, cfg)}`)
      })
      lines.push('    end')
      lines.push('')
    })
  }
  
  if (controlNodes.length > 0 || gapNodes.length > 0) {
    lines.push('    subgraph outcome [Access Decision]')
    controlNodes.forEach(node => {
      lines.push(`        ${generateNodeDefinition(node, cfg)}`)
    })
    gapNodes.forEach(node => {
      lines.push(`        ${generateNodeDefinition(node, cfg)}`)
    })
    lines.push('    end')
    lines.push('')
  }
  
  // Generate edges
  lines.push('    %% Connections')
  tree.edges.forEach(edge => {
    lines.push(`    ${generateEdgeDefinition(edge, policyColors, cfg)}`)
  })
  
  // Add class definitions for styling
  lines.push('')
  lines.push('    %% Styling')
  lines.push('    classDef startNode fill:#1a365d,stroke:#2b6cb0,color:#fff')
  lines.push('    classDef conditionNode fill:#2d3748,stroke:#4a5568,color:#e2e8f0')
  lines.push('    classDef controlNode fill:#2563eb,stroke:#3b82f6,color:#fff')
  lines.push('    classDef blockNode fill:#9b2c2c,stroke:#c53030,color:#fff')
  lines.push('    classDef gapNode fill:#744210,stroke:#d69e2e,color:#fff,stroke-dasharray:5')
  lines.push('    classDef overlapNode stroke-width:3px')
  
  // Apply classes
  startNodes.forEach(n => lines.push(`    class ${sanitizeId(n.id)} startNode`))
  conditionNodes.forEach(n => {
    lines.push(`    class ${sanitizeId(n.id)} conditionNode`)
    if (n.policies.length > 1 && cfg.highlightOverlaps) {
      lines.push(`    class ${sanitizeId(n.id)} overlapNode`)
    }
  })
  controlNodes.forEach(n => {
    const isBlock = n.grantControls?.includes('block')
    lines.push(`    class ${sanitizeId(n.id)} ${isBlock ? 'blockNode' : 'controlNode'}`)
  })
  gapNodes.forEach(n => lines.push(`    class ${sanitizeId(n.id)} gapNode`))
  
  return lines.join('\n')
}

/**
 * Generate node definition with appropriate shape
 */
function generateNodeDefinition(node: DecisionNode, cfg: MermaidConfig): string {
  const id = sanitizeId(node.id)
  let label = truncateLabel(node.label, cfg.maxLabelLength!)
  
  // Add policy count if configured
  if (cfg.showPolicyCounts && node.policies.length > 0) {
    label += `\\n${node.policies.length} ${node.policies.length === 1 ? 'policy' : 'policies'}`
  }
  
  // Add sublabel if present
  if (node.sublabel) {
    label += `\\n${truncateLabel(node.sublabel, cfg.maxLabelLength!)}`
  }
  
  // Choose shape based on node type
  switch (node.type) {
    case 'start':
      return `${id}([${escapeLabel(label)}])`
    case 'condition':
      return `${id}{${escapeLabel(label)}}`
    case 'control':
      return `${id}[/${escapeLabel(label)}/]`
    case 'gap':
      return `${id}[["${escapeLabel(label)}"]]`
    default:
      return `${id}[${escapeLabel(label)}]`
  }
}

/**
 * Generate edge definition with label
 */
function generateEdgeDefinition(
  edge: DecisionEdge,
  _policyColors: PolicyColor[],  // Reserved for future color-coded edges
  cfg: MermaidConfig
): string {
  const source = sanitizeId(edge.source)
  const target = sanitizeId(edge.target)
  let label = truncateLabel(edge.label, cfg.maxLabelLength!)
  
  // Add policy names if configured
  if (cfg.showPolicyNames && edge.policyNames.length > 0 && edge.policyNames.length <= 2) {
    label += ` (${edge.policyNames.join(', ')})`
  }
  
  // Choose edge style
  let arrow = '-->'
  if (edge.isGap) {
    arrow = '-.->'  // Dotted for gaps
  } else if (edge.isExclusion) {
    arrow = '==>'  // Thick for exclusions
  } else if (edge.policies.length > 1) {
    arrow = '==>'  // Thick for overlap
  }
  
  return `${source} ${arrow}|"${escapeLabel(label)}"| ${target}`
}

/**
 * Generate a simplified diagram for a single policy
 */
export function generateSinglePolicyDiagram(
  policy: {
    id: string
    displayName: string
    state: string
    assignments?: {
      include?: {
        users?: { keywords?: string[] }
        groups?: { entities?: { displayName: string }[] }
        roles?: { entities?: { displayName: string }[] }
      }
    }
    applications?: {
      include?: { keywords?: string[] }
    }
    conditions?: {
      locations?: {
        include?: { keywords?: string[] }
        exclude?: { keywords?: string[] }
      }
      clientAppTypes?: string[]
      userRiskLevels?: string[]
      signInRiskLevels?: string[]
    }
    grantControls?: string[]
    accessControls?: {
      grant?: {
        operator?: string
        builtInControls?: string[]
        authenticationStrength?: { displayName?: string }
      }
    }
  }
): string {
  const lines: string[] = []
  lines.push('flowchart TD')
  lines.push('')
  
  // Start
  lines.push('    Start([Sign-In Request]) --> UserScope')
  
  // User Scope
  const userKeywords = policy.assignments?.include?.users?.keywords || []
  const userLabel = userKeywords.includes('All') || userKeywords.includes('AllUsers') 
    ? 'All Users' 
    : userKeywords.includes('GuestsOrExternalUsers')
      ? 'Guests/External'
      : 'Specific Users'
  lines.push(`    UserScope{User: ${userLabel}} --> AppScope`)
  
  // App Scope
  const appKeywords = policy.applications?.include?.keywords || []
  const appLabel = appKeywords.includes('All') || appKeywords.includes('AllApplications')
    ? 'All Apps'
    : 'Specific Apps'
  lines.push(`    AppScope{Apps: ${appLabel}} --> Location`)
  
  // Location
  const locInclude = policy.conditions?.locations?.include?.keywords || []
  const locExclude = policy.conditions?.locations?.exclude?.keywords || []
  let locLabel = 'Any Location'
  if (locInclude.includes('AllTrusted')) {
    locLabel = 'Trusted Only'
  } else if (locInclude.includes('All') && locExclude.includes('AllTrusted')) {
    locLabel = 'Untrusted Only'
  }
  lines.push(`    Location{Location: ${locLabel}} --> Client`)
  
  // Client
  const clientApps = policy.conditions?.clientAppTypes || []
  let clientLabel = 'Any Client'
  if (clientApps.includes('browser') && clientApps.length === 1) {
    clientLabel = 'Browser'
  } else if (clientApps.includes('exchangeActiveSync') || clientApps.includes('other')) {
    clientLabel = 'Legacy Auth'
  }
  lines.push(`    Client{Client: ${clientLabel}} --> Risk`)
  
  // Risk
  const userRisk = policy.conditions?.userRiskLevels?.filter(r => r !== 'none') || []
  const signInRisk = policy.conditions?.signInRiskLevels?.filter(r => r !== 'none') || []
  let riskLabel = 'Any Risk'
  if (userRisk.length > 0) {
    riskLabel = `User: ${userRisk.join(', ')}`
  } else if (signInRisk.length > 0) {
    riskLabel = `Sign-in: ${signInRisk.join(', ')}`
  }
  lines.push(`    Risk{Risk: ${riskLabel}} --> Control`)
  
  // Control
  const controls = policy.grantControls || policy.accessControls?.grant?.builtInControls || []
  const authStrength = policy.accessControls?.grant?.authenticationStrength?.displayName
  const operator = policy.accessControls?.grant?.operator || 'OR'
  
  if (controls.includes('block')) {
    lines.push('    Control[/Block Access/]')
    lines.push('    class Control blockStyle')
  } else {
    let controlLabel = controls.map(c => {
      if (c === 'mfa') return 'MFA'
      if (c === 'compliantDevice') return 'Compliant Device'
      if (c === 'domainJoinedDevice') return 'Hybrid AD Join'
      return c
    }).join(operator === 'AND' ? ' + ' : ' or ')
    
    if (authStrength) {
      controlLabel += ` (${authStrength})`
    }
    
    lines.push(`    Control[/Grant: ${controlLabel}/]`)
    lines.push('    class Control grantStyle')
  }
  
  // Styles
  lines.push('')
  lines.push('    classDef blockStyle fill:#9b2c2c,stroke:#c53030,color:#fff')
  lines.push('    classDef grantStyle fill:#2563eb,stroke:#3b82f6,color:#fff')
  
  return lines.join('\n')
}

/**
 * Generate a comparison diagram for multiple policies
 */
export function generateComparisonDiagram(
  policies: Array<{
    id: string
    displayName: string
    state: string
    grantControls?: string[]
    accessControls?: {
      grant?: {
        builtInControls?: string[]
      }
    }
    conditions?: {
      locations?: {
        include?: { keywords?: string[] }
        exclude?: { keywords?: string[] }
      }
    }
  }>
): string {
  const lines: string[] = []
  lines.push('flowchart LR')
  lines.push('')
  
  // Create parallel flows for each policy
  policies.forEach((policy, index) => {
    const prefix = `p${index}`
    const name = truncateLabel(policy.displayName, 20)
    
    lines.push(`    subgraph ${prefix} [${name}]`)
    lines.push(`        ${prefix}_start([Start]) --> ${prefix}_eval{Evaluate}`)
    
    const controls = policy.grantControls || policy.accessControls?.grant?.builtInControls || []
    if (controls.includes('block')) {
      lines.push(`        ${prefix}_eval --> ${prefix}_block[/Block/]`)
    } else {
      const controlStr = controls.slice(0, 2).map(c => c === 'mfa' ? 'MFA' : c).join('+')
      lines.push(`        ${prefix}_eval --> ${prefix}_grant[/${controlStr}/]`)
    }
    lines.push('    end')
    lines.push('')
  })
  
  return lines.join('\n')
}

// Helper functions

function sanitizeId(id: string): string {
  // Mermaid IDs can't have certain characters
  return id.replace(/[^a-zA-Z0-9_]/g, '_')
}

function escapeLabel(label: string): string {
  // Escape special Mermaid characters
  return label
    .replace(/"/g, "'")
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
}

function truncateLabel(label: string, maxLength: number): string {
  if (label.length <= maxLength) return label
  return label.substring(0, maxLength - 3) + '...'
}

