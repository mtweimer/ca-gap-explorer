import { useState, useMemo } from 'react'
import type { GraphData, GraphNode, GraphEdge } from '../types/graph'
import './PolicyExplorer.css'

interface PolicyExplorerProps {
  graphData: GraphData
  policyId: string
  onClose?: () => void
}

interface ExpandableSection {
  title: string
  icon: string
  count: number
  items: SectionItem[]
  type: 'include' | 'exclude' | 'condition' | 'control'
}

interface SectionItem {
  id: string
  label: string
  type: string
  subItems?: SectionItem[]
  properties?: Record<string, unknown>
  via?: string[]
}

export function PolicyExplorer({ graphData, policyId, onClose }: PolicyExplorerProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['assignments-include']))
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())

  const policy = useMemo(() => {
    return graphData.nodes.find(n => n.id === policyId && n.type === 'policy')
  }, [graphData.nodes, policyId])

  const policyEdges = useMemo(() => {
    return graphData.edges.filter(e => e.from === policyId)
  }, [graphData.edges, policyId])

  const sections = useMemo((): ExpandableSection[] => {
    if (!policy) return []

    const props = policy.properties as Record<string, unknown> || {}
    const sections: ExpandableSection[] = []

    // Build include assignments section
    const includeEdges = policyEdges.filter(e => e.relationship.startsWith('include:'))
    const includeItems = buildItemsFromEdges(includeEdges, graphData.nodes)
    if (includeItems.length > 0) {
      sections.push({
        title: 'Include Assignments',
        icon: '✅',
        count: includeItems.length,
        items: includeItems,
        type: 'include'
      })
    }

    // Build exclude assignments section
    const excludeEdges = policyEdges.filter(e => e.relationship.startsWith('exclude:'))
    const excludeItems = buildItemsFromEdges(excludeEdges, graphData.nodes)
    if (excludeItems.length > 0) {
      sections.push({
        title: 'Exclude Assignments',
        icon: '🚫',
        count: excludeItems.length,
        items: excludeItems,
        type: 'exclude'
      })
    }

    // Grant Controls section
    const grantControls = props.grantControls as string[] || []
    if (grantControls.length > 0) {
      sections.push({
        title: 'Grant Controls',
        icon: '🔐',
        count: grantControls.length,
        items: grantControls.map(gc => ({
          id: `grant-${gc}`,
          label: formatGrantControl(gc),
          type: 'control'
        })),
        type: 'control'
      })
    }

    // Session Controls section
    const sessionSummary = props.sessionControlsSummary as string[] || []
    if (sessionSummary.length > 0) {
      sections.push({
        title: 'Session Controls',
        icon: '⏱️',
        count: sessionSummary.length,
        items: sessionSummary.map(sc => ({
          id: `session-${sc}`,
          label: sc,
          type: 'session'
        })),
        type: 'control'
      })
    }

    // Conditions section
    const conditionsSummary = props.conditionsSummary as string[] || []
    const conditions = props.conditions as Record<string, unknown> || {}
    const conditionItems: SectionItem[] = []

    // Client app types
    const clientAppTypes = conditions.clientAppTypes as string[] || []
    if (clientAppTypes.length > 0) {
      conditionItems.push({
        id: 'cond-clientApps',
        label: `Client Apps: ${clientAppTypes.join(', ')}`,
        type: 'condition'
      })
    }

    // Platforms
    const platforms = conditions.platforms as Record<string, string[]> || {}
    if (platforms.include?.length > 0) {
      conditionItems.push({
        id: 'cond-platforms',
        label: `Platforms: ${platforms.include.join(', ')}`,
        type: 'condition'
      })
    }

    // Risk levels
    const userRisk = conditions.userRiskLevels as string[] || []
    const signInRisk = conditions.signInRiskLevels as string[] || []
    if (userRisk.length > 0) {
      conditionItems.push({
        id: 'cond-userRisk',
        label: `User Risk: ${userRisk.join(', ')}`,
        type: 'condition'
      })
    }
    if (signInRisk.length > 0) {
      conditionItems.push({
        id: 'cond-signInRisk',
        label: `Sign-in Risk: ${signInRisk.join(', ')}`,
        type: 'condition'
      })
    }

    // Add parsed conditions from summary
    conditionsSummary.forEach((cond, i) => {
      if (!conditionItems.some(c => c.label.includes(cond.split(':')[0]))) {
        conditionItems.push({
          id: `cond-summary-${i}`,
          label: cond,
          type: 'condition'
        })
      }
    })

    if (conditionItems.length > 0) {
      sections.push({
        title: 'Conditions',
        icon: '⚙️',
        count: conditionItems.length,
        items: conditionItems,
        type: 'condition'
      })
    }

    return sections
  }, [policy, policyEdges, graphData.nodes])

  if (!policy) {
    return (
      <div className="policy-explorer policy-explorer--empty">
        <p>Policy not found</p>
      </div>
    )
  }

  const props = policy.properties as Record<string, unknown> || {}
  const state = props.state as string || 'unknown'
  const stateClass = state === 'enabled' ? 'enabled' : 
                     state === 'enabledForReportingButNotEnforced' ? 'report-only' : 'disabled'

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }

  const toggleItem = (itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  return (
    <div className="policy-explorer">
      <div className="policy-explorer__header">
        <div className="policy-explorer__title">
          <span className="policy-explorer__icon">🛡️</span>
          <h2>{policy.label}</h2>
          <span className={`policy-explorer__state policy-explorer__state--${stateClass}`}>
            {formatState(state)}
          </span>
        </div>
        {onClose && (
          <button className="policy-explorer__close" onClick={onClose}>×</button>
        )}
      </div>

      <div className="policy-explorer__meta">
        <div className="policy-explorer__meta-item">
          <span className="policy-explorer__meta-label">Created:</span>
          <span>{formatDate(props.createdDateTime as string)}</span>
        </div>
        <div className="policy-explorer__meta-item">
          <span className="policy-explorer__meta-label">Modified:</span>
          <span>{formatDate(props.modifiedDateTime as string)}</span>
        </div>
      </div>

      <div className="policy-explorer__sections">
        {sections.map(section => {
          const sectionId = `${section.type}-${section.title.toLowerCase().replace(/\s+/g, '-')}`
          const isExpanded = expandedSections.has(sectionId)

          return (
            <div 
              key={sectionId} 
              className={`policy-explorer__section policy-explorer__section--${section.type}`}
            >
              <button 
                className="policy-explorer__section-header"
                onClick={() => toggleSection(sectionId)}
              >
                <span className="policy-explorer__section-icon">{section.icon}</span>
                <span className="policy-explorer__section-title">{section.title}</span>
                <span className="policy-explorer__section-count">{section.count}</span>
                <span className="policy-explorer__section-toggle">
                  {isExpanded ? '▼' : '▶'}
                </span>
              </button>

              {isExpanded && (
                <div className="policy-explorer__section-content">
                  {section.items.map(item => (
                    <PolicyExplorerItem
                      key={item.id}
                      item={item}
                      isExpanded={expandedItems.has(item.id)}
                      onToggle={() => toggleItem(item.id)}
                      sectionType={section.type}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface PolicyExplorerItemProps {
  item: SectionItem
  isExpanded: boolean
  onToggle: () => void
  sectionType: string
  depth?: number
}

function PolicyExplorerItem({ item, isExpanded, onToggle, sectionType, depth = 0 }: PolicyExplorerItemProps) {
  const hasSubItems = item.subItems && item.subItems.length > 0
  const typeIcon = getTypeIcon(item.type)

  return (
    <div className={`policy-explorer__item policy-explorer__item--depth-${depth}`}>
      <div className="policy-explorer__item-header" onClick={hasSubItems ? onToggle : undefined}>
        {hasSubItems && (
          <span className="policy-explorer__item-toggle">{isExpanded ? '▼' : '▶'}</span>
        )}
        <span className="policy-explorer__item-icon">{typeIcon}</span>
        <span className="policy-explorer__item-label">{item.label}</span>
        {item.via && item.via.length > 0 && (
          <span className="policy-explorer__item-via">via {item.via.join(' → ')}</span>
        )}
        {hasSubItems && (
          <span className="policy-explorer__item-count">{item.subItems!.length}</span>
        )}
      </div>

      {isExpanded && hasSubItems && (
        <div className="policy-explorer__item-children">
          {item.subItems!.map(subItem => (
            <PolicyExplorerItem
              key={subItem.id}
              item={subItem}
              isExpanded={false}
              onToggle={() => {}}
              sectionType={sectionType}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Helper functions

function buildItemsFromEdges(edges: GraphEdge[], nodes: GraphNode[]): SectionItem[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const groupedByType = new Map<string, SectionItem[]>()

  edges.forEach(edge => {
    const [, entityType] = edge.relationship.split(':')
    const targetNode = nodeMap.get(edge.to)
    
    if (!groupedByType.has(entityType)) {
      groupedByType.set(entityType, [])
    }

    const item: SectionItem = {
      id: edge.to,
      label: edge.properties?.targetDisplayName as string || targetNode?.label || edge.to,
      type: entityType,
      properties: targetNode?.properties as Record<string, unknown>,
      via: edge.properties?.via as string[]
    }

    // Check if this entity has nested items (e.g., group members)
    if (targetNode?.properties) {
      const props = targetNode.properties as Record<string, unknown>
      if (props.members && Array.isArray(props.members)) {
        item.subItems = (props.members as Array<Record<string, unknown>>).map((m, i) => ({
          id: `${edge.to}-member-${i}`,
          label: m.displayName as string || m.id as string,
          type: m.type as string || 'user',
          via: m.via as string[]
        }))
      }
    }

    groupedByType.get(entityType)!.push(item)
  })

  // Flatten into a single array with type headers
  const result: SectionItem[] = []
  const typeOrder = ['user', 'group', 'role', 'servicePrincipal', 'namedLocation', 'keyword']
  
  typeOrder.forEach(type => {
    const items = groupedByType.get(type)
    if (items && items.length > 0) {
      result.push(...items)
    }
  })

  // Add any remaining types
  groupedByType.forEach((items, type) => {
    if (!typeOrder.includes(type) && items.length > 0) {
      result.push(...items)
    }
  })

  return result
}

function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    user: '👤',
    group: '👥',
    role: '🎛️',
    servicePrincipal: '🔑',
    namedLocation: '📍',
    keyword: '🔎',
    device: '💻',
    organization: '🏢',
    condition: '⚙️',
    control: '🔐',
    session: '⏱️'
  }
  return icons[type] || '•'
}

function formatGrantControl(control: string): string {
  const labels: Record<string, string> = {
    mfa: 'Require MFA',
    block: 'Block Access',
    compliantDevice: 'Require Compliant Device',
    domainJoinedDevice: 'Require Hybrid Azure AD Join',
    approvedApplication: 'Require Approved Client App',
    compliantApplication: 'Require App Protection Policy',
    passwordChange: 'Require Password Change'
  }
  
  if (control.startsWith('authStrength:')) {
    return `Authentication Strength: ${control.replace('authStrength:', '')}`
  }
  
  return labels[control] || control
}

function formatState(state: string): string {
  const labels: Record<string, string> = {
    enabled: 'Enabled',
    enabledForReportingButNotEnforced: 'Report Only',
    disabled: 'Disabled'
  }
  return labels[state] || state
}

function formatDate(dateString: string | undefined): string {
  if (!dateString) return 'N/A'
  try {
    return new Date(dateString).toLocaleDateString()
  } catch {
    return dateString
  }
}

