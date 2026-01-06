// GroupMembershipTree - Expandable group hierarchy visualization with member data
import { useState, useMemo, useEffect } from 'react'
import type { GraphData } from '../types/graph'
import { MemberModal, type Member } from './MemberModal'
import './GroupMembershipTree.css'

interface GroupMembershipTreeProps {
  graphData: GraphData
  initialExpandedGroups?: Set<string>
}

interface GroupEntity {
  id: string
  displayName: string
  mail?: string
  securityEnabled?: boolean
  groupTypes?: string[]
  members?: Member[]
  memberCount?: number
  nestedMembers?: Member[]
  nestedMemberCount?: number
  nestedGroups?: Array<{ id: string; displayName: string; depth: number }>
  totalMemberCount?: number
  hasNesting?: boolean
  type: string
}

interface RoleEntity {
  id: string
  roleId: string
  displayName: string
  description?: string
  members?: Member[]
  memberCount?: number
  type: string
}

export function GroupMembershipTree({ graphData }: GroupMembershipTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [showType, setShowType] = useState<'all' | 'group' | 'role'>('all')
  const [groupsData, setGroupsData] = useState<GroupEntity[]>([])
  const [rolesData, setRolesData] = useState<RoleEntity[]>([])
  const [loading, setLoading] = useState(true)
  
  // Modal state
  const [memberModalOpen, setMemberModalOpen] = useState(false)
  const [selectedEntity, setSelectedEntity] = useState<{
    id: string
    type: 'group' | 'role'
    name: string
    members: Member[]
    nestedMembers?: Member[]
    nestedGroups?: Array<{ id: string; displayName: string; depth: number }>
    totalMemberCount?: number
  } | null>(null)

  // Load groups and roles data
  useEffect(() => {
    Promise.all([
      fetch('/entities/groups.json', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
      fetch('/entities/roles.json', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : [])
        .catch(() => [])
    ]).then(([groups, roles]) => {
      setGroupsData(groups)
      setRolesData(roles)
      setLoading(false)
    })
  }, [])

  // Build policy coverage map
  const policyMap = useMemo(() => {
    const map = new Map<string, { includes: Set<string>; excludes: Set<string> }>()
    const policyNames = new Map<string, string>()
    
    graphData.nodes.filter(n => n.type === 'policy').forEach(p => {
      policyNames.set(p.id, p.label)
    })

    graphData.edges.forEach(edge => {
      const [scope] = edge.relationship.split(':')
      if (!map.has(edge.to)) {
        map.set(edge.to, { includes: new Set(), excludes: new Set() })
      }
      const coverage = map.get(edge.to)!
      if (scope === 'include') {
        coverage.includes.add(edge.from)
      } else if (scope === 'exclude') {
        coverage.excludes.add(edge.from)
      }
    })

    return { map, policyNames }
  }, [graphData])

  // Filter and prepare data
  const filteredData = useMemo(() => {
    const term = searchTerm.toLowerCase()
    
    const filterFn = (item: GroupEntity | RoleEntity) => {
      if (term && !item.displayName.toLowerCase().includes(term)) {
        // Also search in members
        const members = item.members || []
        if (!members.some(m => m.displayName?.toLowerCase().includes(term))) {
          return false
        }
      }
      return true
    }

    let groups = showType === 'role' ? [] : groupsData.filter(filterFn)
    let roles = showType === 'group' ? [] : rolesData.filter(filterFn)

    // Sort by member count
    groups = groups.sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0))
    roles = roles.sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0))

    return { groups, roles }
  }, [groupsData, rolesData, showType, searchTerm])

  const openMemberModal = (entity: GroupEntity | RoleEntity, type: 'group' | 'role') => {
    setSelectedEntity({
      id: entity.id,
      type,
      name: entity.displayName,
      members: entity.members || [],
      nestedMembers: (entity as GroupEntity).nestedMembers || [],
      nestedGroups: (entity as GroupEntity).nestedGroups || [],
      totalMemberCount: (entity as GroupEntity).totalMemberCount
    })
    setMemberModalOpen(true)
  }

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
    const allIds = [...groupsData.map(g => g.id), ...rolesData.map(r => r.id)]
    setExpandedNodes(new Set(allIds))
  }

  const collapseAll = () => {
    setExpandedNodes(new Set())
  }

  const getCoverage = (entityId: string) => {
    const coverage = policyMap.map.get(entityId)
    return {
      includeCount: coverage?.includes.size || 0,
      excludeCount: coverage?.excludes.size || 0,
      policies: Array.from(coverage?.includes || []).map(id => policyMap.policyNames.get(id) || id)
    }
  }

  if (loading) {
    return (
      <div className="group-tree">
        <div className="group-tree__loading">Loading groups and roles...</div>
      </div>
    )
  }

  const totalGroups = filteredData.groups.length
  const totalRoles = filteredData.roles.length
  const totalMembers = 
    filteredData.groups.reduce((sum, g) => sum + (g.memberCount || 0), 0) +
    filteredData.roles.reduce((sum, r) => sum + (r.memberCount || 0), 0)

  return (
    <div className="group-tree">
      <div className="group-tree__header">
        <div className="group-tree__title">
          <h2>Group & Role Membership</h2>
          <p>Explore group and role memberships with member details</p>
        </div>
        <div className="group-tree__stats">
          <span className="group-tree__stat">{totalGroups} groups</span>
          <span className="group-tree__stat">{totalRoles} roles</span>
          <span className="group-tree__stat">{totalMembers} total members</span>
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
            placeholder="Search groups, roles, or members..."
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
        {totalGroups === 0 && totalRoles === 0 ? (
          <div className="group-tree__empty">
            {groupsData.length === 0 && rolesData.length === 0 
              ? 'No groups or roles data available. Run Get-DirectoryObjects to collect member data.'
              : 'No groups or roles match your search.'
            }
          </div>
        ) : (
          <div className="group-tree__list">
            {/* Groups Section */}
            {filteredData.groups.length > 0 && (
              <div className="group-tree__section">
                <h3 className="group-tree__section-title">👥 Groups ({filteredData.groups.length})</h3>
                {filteredData.groups.map(group => (
                  <GroupNode
                    key={group.id}
                    entity={group}
                    type="group"
                    isExpanded={expandedNodes.has(group.id)}
                    onToggle={() => toggleNode(group.id)}
                    onViewMembers={() => openMemberModal(group, 'group')}
                    coverage={getCoverage(group.id)}
                  />
                ))}
              </div>
            )}

            {/* Roles Section */}
            {filteredData.roles.length > 0 && (
              <div className="group-tree__section">
                <h3 className="group-tree__section-title">🛡️ Roles ({filteredData.roles.length})</h3>
                {filteredData.roles.map(role => (
                  <GroupNode
                    key={role.id}
                    entity={role}
                    type="role"
                    isExpanded={expandedNodes.has(role.id)}
                    onToggle={() => toggleNode(role.id)}
                    onViewMembers={() => openMemberModal(role, 'role')}
                    coverage={getCoverage(role.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Member Modal */}
      {selectedEntity && (
        <MemberModal
          isOpen={memberModalOpen}
          onClose={() => setMemberModalOpen(false)}
          entityId={selectedEntity.id}
          entityType={selectedEntity.type}
          entityName={selectedEntity.name}
          members={selectedEntity.members}
          nestedMembers={selectedEntity.nestedMembers}
          nestedGroups={selectedEntity.nestedGroups}
          totalMemberCount={selectedEntity.totalMemberCount}
        />
      )}
    </div>
  )
}

// Group/Role Node Component
function GroupNode({
  entity,
  type,
  isExpanded,
  onToggle,
  onViewMembers,
  coverage
}: {
  entity: GroupEntity | RoleEntity
  type: 'group' | 'role'
  isExpanded: boolean
  onToggle: () => void
  onViewMembers: () => void
  coverage: { includeCount: number; excludeCount: number; policies: string[] }
}) {
  const members = entity.members || []
  const memberCount = entity.memberCount || members.length
  const hasNesting = (entity as GroupEntity).hasNesting
  const nestedCount = (entity as GroupEntity).nestedMemberCount || 0
  
  const coverageClass = 
    coverage.excludeCount > 0 ? 'excluded' :
    coverage.includeCount > 0 ? 'covered' : 'uncovered'

  const typeIcon = type === 'group' ? '👥' : '🛡️'

  return (
    <div className="group-tree__node">
      <div 
        className={`group-tree__node-header group-tree__node-header--${type} group-tree__node-header--${coverageClass}`}
        onClick={onToggle}
      >
        <span className="group-tree__toggle">
          {members.length > 0 ? (isExpanded ? '▼' : '▶') : ' '}
        </span>
        
        <span className="group-tree__icon">{typeIcon}</span>
        
        <span className="group-tree__name">{entity.displayName}</span>
        
        <div className="group-tree__badges">
          <span className="group-tree__count">{memberCount} members</span>
          {hasNesting && nestedCount > 0 && (
            <span className="group-tree__nested-count">+{nestedCount} nested</span>
          )}
        </div>

        <div className="group-tree__coverage">
          {coverage.includeCount > 0 && (
            <span className="group-tree__coverage-include" title={`Included in: ${coverage.policies.join(', ')}`}>
              ✓ {coverage.includeCount}
            </span>
          )}
          {coverage.excludeCount > 0 && (
            <span className="group-tree__coverage-exclude">
              ✗ {coverage.excludeCount}
            </span>
          )}
        </div>

        <button 
          className="group-tree__view-btn"
          onClick={(e) => { e.stopPropagation(); onViewMembers(); }}
        >
          View Members
        </button>
      </div>

      {isExpanded && members.length > 0 && (
        <div className="group-tree__children">
          {members.slice(0, 20).map((member, idx) => (
            <div key={`${member.id}-${idx}`} className="group-tree__member">
              <span className="group-tree__member-icon">
                {member.type === 'user' ? '👤' : 
                 member.type === 'group' ? '👥' : 
                 member.type === 'servicePrincipal' ? '🔧' : 
                 member.type === 'device' ? '💻' : '•'}
              </span>
              <span className="group-tree__member-name">
                {member.displayName || member.id}
              </span>
              <span className="group-tree__member-type">{member.type}</span>
            </div>
          ))}
          {members.length > 20 && (
            <div className="group-tree__more">
              ... and {members.length - 20} more members. 
              <button onClick={(e) => { e.stopPropagation(); onViewMembers(); }}>
                View all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
