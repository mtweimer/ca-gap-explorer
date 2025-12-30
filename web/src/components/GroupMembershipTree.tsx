// GroupMembershipTree - Expandable group hierarchy visualization
import { useState, useMemo } from 'react'
import type { GraphData, GraphNode } from '../types/graph'
import './GroupMembershipTree.css'

interface GroupMembershipTreeProps {
  graphData: GraphData
  initialExpandedGroups?: Set<string>
}

interface TreeNode {
  id: string
  name: string
  type: 'group' | 'role' | 'user' | 'servicePrincipal' | 'device'
  memberCount?: number
  children: TreeNode[]
  via?: string[]
  properties?: Record<string, unknown>
  policyCoverage: {
    includeCount: number
    excludeCount: number
    policies: string[]
  }
}

export function GroupMembershipTree({ graphData, initialExpandedGroups }: GroupMembershipTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    initialExpandedGroups || new Set()
  )
  const [searchTerm, setSearchTerm] = useState('')
  const [showType, setShowType] = useState<'all' | 'group' | 'role'>('all')

  const { tree } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>()
    graphData.nodes.forEach(n => nodeMap.set(n.id, n))

    // Build policy coverage map
    const policyMap = new Map<string, { includes: Set<string>; excludes: Set<string> }>()
    const policyNames = new Map<string, string>()
    
    graphData.nodes.filter(n => n.type === 'policy').forEach(p => {
      policyNames.set(p.id, p.label)
    })

    graphData.edges.forEach(edge => {
      const [scope] = edge.relationship.split(':')
      if (!policyMap.has(edge.to)) {
        policyMap.set(edge.to, { includes: new Set(), excludes: new Set() })
      }
      const coverage = policyMap.get(edge.to)!
      if (scope === 'include') {
        coverage.includes.add(edge.from)
      } else if (scope === 'exclude') {
        coverage.excludes.add(edge.from)
      }
    })

    // Build tree from groups and roles
    const treeNodes: TreeNode[] = []

    graphData.nodes
      .filter(n => n.type === 'group' || n.type === 'role')
      .forEach(node => {
        const props = node.properties as Record<string, unknown> || {}
        const membersRaw = props.members
        const members = Array.isArray(membersRaw) ? membersRaw as Array<Record<string, unknown>> : []
        const coverage = policyMap.get(node.id)

        const buildChildren = (memberList: Array<Record<string, unknown>>): TreeNode[] => {
          return memberList.map(member => {
            const memberCoverage = policyMap.get(member.id as string)
            return {
              id: member.id as string,
              name: member.displayName as string || member.id as string,
              type: member.type as TreeNode['type'] || 'user',
              via: member.via as string[],
              properties: member,
              children: [],
              policyCoverage: {
                includeCount: memberCoverage?.includes.size || 0,
                excludeCount: memberCoverage?.excludes.size || 0,
                policies: Array.from(memberCoverage?.includes || []).map(id => policyNames.get(id) || id)
              }
            }
          })
        }

        treeNodes.push({
          id: node.id,
          name: node.label,
          type: node.type as 'group' | 'role',
          memberCount: members.filter(m => m.type !== 'group').length,
          children: buildChildren(members),
          properties: props,
          policyCoverage: {
            includeCount: coverage?.includes.size || 0,
            excludeCount: coverage?.excludes.size || 0,
            policies: Array.from(coverage?.includes || []).map(id => policyNames.get(id) || id)
          }
        })
      })

    // Sort by member count descending
    treeNodes.sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0))

    return { tree: treeNodes, policyMap }
  }, [graphData])

  const filteredTree = useMemo(() => {
    let nodes = tree

    if (showType !== 'all') {
      nodes = nodes.filter(n => n.type === showType)
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      nodes = nodes.filter(n => 
        n.name.toLowerCase().includes(term) ||
        n.children.some(c => c.name.toLowerCase().includes(term))
      )
    }

    return nodes
  }, [tree, showType, searchTerm])

  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  const expandAll = () => {
    setExpandedNodes(new Set(tree.map(n => n.id)))
  }

  const collapseAll = () => {
    setExpandedNodes(new Set())
  }

  return (
    <div className="group-tree">
      <div className="group-tree__header">
        <div className="group-tree__title">
          <h2>Group & Role Membership</h2>
          <p>Explore nested group memberships and role assignments</p>
        </div>
      </div>

      <div className="group-tree__controls">
        <div className="group-tree__filters">
          <select value={showType} onChange={e => setShowType(e.target.value as typeof showType)}>
            <option value="all">All Types</option>
            <option value="group">Groups Only</option>
            <option value="role">Roles Only</option>
          </select>

          <input
            type="text"
            placeholder="Search groups or members..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="group-tree__actions">
          <button onClick={expandAll}>Expand All</button>
          <button onClick={collapseAll}>Collapse All</button>
        </div>
      </div>

      <div className="group-tree__content">
        {filteredTree.length === 0 ? (
          <div className="group-tree__empty">
            No groups or roles found
          </div>
        ) : (
          <div className="group-tree__list">
            {filteredTree.map(node => (
              <TreeNodeComponent
                key={node.id}
                node={node}
                isExpanded={expandedNodes.has(node.id)}
                onToggle={() => toggleNode(node.id)}
                depth={0}
              />
            ))}
          </div>
        )}
      </div>

      <div className="group-tree__footer">
        {tree.length} groups/roles, {tree.reduce((sum, n) => sum + n.children.length, 0)} total members
      </div>
    </div>
  )
}

interface TreeNodeComponentProps {
  node: TreeNode
  isExpanded: boolean
  onToggle: () => void
  depth: number
}

function TreeNodeComponent({ node, isExpanded, onToggle, depth }: TreeNodeComponentProps) {
  const hasChildren = node.children.length > 0
  const isContainer = node.type === 'group' || node.type === 'role'

  const typeIcons: Record<string, string> = {
    group: '👥',
    role: '🎛️',
    user: '👤',
    servicePrincipal: '🔑',
    device: '💻'
  }

  const coverageClass = 
    node.policyCoverage.excludeCount > 0 ? 'excluded' :
    node.policyCoverage.includeCount > 0 ? 'covered' : 'uncovered'

  return (
    <div className={`group-tree__node group-tree__node--depth-${Math.min(depth, 3)}`}>
      <div 
        className={`group-tree__node-header group-tree__node-header--${node.type} group-tree__node-header--${coverageClass}`}
        onClick={hasChildren ? onToggle : undefined}
      >
        {hasChildren && (
          <span className="group-tree__toggle">
            {isExpanded ? '▼' : '▶'}
          </span>
        )}
        
        <span className="group-tree__icon">{typeIcons[node.type] || '•'}</span>
        
        <span className="group-tree__name">{node.name}</span>
        
        {node.via && node.via.length > 0 && (
          <span className="group-tree__via">via {node.via.join(' → ')}</span>
        )}
        
        {isContainer && node.memberCount !== undefined && (
          <span className="group-tree__count">{node.memberCount} members</span>
        )}

        <span className="group-tree__coverage">
          {node.policyCoverage.includeCount > 0 && (
            <span className="group-tree__coverage-include" title={`Included in: ${node.policyCoverage.policies.join(', ')}`}>
              ✓ {node.policyCoverage.includeCount}
            </span>
          )}
          {node.policyCoverage.excludeCount > 0 && (
            <span className="group-tree__coverage-exclude">
              ✗ {node.policyCoverage.excludeCount}
            </span>
          )}
        </span>
      </div>

      {isExpanded && hasChildren && (
        <div className="group-tree__children">
          {node.children.map((child, idx) => (
            <TreeNodeComponent
              key={`${child.id}-${idx}`}
              node={child}
              isExpanded={false}
              onToggle={() => {}}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

