// MemberModal - Modal dialog for displaying group/role members
import { useState, useMemo } from 'react'
import './MemberModal.css'

export interface Member {
  id: string
  displayName: string | null
  type: string
  fromGroup?: string
  depth?: number
}

export interface MemberModalProps {
  isOpen: boolean
  onClose: () => void
  entityId: string
  entityType: 'group' | 'role'
  entityName: string
  members: Member[]
  nestedMembers?: Member[]
  nestedGroups?: Array<{ id: string; displayName: string; depth: number }>
  totalMemberCount?: number
}

export function MemberModal({
  isOpen,
  onClose,
  entityType,
  entityName,
  members,
  nestedMembers = [],
  nestedGroups = [],
  totalMemberCount
}: MemberModalProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [showNested, setShowNested] = useState(false)
  const [filterType, setFilterType] = useState<string>('all')

  const displayedMembers = useMemo(() => {
    const allMembers = showNested ? [...members, ...nestedMembers] : members
    
    return allMembers.filter(member => {
      // Filter by search term
      const matchesSearch = !searchTerm || 
        (member.displayName?.toLowerCase().includes(searchTerm.toLowerCase()))
      
      // Filter by type
      const matchesType = filterType === 'all' || member.type === filterType
      
      return matchesSearch && matchesType
    })
  }, [members, nestedMembers, showNested, searchTerm, filterType])

  const memberTypeCounts = useMemo(() => {
    const allMembers = showNested ? [...members, ...nestedMembers] : members
    const counts: Record<string, number> = {}
    allMembers.forEach(m => {
      counts[m.type] = (counts[m.type] || 0) + 1
    })
    return counts
  }, [members, nestedMembers, showNested])

  const exportToCSV = () => {
    const headers = ['ID', 'Display Name', 'Type', 'Source Group', 'Nesting Depth']
    const rows = displayedMembers.map(m => [
      m.id,
      m.displayName || '',
      m.type,
      m.fromGroup || 'Direct',
      m.depth?.toString() || '0'
    ])
    
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${entityName.replace(/\s+/g, '_')}_members.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!isOpen) return null

  const typeIcon = (type: string) => {
    switch (type) {
      case 'user': return '👤'
      case 'group': return '👥'
      case 'servicePrincipal': return '🔧'
      case 'device': return '💻'
      default: return '❓'
    }
  }

  const hasNesting = nestedMembers.length > 0 || nestedGroups.length > 0

  return (
    <div className="member-modal__overlay" onClick={onClose}>
      <div className="member-modal" onClick={e => e.stopPropagation()}>
        <div className="member-modal__header">
          <div className="member-modal__title">
            <span className="member-modal__icon">
              {entityType === 'group' ? '👥' : '🛡️'}
            </span>
            <h2>{entityName}</h2>
            <span className="member-modal__type-badge">{entityType}</span>
          </div>
          <button className="member-modal__close" onClick={onClose}>×</button>
        </div>

        <div className="member-modal__stats">
          <div className="member-modal__stat">
            <span className="member-modal__stat-value">{members.length}</span>
            <span className="member-modal__stat-label">Direct Members</span>
          </div>
          {hasNesting && (
            <>
              <div className="member-modal__stat">
                <span className="member-modal__stat-value">{nestedMembers.length}</span>
                <span className="member-modal__stat-label">Nested Members</span>
              </div>
              <div className="member-modal__stat">
                <span className="member-modal__stat-value">{nestedGroups.length}</span>
                <span className="member-modal__stat-label">Nested Groups</span>
              </div>
              <div className="member-modal__stat member-modal__stat--total">
                <span className="member-modal__stat-value">{totalMemberCount || (members.length + nestedMembers.length)}</span>
                <span className="member-modal__stat-label">Total Unique</span>
              </div>
            </>
          )}
        </div>

        <div className="member-modal__controls">
          <div className="member-modal__search">
            <input
              type="text"
              placeholder="Search members..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="member-modal__filters">
            <select value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="all">All Types</option>
              {Object.entries(memberTypeCounts).map(([type, count]) => (
                <option key={type} value={type}>
                  {type} ({count})
                </option>
              ))}
            </select>
            
            {hasNesting && (
              <label className="member-modal__toggle">
                <input
                  type="checkbox"
                  checked={showNested}
                  onChange={e => setShowNested(e.target.checked)}
                />
                <span>Show nested members</span>
              </label>
            )}
          </div>
          
          <button className="member-modal__export" onClick={exportToCSV}>
            📥 Export CSV
          </button>
        </div>

        <div className="member-modal__list">
          {displayedMembers.length === 0 ? (
            <div className="member-modal__empty">
              {searchTerm ? 'No members match your search' : 'No members found'}
            </div>
          ) : (
            <table className="member-modal__table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Display Name</th>
                  {showNested && <th>Source</th>}
                </tr>
              </thead>
              <tbody>
                {displayedMembers.map((member, idx) => (
                  <tr key={`${member.id}-${idx}`} className={member.fromGroup ? 'member-modal__nested-row' : ''}>
                    <td>
                      <span className="member-modal__member-type" title={member.type}>
                        {typeIcon(member.type)}
                      </span>
                    </td>
                    <td>
                      <span className="member-modal__member-name">
                        {member.displayName || member.id}
                      </span>
                    </td>
                    {showNested && (
                      <td>
                        {member.fromGroup ? (
                          <span className="member-modal__source-group">
                            via {member.fromGroup}
                            {member.depth && member.depth > 1 && (
                              <span className="member-modal__depth"> (depth {member.depth})</span>
                            )}
                          </span>
                        ) : (
                          <span className="member-modal__direct">Direct</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {nestedGroups.length > 0 && (
          <div className="member-modal__nested-groups">
            <h3>Nested Groups</h3>
            <div className="member-modal__nested-group-list">
              {nestedGroups.map((group, idx) => (
                <span key={`${group.id}-${idx}`} className="member-modal__nested-group-pill">
                  👥 {group.displayName}
                  {group.depth > 1 && <span className="member-modal__depth">L{group.depth}</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

