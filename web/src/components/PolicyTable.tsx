// PolicyTable - Expandable policy table with full details
import { useState, useMemo, useEffect } from 'react'
import type { GraphData } from '../types/graph'
import { MemberModal, type Member } from './MemberModal'
import './PolicyTable.css'

interface PolicyTableProps {
  graphData: GraphData
  policies: Array<{ id: string; label: string; stateKey: string; stateLabel: string }>
  selectedPolicyIds: Set<string>
  onShowDetails: (policyId: string) => void
}

interface EntityCounts {
  user: number
  group: number
  serviceprincipal: number
  application: number
  role: number
}

interface PolicyFullDetails {
  // Assignments
  includeUsers: Array<{ id: string; name: string; type?: string }>
  excludeUsers: Array<{ id: string; name: string; type?: string }>
  includeGroups: Array<{ id: string; name: string }>
  excludeGroups: Array<{ id: string; name: string }>
  includeRoles: Array<{ id: string; name: string }>
  excludeRoles: Array<{ id: string; name: string }>
  includeKeywords: string[]
  excludeKeywords: string[]
  
  // Target Resources
  targetApps: {
    includeKeywords: string[]
    includeEntities: Array<{ id: string; name: string }>
    excludeKeywords: string[]
    excludeEntities: Array<{ id: string; name: string }>
  }
  userActions: string[]
  authContext: string[]
  
  // Conditions
  userRiskLevels: string[]
  signInRiskLevels: string[]
  insiderRiskLevels: string[]
  platforms: string[]
  clientAppTypes: string[]
  locations: {
    includeKeywords: string[]
    includeEntities: string[]
    excludeKeywords: string[]
    excludeEntities: string[]
  }
  deviceFilter: { mode: string | null; rule: string | null } | null
  authFlows: string[]
  
  // Grant Controls
  grantControls: string[]
  grantOperator: string
  authStrength: { id: string | null; name: string | null } | null
  termsOfUse: string[]
  
  // Session Controls
  signInFrequency: { value: number | null; type: string | null; enabled: boolean } | null
  persistentBrowser: { mode: string | null; enabled: boolean } | null
  cae: { mode: string | null; enabled: boolean } | null
  tokenProtection: { enabled: boolean } | null
  cloudAppSecurity: { type: string | null; enabled: boolean } | null
  appEnforced: { enabled: boolean } | null
}

export function PolicyTable({ graphData, policies, selectedPolicyIds, onShowDetails }: PolicyTableProps) {
  const [expandedPolicies, setExpandedPolicies] = useState<Set<string>>(new Set())
  const [sortColumn, setSortColumn] = useState<'name' | 'state' | 'grants'>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [counts, setCounts] = useState<EntityCounts | null>(null)
  const [groupsData, setGroupsData] = useState<any[]>([])
  const [rolesData, setRolesData] = useState<any[]>([])
  
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

  // Load counts and groups data
  useEffect(() => {
    fetch('/entities/counts.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => setCounts(c))
      .catch(() => setCounts(null))
    
    fetch('/entities/groups.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((g) => setGroupsData(g))
      .catch(() => setGroupsData([]))
    
    fetch('/entities/roles.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((r) => setRolesData(r))
      .catch(() => setRolesData([]))
  }, [])

  // Handle opening member modal
  const openMemberModal = (entityId: string, entityType: 'group' | 'role', entityName: string) => {
    const source = entityType === 'group' ? groupsData : rolesData
    const entity = source.find((e: any) => e.id === entityId)
    
    if (entity) {
      setSelectedEntity({
        id: entityId,
        type: entityType,
        name: entityName || entity.displayName,
        members: entity.members || [],
        nestedMembers: entity.nestedMembers || [],
        nestedGroups: entity.nestedGroups || [],
        totalMemberCount: entity.totalMemberCount
      })
      setMemberModalOpen(true)
    }
  }

  const toggleExpand = (policyId: string) => {
    const next = new Set(expandedPolicies)
    if (next.has(policyId)) {
      next.delete(policyId)
    } else {
      next.add(policyId)
    }
    setExpandedPolicies(next)
  }

  const handleSort = (column: 'name' | 'state' | 'grants') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const sortedPolicies = useMemo(() => {
    return [...policies].sort((a, b) => {
      let comparison = 0
      if (sortColumn === 'name') {
        comparison = a.label.localeCompare(b.label)
      } else if (sortColumn === 'state') {
        comparison = a.stateLabel.localeCompare(b.stateLabel)
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [policies, sortColumn, sortDirection])

  // Extract full details for a policy
  const getPolicyDetails = (policyId: string): PolicyFullDetails | null => {
    const node = graphData.nodes.find(n => n.id === policyId && n.type === 'policy')
    if (!node) return null

    const props = node.properties as Record<string, unknown> || {}
    const assignments = props.assignments as Record<string, unknown> || {}
    const include = assignments.include as Record<string, unknown> || {}
    const exclude = assignments.exclude as Record<string, unknown> || {}
    const targetResources = props.targetResources as Record<string, unknown> || {}
    const applications = targetResources.applications as Record<string, unknown> || {}
    const conditions = props.conditions as Record<string, unknown> || {}
    const accessControls = props.accessControls as Record<string, unknown> || {}
    const grant = accessControls.grant as Record<string, unknown> || {}
    const session = accessControls.session as Record<string, unknown> || {}

    // Helper to extract entities
    const getEntities = (obj: unknown): Array<{ id: string; name: string; type?: string }> => {
      if (!obj || !Array.isArray(obj)) return []
      return obj.map((e: Record<string, unknown>) => ({
        id: e.id as string || '',
        name: e.displayName as string || e.id as string || '',
        type: e.type as string || ''
      }))
    }

    const getKeywords = (obj: unknown): string[] => {
      if (!obj) return []
      const kws = (obj as Record<string, unknown>)?.keywords
      return Array.isArray(kws) ? kws : []
    }

    const includeUsers = include.users as Record<string, unknown> || {}
    const excludeUsers = exclude.users as Record<string, unknown> || {}
    const includeGroups = include.groups as Record<string, unknown> || {}
    const excludeGroups = exclude.groups as Record<string, unknown> || {}
    const includeRoles = include.roles as Record<string, unknown> || {}
    const excludeRoles = exclude.roles as Record<string, unknown> || {}

    const appInclude = applications.include as Record<string, unknown> || {}
    const appExclude = applications.exclude as Record<string, unknown> || {}
    const locs = conditions.locations as Record<string, unknown> || {}
    const locInclude = locs.include as Record<string, unknown> || {}
    const locExclude = locs.exclude as Record<string, unknown> || {}

    const deviceFilter = conditions.deviceFilter as Record<string, unknown> | undefined
    const authFlows = conditions.authenticationFlows as Record<string, unknown> | undefined
    const insiderRisk = conditions.insiderRiskLevels as Record<string, unknown> | unknown[] | undefined

    const signInFreq = session.signInFrequency as Record<string, unknown> | undefined
    const persistBrowser = session.persistentBrowser as Record<string, unknown> | undefined
    const caeSession = session.continuousAccessEvaluation as Record<string, unknown> | undefined
    const tokenProt = session.tokenProtection as Record<string, unknown> | undefined
    const casSession = session.cloudAppSecurity as Record<string, unknown> | undefined
    const appEnforced = session.applicationEnforcedRestrictions as Record<string, unknown> | undefined

    return {
      includeUsers: getEntities(includeUsers.entities),
      excludeUsers: getEntities(excludeUsers.entities),
      includeGroups: getEntities(includeGroups.entities),
      excludeGroups: getEntities(excludeGroups.entities),
      includeRoles: getEntities(includeRoles.entities),
      excludeRoles: getEntities(excludeRoles.entities),
      includeKeywords: getKeywords(includeUsers),
      excludeKeywords: getKeywords(excludeUsers),
      
      targetApps: {
        includeKeywords: getKeywords(appInclude),
        includeEntities: getEntities(appInclude.entities),
        excludeKeywords: getKeywords(appExclude),
        excludeEntities: getEntities(appExclude.entities)
      },
      userActions: Array.isArray(applications.includeUserActions) ? applications.includeUserActions : [],
      authContext: Array.isArray(applications.includeAuthenticationContextClassReferences) 
        ? applications.includeAuthenticationContextClassReferences : [],
      
      userRiskLevels: Array.isArray(conditions.userRiskLevels) ? conditions.userRiskLevels : [],
      signInRiskLevels: Array.isArray(conditions.signInRiskLevels) ? conditions.signInRiskLevels : [],
      insiderRiskLevels: (() => {
        if (Array.isArray(insiderRisk)) return insiderRisk as string[]
        const ir = insiderRisk as Record<string, unknown> | undefined
        if (ir?.levels && Array.isArray(ir.levels)) return ir.levels as string[]
        return []
      })(),
      platforms: (() => {
        const plat = conditions.platforms as Record<string, unknown> | undefined
        if (plat?.include && Array.isArray(plat.include)) return plat.include
        return []
      })(),
      clientAppTypes: (() => {
        const cat = conditions.clientAppTypes
        if (Array.isArray(cat)) return cat
        if (typeof cat === 'string' && cat !== 'all') return [cat]
        return []
      })(),
      locations: {
        includeKeywords: Array.isArray(locInclude.keywords) ? locInclude.keywords : [],
        includeEntities: Array.isArray(locInclude.entities) 
          ? (locInclude.entities as Array<{displayName?: string}>).map(e => e.displayName || '') 
          : [],
        excludeKeywords: Array.isArray(locExclude.keywords) ? locExclude.keywords : [],
        excludeEntities: Array.isArray(locExclude.entities) 
          ? (locExclude.entities as Array<{displayName?: string}>).map(e => e.displayName || '') 
          : []
      },
      deviceFilter: deviceFilter?.configured ? {
        mode: deviceFilter.mode as string | null,
        rule: deviceFilter.rule as string | null
      } : null,
      authFlows: authFlows?.configured 
        ? (Array.isArray(authFlows.transferMethods) ? authFlows.transferMethods : [])
        : [],
      
      grantControls: Array.isArray(props.grantControls) ? props.grantControls as string[] : [],
      grantOperator: (grant.operator as string) || 'OR',
      authStrength: grant.authenticationStrength ? {
        id: (grant.authenticationStrength as Record<string, unknown>).id as string | null,
        name: (grant.authenticationStrength as Record<string, unknown>).displayName as string | null
      } : null,
      termsOfUse: Array.isArray(grant.termsOfUse) ? grant.termsOfUse : [],
      
      signInFrequency: signInFreq ? {
        value: signInFreq.value as number | null,
        type: signInFreq.type as string | null,
        enabled: !!signInFreq.isEnabled
      } : null,
      persistentBrowser: persistBrowser ? {
        mode: persistBrowser.mode as string | null,
        enabled: !!persistBrowser.isEnabled
      } : null,
      cae: caeSession ? {
        mode: caeSession.mode as string | null,
        enabled: !!caeSession.isEnabled
      } : null,
      tokenProtection: tokenProt ? {
        enabled: !!tokenProt.enabled
      } : null,
      cloudAppSecurity: casSession ? {
        type: casSession.cloudAppSecurityType as string | null,
        enabled: !!casSession.isEnabled
      } : null,
      appEnforced: appEnforced ? {
        enabled: !!appEnforced.isEnabled
      } : null
    }
  }

  return (
    <div className="policy-table-container">
      <table className="policy-table">
        <thead>
          <tr>
            <th style={{ width: '30px' }}></th>
            <th onClick={() => handleSort('name')} className="sortable">
              Policy Name {sortColumn === 'name' && (sortDirection === 'asc' ? '▲' : '▼')}
            </th>
            <th onClick={() => handleSort('state')} className="sortable">
              State {sortColumn === 'state' && (sortDirection === 'asc' ? '▲' : '▼')}
            </th>
            <th>Grant Controls</th>
            <th>Operator</th>
            <th>Assignments</th>
            <th>Conditions</th>
            <th>Session</th>
          </tr>
        </thead>
        <tbody>
          {sortedPolicies.map((p) => {
            const isExpanded = expandedPolicies.has(p.id)
            const node = graphData.nodes.find(n => n.id === p.id)
            const edges = graphData.edges.filter(e => e.from === p.id)
            const includes = edges.filter(e => e.relationship.startsWith('include'))
            const excludes = edges.filter(e => e.relationship.startsWith('exclude'))
            const grants = Array.isArray(node?.properties?.grantControls)
              ? (node?.properties?.grantControls as string[])
              : []
            const accessControls = node?.properties?.accessControls as Record<string, unknown> || {}
            const grant = accessControls.grant as Record<string, unknown> || {}
            const session = accessControls.session as Record<string, unknown> || {}
            const operator = (grant.operator as string) || 'OR'
            
            // Count session controls configured
            const sessionCount = [
              session.signInFrequency,
              session.persistentBrowser,
              session.continuousAccessEvaluation,
              session.tokenProtection,
              session.cloudAppSecurity
            ].filter(s => s && (s as Record<string, unknown>).isEnabled).length

            // Count conditions configured
            const conditions = node?.properties?.conditions as Record<string, unknown> || {}
            const conditionCount = [
              conditions.userRiskLevels,
              conditions.signInRiskLevels,
              conditions.platforms,
              conditions.locations,
              conditions.clientAppTypes !== 'all' ? conditions.clientAppTypes : null,
              (conditions.deviceFilter as Record<string, unknown>)?.configured,
              (conditions.authenticationFlows as Record<string, unknown>)?.configured,
              (conditions.insiderRiskLevels as Record<string, unknown>)?.configured
            ].filter(Boolean).length

            return (
              <>
                <tr 
                  key={p.id} 
                  className={`${selectedPolicyIds.has(p.id) ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}
                >
                  <td className="expand-cell" onClick={() => toggleExpand(p.id)}>
                    <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                  </td>
                  <td 
                    onClick={() => onShowDetails(p.id)}
                    className="policy-name-cell"
                    title="Click for full modal"
                  >
                    {p.label}
                  </td>
                  <td>
                    <span className={`badge badge--${p.stateKey}`}>{p.stateLabel}</span>
                  </td>
                  <td>
                    <div className="grant-badges">
                      {grants.map((g, i) => (
                        <span key={i} className="grant-badge">{formatGrant(g)}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className={`operator-badge operator-badge--${operator.toLowerCase()}`}>
                      {operator === 'AND' ? 'ALL' : 'ONE'}
                    </span>
                  </td>
                  <td>
                    <span className="count-badge count-badge--include">{includes.length} inc</span>
                    {excludes.length > 0 && (
                      <span className="count-badge count-badge--exclude">{excludes.length} exc</span>
                    )}
                  </td>
                  <td>
                    {conditionCount > 0 ? (
                      <span className="count-badge count-badge--condition">{conditionCount} configured</span>
                    ) : (
                      <span className="count-badge count-badge--none">None</span>
                    )}
                  </td>
                  <td>
                    {sessionCount > 0 ? (
                      <span className="count-badge count-badge--session">{sessionCount} active</span>
                    ) : (
                      <span className="count-badge count-badge--none">None</span>
                    )}
                  </td>
                </tr>
                {isExpanded && (
                  <tr key={`${p.id}-details`} className="details-row">
                    <td colSpan={8}>
                      <PolicyExpandedDetails 
                        details={getPolicyDetails(p.id)}
                        counts={counts}
                        onGroupClick={(id, name) => openMemberModal(id, 'group', name)}
                        onRoleClick={(id, name) => openMemberModal(id, 'role', name)}
                      />
                    </td>
                  </tr>
                )}
              </>
            )
          })}
        </tbody>
      </table>
      
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

// Expanded details component
function PolicyExpandedDetails({ 
  details,
  counts,
  onGroupClick,
  onRoleClick
}: { 
  details: PolicyFullDetails | null
  counts: EntityCounts | null
  onGroupClick?: (id: string, name: string) => void
  onRoleClick?: (id: string, name: string) => void
}) {
  if (!details) {
    return <div className="expanded-details__empty">Unable to load policy details</div>
  }

  return (
    <div className="expanded-details">
      <div className="expanded-details__grid">
        {/* Assignments Section */}
        <div className="expanded-details__section">
          <h4>
            Assignments
            {counts && (
              <span className="section-percentage">
                {details.includeKeywords.some(kw => kw.toLowerCase() === 'all' || kw.toLowerCase() === 'allusers')
                  ? `(All ${counts.user} users)`
                  : `(${details.includeUsers.length + details.includeGroups.length + details.includeRoles.length} entities)`
                }
              </span>
            )}
          </h4>
          <div className="expanded-details__subsection">
            <span className="expanded-details__label">Include:</span>
            <div className="expanded-details__items">
              {details.includeKeywords.map((kw, i) => (
                <span key={`ikw-${i}`} className="detail-chip detail-chip--keyword">
                  ✓ {kw}
                  {kw.toLowerCase() === 'all' || kw.toLowerCase() === 'allusers' ? ` (${counts?.users ?? counts?.user ?? '?'} users)` : ''}
                </span>
              ))}
              {details.includeUsers.map((u, i) => (
                <span key={`iu-${i}`} className="detail-chip detail-chip--user">👤 {u.name}</span>
              ))}
              {details.includeGroups.map((g, i) => (
                <span 
                  key={`ig-${i}`} 
                  className="detail-chip detail-chip--group clickable"
                  onClick={() => onGroupClick?.(g.id, g.name)}
                  title="Click to view members"
                >
                  👥 {g.name}
                </span>
              ))}
              {details.includeRoles.map((r, i) => (
                <span 
                  key={`ir-${i}`} 
                  className="detail-chip detail-chip--role clickable"
                  onClick={() => onRoleClick?.(r.id, r.name)}
                  title="Click to view members"
                >
                  🛡️ {r.name}
                </span>
              ))}
              {details.includeKeywords.length === 0 && details.includeUsers.length === 0 && 
               details.includeGroups.length === 0 && details.includeRoles.length === 0 && (
                <span className="detail-chip detail-chip--none">None specified</span>
              )}
            </div>
          </div>
          {(details.excludeKeywords.length > 0 || details.excludeUsers.length > 0 || 
            details.excludeGroups.length > 0 || details.excludeRoles.length > 0) && (
            <div className="expanded-details__subsection">
              <span className="expanded-details__label">Exclude:</span>
              <div className="expanded-details__items">
                {details.excludeKeywords.map((kw, i) => (
                  <span key={`ekw-${i}`} className="detail-chip detail-chip--exclude">{kw}</span>
                ))}
                {details.excludeUsers.map((u, i) => (
                  <span key={`eu-${i}`} className="detail-chip detail-chip--exclude">👤 {u.name}</span>
                ))}
                {details.excludeGroups.map((g, i) => (
                  <span 
                    key={`eg-${i}`} 
                    className="detail-chip detail-chip--exclude clickable"
                    onClick={() => onGroupClick?.(g.id, g.name)}
                    title="Click to view members"
                  >
                    👥 {g.name}
                  </span>
                ))}
                {details.excludeRoles.map((r, i) => (
                  <span 
                    key={`er-${i}`} 
                    className="detail-chip detail-chip--exclude clickable"
                    onClick={() => onRoleClick?.(r.id, r.name)}
                    title="Click to view members"
                  >
                    🛡️ {r.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Target Resources Section */}
        <div className="expanded-details__section">
          <h4>
            Target Resources
            {counts && (
              <span className="section-percentage">
                {details.targetApps.includeKeywords.some(kw => 
                  kw.toLowerCase() === 'all' || kw.toLowerCase() === 'allapps' || kw.toLowerCase() === 'none'
                )
                  ? `(All ${counts.serviceprincipal || counts.application || '?'} apps)`
                  : `(${details.targetApps.includeEntities.length} apps)`
                }
              </span>
            )}
          </h4>
          <div className="expanded-details__subsection">
            <span className="expanded-details__label">Applications:</span>
            <div className="expanded-details__items">
              {details.targetApps.includeKeywords.map((kw, i) => (
                <span key={`akw-${i}`} className="detail-chip detail-chip--keyword">
                  ✓ {kw}
                  {(kw.toLowerCase() === 'all' || kw.toLowerCase() === 'allapps' || kw.toLowerCase() === 'none') 
                    ? ` (${counts?.servicePrincipals ?? counts?.serviceprincipal ?? counts?.applications ?? counts?.application ?? '?'} apps)` 
                    : ''
                  }
                </span>
              ))}
              {details.targetApps.includeEntities.map((e, i) => (
                <span key={`ae-${i}`} className="detail-chip detail-chip--app">📱 {e.name}</span>
              ))}
              {details.targetApps.includeKeywords.length === 0 && details.targetApps.includeEntities.length === 0 && (
                <span className="detail-chip detail-chip--none">Not specified</span>
              )}
            </div>
          </div>
          {details.userActions.length > 0 && (
            <div className="expanded-details__subsection">
              <span className="expanded-details__label">User Actions:</span>
              <div className="expanded-details__items">
                {details.userActions.map((a, i) => (
                  <span key={i} className="detail-chip">{a}</span>
                ))}
              </div>
            </div>
          )}
          {details.authContext.length > 0 && (
            <div className="expanded-details__subsection">
              <span className="expanded-details__label">Auth Context:</span>
              <div className="expanded-details__items">
                {details.authContext.map((a, i) => (
                  <span key={i} className="detail-chip detail-chip--context">{a}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Conditions Section */}
        <div className="expanded-details__section">
          <h4>Conditions</h4>
          <div className="expanded-details__grid-small">
            <div className="expanded-details__field">
              <span className="expanded-details__field-label">User Risk</span>
              <span className="expanded-details__field-value">
                {details.userRiskLevels.length > 0 
                  ? details.userRiskLevels.map((l, i) => (
                      <span key={i} className={`detail-chip detail-chip--risk-${l.toLowerCase()}`}>{l}</span>
                    ))
                  : <span className="detail-chip detail-chip--none">Any</span>
                }
              </span>
            </div>
            <div className="expanded-details__field">
              <span className="expanded-details__field-label">Sign-in Risk</span>
              <span className="expanded-details__field-value">
                {details.signInRiskLevels.length > 0 
                  ? details.signInRiskLevels.map((l, i) => (
                      <span key={i} className={`detail-chip detail-chip--risk-${l.toLowerCase()}`}>{l}</span>
                    ))
                  : <span className="detail-chip detail-chip--none">Any</span>
                }
              </span>
            </div>
            <div className="expanded-details__field">
              <span className="expanded-details__field-label">Platforms</span>
              <span className="expanded-details__field-value">
                {details.platforms.length > 0 
                  ? details.platforms.map((p, i) => (
                      <span key={i} className="detail-chip">{p}</span>
                    ))
                  : <span className="detail-chip detail-chip--none">Any</span>
                }
              </span>
            </div>
            <div className="expanded-details__field">
              <span className="expanded-details__field-label">Client Apps</span>
              <span className="expanded-details__field-value">
                {details.clientAppTypes.length > 0 
                  ? details.clientAppTypes.map((c, i) => (
                      <span key={i} className="detail-chip">{formatClientApp(c)}</span>
                    ))
                  : <span className="detail-chip detail-chip--none">All</span>
                }
              </span>
            </div>
            {details.deviceFilter && (
              <div className="expanded-details__field expanded-details__field--full">
                <span className="expanded-details__field-label">Device Filter</span>
                <span className="expanded-details__field-value">
                  <span className="detail-chip">{details.deviceFilter.mode}</span>
                  {details.deviceFilter.rule && (
                    <code className="detail-code">{details.deviceFilter.rule}</code>
                  )}
                </span>
              </div>
            )}
            {details.authFlows.length > 0 && (
              <div className="expanded-details__field">
                <span className="expanded-details__field-label">Auth Flows</span>
                <span className="expanded-details__field-value">
                  {details.authFlows.map((f, i) => (
                    <span key={i} className="detail-chip">{f}</span>
                  ))}
                </span>
              </div>
            )}
          </div>
          {(details.locations.includeKeywords.length > 0 || details.locations.includeEntities.length > 0 ||
            details.locations.excludeKeywords.length > 0 || details.locations.excludeEntities.length > 0) && (
            <div className="expanded-details__subsection">
              <span className="expanded-details__label">Locations:</span>
              <div className="expanded-details__items">
                {details.locations.includeKeywords.map((l, i) => (
                  <span key={`lik-${i}`} className="detail-chip detail-chip--include">{l}</span>
                ))}
                {details.locations.includeEntities.map((l, i) => (
                  <span key={`lie-${i}`} className="detail-chip detail-chip--include">{l}</span>
                ))}
                {details.locations.excludeKeywords.map((l, i) => (
                  <span key={`lek-${i}`} className="detail-chip detail-chip--exclude">excl: {l}</span>
                ))}
                {details.locations.excludeEntities.map((l, i) => (
                  <span key={`lee-${i}`} className="detail-chip detail-chip--exclude">excl: {l}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Grant Controls Section */}
        <div className="expanded-details__section">
          <h4>Grant Controls</h4>
          <div className="expanded-details__field">
            <span className="expanded-details__field-label">Operator</span>
            <span className={`operator-badge operator-badge--${details.grantOperator.toLowerCase()}`}>
              {details.grantOperator === 'AND' ? 'Require ALL controls' : 'Require ONE of controls'}
            </span>
          </div>
          <div className="expanded-details__subsection">
            <span className="expanded-details__label">Controls:</span>
            <div className="expanded-details__items">
              {details.grantControls.map((g, i) => (
                <span key={i} className="detail-chip detail-chip--grant">{formatGrant(g)}</span>
              ))}
            </div>
          </div>
          {details.authStrength?.name && (
            <div className="expanded-details__subsection expanded-details__subsection--highlight">
              <span className="expanded-details__label">🛡️ Authentication Strength:</span>
              <div className="expanded-details__auth-strength">
                <span className="auth-strength-name">{details.authStrength.name}</span>
                {details.authStrength.id && (
                  <span className="auth-strength-id">ID: {details.authStrength.id}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Session Controls Section */}
        <div className="expanded-details__section">
          <h4>Session Controls</h4>
          <div className="expanded-details__grid-small">
            <div className="expanded-details__field">
              <span className="expanded-details__field-label">Sign-in Frequency</span>
              <span className="expanded-details__field-value">
                {details.signInFrequency?.enabled || details.signInFrequency?.value ? (
                  <span className="detail-chip detail-chip--configured">
                    ✓ {details.signInFrequency.value} {details.signInFrequency.type || 'hours'}
                  </span>
                ) : (
                  <span className="detail-chip detail-chip--none">Not configured</span>
                )}
              </span>
            </div>
            <div className="expanded-details__field">
              <span className="expanded-details__field-label">Persistent Browser</span>
              <span className="expanded-details__field-value">
                {details.persistentBrowser?.enabled || details.persistentBrowser?.mode ? (
                  <span className="detail-chip detail-chip--configured">
                    ✓ {details.persistentBrowser.mode || 'Enabled'}
                  </span>
                ) : (
                  <span className="detail-chip detail-chip--none">Not configured</span>
                )}
              </span>
            </div>
            <div className="expanded-details__field">
              <span className="expanded-details__field-label">CAE</span>
              <span className="expanded-details__field-value">
                {details.cae?.enabled || details.cae?.mode ? (
                  <span className={`detail-chip ${details.cae.mode === 'strictLocation' ? 'detail-chip--strict' : 'detail-chip--configured'}`}>
                    ✓ {details.cae.mode === 'strictLocation' ? 'Strict Location' : details.cae.mode || 'Enabled'}
                  </span>
                ) : (
                  <span className="detail-chip detail-chip--none">Default</span>
                )}
              </span>
            </div>
            <div className="expanded-details__field">
              <span className="expanded-details__field-label">Token Protection</span>
              <span className="expanded-details__field-value">
                {details.tokenProtection?.enabled ? (
                  <span className="detail-chip detail-chip--configured">✓ Enabled</span>
                ) : (
                  <span className="detail-chip detail-chip--none">Not enabled</span>
                )}
              </span>
            </div>
            <div className="expanded-details__field">
              <span className="expanded-details__field-label">Cloud App Security</span>
              <span className="expanded-details__field-value">
                {details.cloudAppSecurity?.enabled ? (
                  <span className="detail-chip detail-chip--configured">
                    ✓ {details.cloudAppSecurity.type || 'Enabled'}
                  </span>
                ) : (
                  <span className="detail-chip detail-chip--none">Not configured</span>
                )}
              </span>
            </div>
            <div className="expanded-details__field">
              <span className="expanded-details__field-label">App Enforced</span>
              <span className="expanded-details__field-value">
                {details.appEnforced?.enabled ? (
                  <span className="detail-chip detail-chip--configured">✓ Enabled</span>
                ) : (
                  <span className="detail-chip detail-chip--none">Not configured</span>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatGrant(grant: string): string {
  const labels: Record<string, string> = {
    mfa: 'MFA',
    block: 'Block',
    compliantDevice: 'Compliant Device',
    domainJoinedDevice: 'Hybrid AD Join',
    approvedApplication: 'Approved App',
    compliantApplication: 'App Protection',
    passwordChange: 'Password Change'
  }
  if (grant.startsWith('authStrength:')) {
    return `Auth: ${grant.replace('authStrength:', '')}`
  }
  if (grant.startsWith('authRequirement:')) {
    return `Strength: ${grant.replace('authRequirement:', '')}`
  }
  return labels[grant] || grant
}

function formatClientApp(app: string): string {
  const labels: Record<string, string> = {
    browser: 'Browser',
    mobileAppsAndDesktopClients: 'Mobile & Desktop',
    exchangeActiveSync: 'Exchange ActiveSync',
    other: 'Legacy/Other'
  }
  return labels[app] || app
}

