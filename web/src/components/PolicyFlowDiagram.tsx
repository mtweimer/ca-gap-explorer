import React, { useMemo } from 'react'
import './PolicyFlowDiagram.css'

interface PolicyFlowDiagramProps {
  policy: any
  compact?: boolean
  onClose?: () => void
}

interface FlowNode {
  id: string
  type: 'start' | 'decision' | 'action' | 'end'
  label: string
  sublabel?: string
  className?: string
}

interface FlowEdge {
  from: string
  to: string
  label?: string
  className?: string
}

interface FlowData {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export function PolicyFlowDiagram({ policy, compact = false, onClose }: PolicyFlowDiagramProps) {
  const flowData = useMemo(() => buildFlowData(policy), [policy])
  
  if (!policy) {
    return (
      <div className="policy-flow-diagram policy-flow-diagram--empty">
        <p>Select a policy to view its decision flow</p>
      </div>
    )
  }
  
  return (
    <div className={`policy-flow-diagram ${compact ? 'policy-flow-diagram--compact' : ''}`}>
      <div className="policy-flow-diagram__header">
        <div className="policy-flow-diagram__title">
          <h3>{policy.displayName}</h3>
          <span className={`policy-flow-diagram__state policy-flow-diagram__state--${policy.state}`}>
            {policy.state === 'enabled' ? '🟢 Enabled' : 
             policy.state === 'enabledForReportingButNotEnforced' ? '🟡 Report-Only' : 
             '🔴 Disabled'}
          </span>
        </div>
        {onClose && (
          <button className="policy-flow-diagram__close" onClick={onClose}>×</button>
        )}
      </div>
      
      <div className="policy-flow-diagram__content">
        <svg className="policy-flow-diagram__svg" viewBox="0 0 600 800">
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-secondary, #a0a0b0)" />
            </marker>
          </defs>
          
          {/* Render edges */}
          {flowData.edges.map((edge, i) => {
            const fromNode = flowData.nodes.find(n => n.id === edge.from)
            const toNode = flowData.nodes.find(n => n.id === edge.to)
            if (!fromNode || !toNode) return null
            
            const fromPos = getNodePosition(fromNode.id, flowData.nodes)
            const toPos = getNodePosition(toNode.id, flowData.nodes)
            
            const path = createPath(fromPos, toPos)
            
            return (
              <g key={i} className={`flow-edge ${edge.className || ''}`}>
                <path
                  d={path}
                  fill="none"
                  stroke="var(--text-secondary, #a0a0b0)"
                  strokeWidth="2"
                  markerEnd="url(#arrowhead)"
                />
                {edge.label && (
                  <text
                    x={(fromPos.x + toPos.x) / 2}
                    y={(fromPos.y + toPos.y) / 2 - 10}
                    className="flow-edge-label"
                    textAnchor="middle"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            )
          })}
          
          {/* Render nodes */}
          {flowData.nodes.map(node => {
            const pos = getNodePosition(node.id, flowData.nodes)
            return (
              <g key={node.id} className={`flow-node flow-node--${node.type} ${node.className || ''}`}>
                {renderNodeShape(node, pos)}
                <text
                  x={pos.x}
                  y={pos.y + 5}
                  className="flow-node-label"
                  textAnchor="middle"
                >
                  {node.label}
                </text>
                {node.sublabel && (
                  <text
                    x={pos.x}
                    y={pos.y + 22}
                    className="flow-node-sublabel"
                    textAnchor="middle"
                  >
                    {node.sublabel}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      
      {/* Legend */}
      <div className="policy-flow-diagram__legend">
        <div className="legend-item">
          <span className="legend-shape legend-shape--decision">◇</span>
          <span>Decision</span>
        </div>
        <div className="legend-item">
          <span className="legend-shape legend-shape--action">▢</span>
          <span>Action</span>
        </div>
        <div className="legend-item legend-item--yes">
          <span className="legend-line">→</span>
          <span>Yes</span>
        </div>
        <div className="legend-item legend-item--no">
          <span className="legend-line">→</span>
          <span>No</span>
        </div>
      </div>
    </div>
  )
}

function buildFlowData(policy: any): FlowData {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  
  if (!policy) return { nodes, edges }
  
  // Start node
  nodes.push({
    id: 'start',
    type: 'start',
    label: '🔑 Sign-in Request'
  })
  
  // User scope check
  const userInclude = policy.assignments?.include?.users
  const hasAllUsers = userInclude?.keywords?.includes('All')
  const specificUsers = userInclude?.entities?.length || 0
  const specificGroups = policy.assignments?.include?.groups?.entities?.length || 0
  
  nodes.push({
    id: 'check-user',
    type: 'decision',
    label: 'User in Scope?',
    sublabel: hasAllUsers ? 'All Users' : `${specificUsers} users, ${specificGroups} groups`
  })
  
  edges.push({ from: 'start', to: 'check-user' })
  
  // User excluded check
  const userExclude = policy.assignments?.exclude?.users
  const excludedUsers = userExclude?.entities?.length || 0
  const excludedGroups = policy.assignments?.exclude?.groups?.entities?.length || 0
  const hasExclusions = excludedUsers > 0 || excludedGroups > 0
  
  if (hasExclusions) {
    nodes.push({
      id: 'check-exclude',
      type: 'decision',
      label: 'User Excluded?',
      sublabel: `${excludedUsers} users, ${excludedGroups} groups`
    })
    edges.push({ from: 'check-user', to: 'check-exclude', label: 'Yes' })
    edges.push({ from: 'check-exclude', to: 'not-applied-exclude', label: 'Yes', className: 'edge-no' })
    
    nodes.push({
      id: 'not-applied-exclude',
      type: 'end',
      label: '⏭️ Not Applied',
      sublabel: 'User excluded',
      className: 'node-skip'
    })
  }
  
  // Application check
  const appInclude = policy.targetResources?.applications?.include
  const hasAllApps = appInclude?.keywords?.includes('All')
  
  nodes.push({
    id: 'check-app',
    type: 'decision',
    label: 'App in Scope?',
    sublabel: hasAllApps ? 'All Apps' : 'Specific Apps'
  })
  
  if (hasExclusions) {
    edges.push({ from: 'check-exclude', to: 'check-app', label: 'No' })
  } else {
    edges.push({ from: 'check-user', to: 'check-app', label: 'Yes' })
  }
  
  // Not applied (user not in scope)
  nodes.push({
    id: 'not-applied-user',
    type: 'end',
    label: '⏭️ Not Applied',
    sublabel: 'User not in scope',
    className: 'node-skip'
  })
  edges.push({ from: 'check-user', to: 'not-applied-user', label: 'No', className: 'edge-no' })
  
  // Location check
  const locations = policy.conditions?.locations
  const locationInclude = locations?.include
  const locationExclude = locations?.exclude
  const hasLocationCondition = 
    (locationInclude?.keywords?.length > 0) ||
    (locationInclude?.entities?.length > 0) ||
    (locationExclude?.entities?.length > 0)
  
  let lastCheckNode = 'check-app'
  
  if (hasLocationCondition) {
    const includesAllLoc = locationInclude?.keywords?.includes('All')
    const excludedLocs = locationExclude?.entities?.map((e: any) => e.displayName).join(', ') || ''
    const includedLocs = locationInclude?.entities?.map((e: any) => e.displayName).join(', ') || ''
    
    nodes.push({
      id: 'check-location',
      type: 'decision',
      label: 'Location Match?',
      sublabel: includesAllLoc 
        ? (excludedLocs ? `All except: ${excludedLocs}` : 'All Locations')
        : (includedLocs || 'Specific')
    })
    
    edges.push({ from: 'check-app', to: 'check-location', label: 'Yes' })
    
    nodes.push({
      id: 'not-applied-location',
      type: 'end',
      label: '⏭️ Not Applied',
      sublabel: 'Location not matched',
      className: 'node-skip'
    })
    edges.push({ from: 'check-location', to: 'not-applied-location', label: 'No', className: 'edge-no' })
    
    lastCheckNode = 'check-location'
  }
  
  // Not applied (app not in scope)
  nodes.push({
    id: 'not-applied-app',
    type: 'end',
    label: '⏭️ Not Applied',
    sublabel: 'App not in scope',
    className: 'node-skip'
  })
  edges.push({ from: 'check-app', to: 'not-applied-app', label: 'No', className: 'edge-no' })
  
  // Client app check
  const clientAppTypes = policy.conditions?.clientAppTypes
  const isLegacyOnly = Array.isArray(clientAppTypes) && 
    clientAppTypes.some((t: string) => t === 'exchangeActiveSync' || t === 'other')
  
  if (clientAppTypes !== 'all' && Array.isArray(clientAppTypes)) {
    nodes.push({
      id: 'check-client',
      type: 'decision',
      label: 'Client App Match?',
      sublabel: isLegacyOnly ? 'Legacy Auth' : clientAppTypes.join(', ')
    })
    
    edges.push({ from: lastCheckNode, to: 'check-client', label: 'Yes' })
    
    nodes.push({
      id: 'not-applied-client',
      type: 'end',
      label: '⏭️ Not Applied',
      sublabel: 'Client not matched',
      className: 'node-skip'
    })
    edges.push({ from: 'check-client', to: 'not-applied-client', label: 'No', className: 'edge-no' })
    
    lastCheckNode = 'check-client'
  }
  
  // Grant control
  const grantControls = policy.accessControls?.grant?.builtInControls
  const controls = Array.isArray(grantControls) ? grantControls : [grantControls]
  const isBlock = controls.includes('block')
  const operator = policy.accessControls?.grant?.operator || 'OR'
  
  if (isBlock) {
    nodes.push({
      id: 'action-block',
      type: 'action',
      label: '🚫 BLOCK ACCESS',
      className: 'node-block'
    })
    edges.push({ from: lastCheckNode, to: 'action-block', label: 'Yes' })
  } else {
    const controlLabels = controls.filter((c: string) => c !== 'block').map(formatControlLabel)
    const controlText = controlLabels.join(operator === 'AND' ? ' AND ' : ' OR ')
    
    nodes.push({
      id: 'action-grant',
      type: 'action',
      label: '✅ Grant Access',
      sublabel: controlText || 'No additional controls',
      className: 'node-grant'
    })
    edges.push({ from: lastCheckNode, to: 'action-grant', label: 'Yes' })
  }
  
  return { nodes, edges }
}

function formatControlLabel(control: string): string {
  const labels: Record<string, string> = {
    mfa: 'Require MFA',
    compliantDevice: 'Compliant Device',
    domainJoinedDevice: 'Hybrid AD Join',
    approvedApplication: 'Approved App',
    compliantApplication: 'App Protection',
    passwordChange: 'Password Change'
  }
  return labels[control] || control
}

function getNodePosition(nodeId: string, nodes: FlowNode[]): { x: number; y: number } {
  const positions: Record<string, { x: number; y: number }> = {
    'start': { x: 300, y: 40 },
    'check-user': { x: 300, y: 120 },
    'not-applied-user': { x: 500, y: 120 },
    'check-exclude': { x: 300, y: 200 },
    'not-applied-exclude': { x: 500, y: 200 },
    'check-app': { x: 300, y: 280 },
    'not-applied-app': { x: 500, y: 280 },
    'check-location': { x: 300, y: 360 },
    'not-applied-location': { x: 500, y: 360 },
    'check-client': { x: 300, y: 440 },
    'not-applied-client': { x: 500, y: 440 },
    'action-block': { x: 300, y: 520 },
    'action-grant': { x: 300, y: 520 }
  }
  
  // Adjust positions based on which nodes exist
  const existingIds = nodes.map(n => n.id)
  let yOffset = 0
  
  if (!existingIds.includes('check-exclude')) {
    if (['check-app', 'check-location', 'check-client', 'action-block', 'action-grant', 'not-applied-app', 'not-applied-location', 'not-applied-client'].includes(nodeId)) {
      yOffset -= 80
    }
  }
  
  if (!existingIds.includes('check-location')) {
    if (['check-client', 'action-block', 'action-grant', 'not-applied-client'].includes(nodeId)) {
      yOffset -= 80
    }
  }
  
  if (!existingIds.includes('check-client')) {
    if (['action-block', 'action-grant'].includes(nodeId)) {
      yOffset -= 80
    }
  }
  
  const pos = positions[nodeId] || { x: 300, y: 400 }
  return { x: pos.x, y: pos.y + yOffset }
}

function createPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  // Simple straight or L-shaped path
  if (from.x === to.x) {
    // Vertical
    return `M ${from.x} ${from.y + 25} L ${to.x} ${to.y - 25}`
  } else {
    // L-shaped
    const midY = (from.y + to.y) / 2
    return `M ${from.x} ${from.y + 25} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y - 25}`
  }
}

function renderNodeShape(node: FlowNode, pos: { x: number; y: number }): React.ReactElement {
  switch (node.type) {
    case 'start':
      return (
        <ellipse
          cx={pos.x}
          cy={pos.y}
          rx={70}
          ry={25}
          className="flow-node-shape flow-node-shape--start"
        />
      )
    case 'decision':
      const size = 35
      return (
        <polygon
          points={`${pos.x},${pos.y - size} ${pos.x + size},${pos.y} ${pos.x},${pos.y + size} ${pos.x - size},${pos.y}`}
          className="flow-node-shape flow-node-shape--decision"
        />
      )
    case 'action':
      return (
        <rect
          x={pos.x - 80}
          y={pos.y - 25}
          width={160}
          height={50}
          rx={8}
          className={`flow-node-shape flow-node-shape--action ${node.className || ''}`}
        />
      )
    case 'end':
      return (
        <rect
          x={pos.x - 60}
          y={pos.y - 20}
          width={120}
          height={40}
          rx={6}
          className={`flow-node-shape flow-node-shape--end ${node.className || ''}`}
        />
      )
    default:
      return (
        <rect
          x={pos.x - 50}
          y={pos.y - 20}
          width={100}
          height={40}
          rx={5}
          className="flow-node-shape"
        />
      )
  }
}

export default PolicyFlowDiagram

