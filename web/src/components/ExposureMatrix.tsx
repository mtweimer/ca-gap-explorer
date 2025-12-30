import { useMemo, useState } from 'react'
import type { GraphData, GraphNode } from '../types/graph'
import './ExposureMatrix.css'

interface ExposureMatrixProps {
  graphData: GraphData
  selectedPolicyIds?: Set<string>
}

interface ExposureItem {
  id: string
  name: string
  type: string
  coverageCount: number
  exclusionCount: number
  policies: string[]
  excludedFrom: string[]
  status: 'covered' | 'partial' | 'excluded' | 'uncovered'
  riskScore: number
}

type ViewMode = 'all' | 'uncovered' | 'excluded' | 'partial'
type EntityFilter = 'all' | 'user' | 'group' | 'servicePrincipal' | 'role'

export function ExposureMatrix({ graphData }: ExposureMatrixProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('uncovered')
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all')
  const [sortBy, setSortBy] = useState<'name' | 'risk' | 'coverage'>('risk')
  const [searchTerm, setSearchTerm] = useState('')

  const exposures = useMemo((): ExposureItem[] => {
    const nodeMap = new Map<string, GraphNode>()
    graphData.nodes.forEach(n => nodeMap.set(n.id, n))

    // Track coverage per entity
    const entityCoverage = new Map<string, {
      policies: Set<string>
      excludedFrom: Set<string>
    }>()

    // Get policy names for display
    const policyNames = new Map<string, string>()
    graphData.nodes.filter(n => n.type === 'policy').forEach(p => {
      policyNames.set(p.id, p.label)
    })

    // Analyze edges
    graphData.edges.forEach(edge => {
      const [scope] = edge.relationship.split(':')
      const targetNode = nodeMap.get(edge.to)
      
      if (!targetNode || targetNode.type === 'policy' || targetNode.type === 'keyword') {
        return
      }

      if (!entityCoverage.has(edge.to)) {
        entityCoverage.set(edge.to, {
          policies: new Set(),
          excludedFrom: new Set()
        })
      }

      const coverage = entityCoverage.get(edge.to)!
      if (scope === 'include') {
        coverage.policies.add(edge.from)
      } else if (scope === 'exclude') {
        coverage.excludedFrom.add(edge.from)
      }
    })

    // Build exposure items
    const items: ExposureItem[] = []
    const totalPolicies = graphData.nodes.filter(n => n.type === 'policy').length

    graphData.nodes.forEach(node => {
      if (node.type === 'policy' || node.type === 'keyword') return

      const coverage = entityCoverage.get(node.id)
      const coverageCount = coverage?.policies.size || 0
      const exclusionCount = coverage?.excludedFrom.size || 0

      let status: ExposureItem['status'] = 'uncovered'
      if (coverageCount > 0 && exclusionCount === 0) {
        status = 'covered'
      } else if (coverageCount > 0 && exclusionCount > 0) {
        status = exclusionCount >= coverageCount ? 'excluded' : 'partial'
      } else if (exclusionCount > 0) {
        status = 'excluded'
      }

      // Calculate risk score (0-100)
      let riskScore = 0
      if (status === 'uncovered') {
        riskScore = 100
      } else if (status === 'excluded') {
        riskScore = 80 + (exclusionCount / Math.max(totalPolicies, 1)) * 20
      } else if (status === 'partial') {
        riskScore = 40 + (exclusionCount / coverageCount) * 40
      } else {
        riskScore = Math.max(0, 20 - (coverageCount / Math.max(totalPolicies, 1)) * 20)
      }

      items.push({
        id: node.id,
        name: node.label,
        type: node.type,
        coverageCount,
        exclusionCount,
        policies: Array.from(coverage?.policies || []).map(id => policyNames.get(id) || id),
        excludedFrom: Array.from(coverage?.excludedFrom || []).map(id => policyNames.get(id) || id),
        status,
        riskScore: Math.round(riskScore)
      })
    })

    return items
  }, [graphData])

  const filteredExposures = useMemo(() => {
    let items = exposures

    // Filter by view mode
    if (viewMode !== 'all') {
      items = items.filter(item => item.status === viewMode)
    }

    // Filter by entity type
    if (entityFilter !== 'all') {
      items = items.filter(item => item.type === entityFilter)
    }

    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      items = items.filter(item => 
        item.name.toLowerCase().includes(term) ||
        item.type.toLowerCase().includes(term)
      )
    }

    // Sort
    items.sort((a, b) => {
      switch (sortBy) {
        case 'risk':
          return b.riskScore - a.riskScore
        case 'coverage':
          return a.coverageCount - b.coverageCount
        case 'name':
        default:
          return a.name.localeCompare(b.name)
      }
    })

    return items
  }, [exposures, viewMode, entityFilter, searchTerm, sortBy])

  const stats = useMemo(() => {
    return {
      total: exposures.length,
      covered: exposures.filter(e => e.status === 'covered').length,
      partial: exposures.filter(e => e.status === 'partial').length,
      excluded: exposures.filter(e => e.status === 'excluded').length,
      uncovered: exposures.filter(e => e.status === 'uncovered').length
    }
  }, [exposures])

  const typeIcons: Record<string, string> = {
    user: '👤',
    group: '👥',
    role: '🎛️',
    servicePrincipal: '🔑',
    namedLocation: '📍',
    device: '💻'
  }

  return (
    <div className="exposure-matrix">
      <div className="exposure-matrix__header">
        <div className="exposure-matrix__title">
          <h2>Exposure Matrix</h2>
          <p>Identify entities not covered or excluded from Conditional Access policies</p>
        </div>

        <div className="exposure-matrix__stats">
          <div className="exposure-matrix__stat exposure-matrix__stat--covered">
            <span className="exposure-matrix__stat-value">{stats.covered}</span>
            <span className="exposure-matrix__stat-label">Covered</span>
          </div>
          <div className="exposure-matrix__stat exposure-matrix__stat--partial">
            <span className="exposure-matrix__stat-value">{stats.partial}</span>
            <span className="exposure-matrix__stat-label">Partial</span>
          </div>
          <div className="exposure-matrix__stat exposure-matrix__stat--excluded">
            <span className="exposure-matrix__stat-value">{stats.excluded}</span>
            <span className="exposure-matrix__stat-label">Excluded</span>
          </div>
          <div className="exposure-matrix__stat exposure-matrix__stat--uncovered">
            <span className="exposure-matrix__stat-value">{stats.uncovered}</span>
            <span className="exposure-matrix__stat-label">Uncovered</span>
          </div>
        </div>
      </div>

      <div className="exposure-matrix__controls">
        <div className="exposure-matrix__filters">
          <div className="exposure-matrix__filter-group">
            <label>Status:</label>
            <select value={viewMode} onChange={e => setViewMode(e.target.value as ViewMode)}>
              <option value="all">All</option>
              <option value="uncovered">Uncovered Only</option>
              <option value="excluded">Excluded Only</option>
              <option value="partial">Partial Coverage</option>
            </select>
          </div>

          <div className="exposure-matrix__filter-group">
            <label>Type:</label>
            <select value={entityFilter} onChange={e => setEntityFilter(e.target.value as EntityFilter)}>
              <option value="all">All Types</option>
              <option value="user">Users</option>
              <option value="group">Groups</option>
              <option value="servicePrincipal">Applications</option>
              <option value="role">Roles</option>
            </select>
          </div>

          <div className="exposure-matrix__filter-group">
            <label>Sort:</label>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
              <option value="risk">Risk Score</option>
              <option value="coverage">Coverage</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        <div className="exposure-matrix__search">
          <input
            type="text"
            placeholder="Search entities..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="exposure-matrix__table-container">
        <table className="exposure-matrix__table">
          <thead>
            <tr>
              <th>Entity</th>
              <th>Type</th>
              <th>Status</th>
              <th>Risk</th>
              <th>Coverage</th>
              <th>Exclusions</th>
            </tr>
          </thead>
          <tbody>
            {filteredExposures.length === 0 ? (
              <tr>
                <td colSpan={6} className="exposure-matrix__empty">
                  No entities match the current filters
                </td>
              </tr>
            ) : (
              filteredExposures.map(item => (
                <tr key={item.id} className={`exposure-matrix__row exposure-matrix__row--${item.status}`}>
                  <td className="exposure-matrix__name">
                    <span className="exposure-matrix__icon">{typeIcons[item.type] || '•'}</span>
                    {item.name}
                  </td>
                  <td className="exposure-matrix__type">{item.type}</td>
                  <td className="exposure-matrix__status">
                    <span className={`exposure-matrix__badge exposure-matrix__badge--${item.status}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="exposure-matrix__risk">
                    <div className="exposure-matrix__risk-bar">
                      <div 
                        className="exposure-matrix__risk-fill"
                        style={{ 
                          width: `${item.riskScore}%`,
                          backgroundColor: getRiskColor(item.riskScore)
                        }}
                      />
                    </div>
                    <span className="exposure-matrix__risk-value">{item.riskScore}</span>
                  </td>
                  <td className="exposure-matrix__coverage">
                    {item.coverageCount > 0 ? (
                      <span title={item.policies.join(', ')}>
                        {item.coverageCount} {item.coverageCount === 1 ? 'policy' : 'policies'}
                      </span>
                    ) : (
                      <span className="exposure-matrix__none">None</span>
                    )}
                  </td>
                  <td className="exposure-matrix__exclusions">
                    {item.exclusionCount > 0 ? (
                      <span title={item.excludedFrom.join(', ')} className="exposure-matrix__excluded-text">
                        {item.exclusionCount} {item.exclusionCount === 1 ? 'policy' : 'policies'}
                      </span>
                    ) : (
                      <span className="exposure-matrix__none">None</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="exposure-matrix__footer">
        Showing {filteredExposures.length} of {exposures.length} entities
      </div>
    </div>
  )
}

function getRiskColor(score: number): string {
  if (score >= 80) return '#ff4757'
  if (score >= 60) return '#ff6b81'
  if (score >= 40) return '#ffa502'
  if (score >= 20) return '#ffdd57'
  return '#2ed573'
}

