import { useMemo, useState, useEffect } from 'react'
import type { GraphData, GraphNode } from '../types/graph'
import { calculateCoverageByGrantControl, type CoverageResult } from '../utils/coverage'
import { GRANT_CONTROL_LABELS } from '../utils/policyGrouping'
import { buildObjectsIndexWithCountsSync } from '../utils/objectsIndexWithCounts'
import { MemberModal, type Member } from './MemberModal'
import { PolicyFlowDiagram } from './PolicyFlowDiagram'
import './GapBuilderTab.css'

type GapBuilderProps = {
  graphData: GraphData
  selectedPolicyIds: Set<string>
  rawPolicies?: any[]
}

// Organized control and condition categories based on CA documentation
const GRANT_CONTROLS = [
  { id: 'mfa', label: 'MFA Required', icon: '🔐', description: 'Require multi-factor authentication' },
  { id: 'block', label: 'Block Access', icon: '🚫', description: 'Block access entirely' },
  { id: 'compliantDevice', label: 'Compliant Device', icon: '📱', description: 'Require Intune-compliant device' },
  { id: 'domainJoinedDevice', label: 'Hybrid AD Join', icon: '💻', description: 'Require hybrid Azure AD joined device' },
  { id: 'approvedApplication', label: 'Approved App', icon: '✅', description: 'Require approved client application' },
  { id: 'compliantApplication', label: 'App Protection', icon: '🛡️', description: 'Require app protection policy' },
  { id: 'passwordChange', label: 'Password Change', icon: '🔑', description: 'Require password change' },
  { id: 'authenticationStrength', label: 'Auth Strength', icon: '⚡', description: 'Require specific authentication strength' },
]

const SESSION_CONTROLS = [
  { id: 'signInFrequency', label: 'Sign-in Frequency', icon: '⏱️', description: 'Force re-authentication' },
  { id: 'persistentBrowserSession', label: 'Persistent Browser', icon: '🌐', description: 'Control browser persistence' },
  { id: 'continuousAccessEvaluation', label: 'CAE Enforcement', icon: '🔄', description: 'Continuous access evaluation' },
  { id: 'secureSignInSession', label: 'Token Protection', icon: '🔒', description: 'Require token binding' },
]

const CONDITION_CATEGORIES = [
  { id: 'userRisk', label: 'User Risk', icon: '⚠️', description: 'Based on user risk level' },
  { id: 'signInRisk', label: 'Sign-in Risk', icon: '🎯', description: 'Based on sign-in risk level' },
  { id: 'locations', label: 'Locations', icon: '📍', description: 'Named or trusted locations' },
  { id: 'platforms', label: 'Device Platforms', icon: '🖥️', description: 'Target specific OS platforms' },
  { id: 'clientApps', label: 'Client Apps', icon: '📲', description: 'Browser, mobile, desktop apps' },
  { id: 'deviceFilter', label: 'Device Filter', icon: '🔧', description: 'Custom device attribute filter' },
]

export function GapBuilderTab({ graphData, selectedPolicyIds, rawPolicies }: GapBuilderProps) {
  const [viewTab, setViewTab] = useState<'users' | 'apps' | 'controls' | 'conditions' | 'networks' | 'flow'>('users')
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [groupsData, setGroupsData] = useState<any[]>([])
  const [rolesData, setRolesData] = useState<any[]>([])
  const [selectedFlowPolicy, setSelectedFlowPolicy] = useState<any>(null)
  const [showFlowPanel, setShowFlowPanel] = useState(false)
  
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

  // Load counts.json and groups.json on mount
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

  // Build index with actual counts
  const indexWithCounts = useMemo(() => {
    return buildObjectsIndexWithCountsSync(graphData, null, counts)
  }, [graphData, counts])

  // Get all policies
  const allPolicies = useMemo(() => {
    return graphData.nodes.filter(n => n.type === 'policy')
  }, [graphData])

  // Calculate coverage
  const coverageResult = useMemo((): CoverageResult | null => {
    if (selectedPolicyIds.size === 0) return null
    return calculateCoverageByGrantControl(graphData, selectedPolicyIds, indexWithCounts)
  }, [graphData, selectedPolicyIds, indexWithCounts])

  // Analyze policies for controls, conditions, and networks
  const policyAnalysis = useMemo(() => {
    const selectedPolicies = allPolicies.filter(p => selectedPolicyIds.has(p.id))
    
    const controlCounts: Record<string, { count: number; policies: GraphNode[] }> = {}
    const conditionCounts: Record<string, { count: number; policies: GraphNode[] }> = {}
    const sessionControlCounts: Record<string, { count: number; policies: GraphNode[] }> = {}
    
    // Network/location analysis
    const networkAnalysis: Array<{
      policy: GraphNode
      action: string
      includeLocations: string[]
      excludeLocations: string[]
      includeKeywords: string[]
      excludeKeywords: string[]
      summary: string
    }> = []
    
    // Initialize all controls
    GRANT_CONTROLS.forEach(c => { controlCounts[c.id] = { count: 0, policies: [] } })
    SESSION_CONTROLS.forEach(c => { sessionControlCounts[c.id] = { count: 0, policies: [] } })
    CONDITION_CATEGORIES.forEach(c => { conditionCounts[c.id] = { count: 0, policies: [] } })
    
    for (const policy of selectedPolicies) {
      const props = policy.properties || {}
      
      // Check grant controls
      const grantControls = Array.isArray(props.grantControls) ? props.grantControls : []
      for (const gc of grantControls) {
        const key = String(gc).toLowerCase()
        if (controlCounts[key]) {
          controlCounts[key].count++
          controlCounts[key].policies.push(policy)
        }
      }
      
      // Check for authentication strength
      const accessControls = props.accessControls as any
      if (accessControls?.grant?.authenticationStrength) {
        controlCounts['authenticationStrength'].count++
        controlCounts['authenticationStrength'].policies.push(policy)
      }
      
      // Determine the action (block, mfa, etc.)
      const builtInControls = accessControls?.grant?.builtInControls
      let action = 'allow'
      if (builtInControls === 'block') action = 'block'
      else if (builtInControls === 'mfa') action = 'require MFA'
      else if (typeof builtInControls === 'string' && builtInControls) action = builtInControls
      
      // Check conditions
      const conditions = props.conditions as any
      if (conditions) {
        if (conditions.userRiskLevels?.length > 0) {
          conditionCounts['userRisk'].count++
          conditionCounts['userRisk'].policies.push(policy)
        }
        if (conditions.signInRiskLevels?.length > 0) {
          conditionCounts['signInRisk'].count++
          conditionCounts['signInRisk'].policies.push(policy)
        }
        if (conditions.locations?.include?.entities?.length > 0 || 
            conditions.locations?.exclude?.entities?.length > 0 ||
            conditions.locations?.include?.keywords?.length > 0 ||
            conditions.locations?.exclude?.keywords?.length > 0) {
          conditionCounts['locations'].count++
          conditionCounts['locations'].policies.push(policy)
          
          // Extract location details for network analysis
          const includeEntities = conditions.locations?.include?.entities || []
          const excludeEntities = conditions.locations?.exclude?.entities || []
          const includeKw = conditions.locations?.include?.keywords || []
          const excludeKw = conditions.locations?.exclude?.keywords || []
          
          const includeLocations = includeEntities.map((e: any) => e.displayName || e.id)
          const excludeLocations = excludeEntities.map((e: any) => e.displayName || e.id)
          
          // Build summary
          let summary = ''
          const hasAllInclude = includeKw.some((k: string) => k.toLowerCase() === 'all')
          
          if (action === 'block') {
            if (includeLocations.length > 0) {
              summary = `🚫 BLOCK access from: ${includeLocations.join(', ')}`
            } else if (hasAllInclude && excludeLocations.length > 0) {
              summary = `🚫 BLOCK access from everywhere EXCEPT: ${excludeLocations.join(', ')}`
            } else if (hasAllInclude) {
              summary = `🚫 BLOCK access from all locations`
            }
          } else {
            if (hasAllInclude && excludeLocations.length > 0) {
              summary = `✓ ${action} from everywhere EXCEPT: ${excludeLocations.join(', ')} (exempt from control)`
            } else if (hasAllInclude) {
              summary = `✓ ${action} from all locations`
            } else if (includeLocations.length > 0) {
              summary = `✓ ${action} only from: ${includeLocations.join(', ')}`
            }
          }
          
          networkAnalysis.push({
            policy,
            action,
            includeLocations,
            excludeLocations,
            includeKeywords: includeKw,
            excludeKeywords: excludeKw,
            summary
          })
        }
        if (conditions.platforms?.includePlatforms?.length > 0 || conditions.platforms?.excludePlatforms?.length > 0) {
          conditionCounts['platforms'].count++
          conditionCounts['platforms'].policies.push(policy)
        }
        if (conditions.clientAppTypes?.length > 0 && !conditions.clientAppTypes.includes('all')) {
          conditionCounts['clientApps'].count++
          conditionCounts['clientApps'].policies.push(policy)
        }
        if (conditions.devices?.deviceFilter) {
          conditionCounts['deviceFilter'].count++
          conditionCounts['deviceFilter'].policies.push(policy)
        }
      }
      
      // Check session controls
      const sessionControls = accessControls?.session || (props as any).sessionControls
      if (sessionControls) {
        if (sessionControls.signInFrequency?.isEnabled) {
          sessionControlCounts['signInFrequency'].count++
          sessionControlCounts['signInFrequency'].policies.push(policy)
        }
        if (sessionControls.persistentBrowser?.isEnabled !== undefined) {
          sessionControlCounts['persistentBrowserSession'].count++
          sessionControlCounts['persistentBrowserSession'].policies.push(policy)
        }
        if (sessionControls.continuousAccessEvaluation?.mode) {
          sessionControlCounts['continuousAccessEvaluation'].count++
          sessionControlCounts['continuousAccessEvaluation'].policies.push(policy)
        }
        if (sessionControls.secureSignInSession?.isEnabled) {
          sessionControlCounts['secureSignInSession'].count++
          sessionControlCounts['secureSignInSession'].policies.push(policy)
        }
      }
    }
    
    return { controlCounts, conditionCounts, sessionControlCounts, networkAnalysis }
  }, [allPolicies, selectedPolicyIds])

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

  const formatPercent = (covered: number, total: number) => {
    if (total === 0) return '0%'
    return Math.round((covered / total) * 100) + '%'
  }

  const exportCoverage = () => {
    if (!coverageResult) return

    const rows: string[][] = [
      ['Grant Control', 'Policies', 'Users Covered', 'Users Total', 'Users %', 'Apps Covered', 'Apps Total', 'Apps %']
    ]

    for (const [gc, cov] of coverageResult.byGrantControl.entries()) {
      const usersCovered = cov.users.coveredCount ?? cov.users.covered.size
      const usersTotal = cov.users.actualTotal || cov.users.total
      const appsCovered = cov.applications.coveredCount ?? cov.applications.covered.size
      const appsTotal = cov.applications.actualTotal || cov.applications.total
      
      rows.push([
        GRANT_CONTROL_LABELS[gc] || gc,
        String(cov.policyCount),
        String(usersCovered),
        String(usersTotal),
        formatPercent(usersCovered, usersTotal),
        String(appsCovered),
        String(appsTotal),
        formatPercent(appsCovered, appsTotal),
      ])
    }

    const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gap-analysis-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Get totals for display
  const userTotal = counts?.user ?? indexWithCounts.totals.user ?? 0
  const appTotal = counts?.serviceprincipal ?? counts?.application ?? indexWithCounts.totals.servicePrincipal ?? 0
  const groupTotal = counts?.group ?? 0

  return (
    <div className="gap-builder-v2">
      {/* Summary Stats Bar */}
      <div className="gap-builder-v2__stats-bar">
        <div className="gap-builder-v2__stat">
          <span className="gap-builder-v2__stat-value">{selectedPolicyIds.size}</span>
          <span className="gap-builder-v2__stat-label">Policies Selected</span>
        </div>
        <div className="gap-builder-v2__stat">
          <span className="gap-builder-v2__stat-value">{userTotal.toLocaleString()}</span>
          <span className="gap-builder-v2__stat-label">Total Users</span>
        </div>
        <div className="gap-builder-v2__stat">
          <span className="gap-builder-v2__stat-value">{appTotal.toLocaleString()}</span>
          <span className="gap-builder-v2__stat-label">Total Apps</span>
            </div>
        <div className="gap-builder-v2__stat">
          <span className="gap-builder-v2__stat-value">{groupTotal.toLocaleString()}</span>
          <span className="gap-builder-v2__stat-label">Total Groups</span>
          </div>
          {coverageResult && (
          <button className="gap-builder-v2__export-btn" onClick={exportCoverage}>
            📥 Export CSV
            </button>
          )}
        </div>

      {/* View Tabs - Reordered with Object/Resource Coverage first */}
      <div className="gap-builder-v2__tabs">
        <button 
          className={`gap-builder-v2__tab ${viewTab === 'users' ? 'active' : ''}`}
          onClick={() => setViewTab('users')}
        >
          Object Coverage
        </button>
        <button 
          className={`gap-builder-v2__tab ${viewTab === 'apps' ? 'active' : ''}`}
          onClick={() => setViewTab('apps')}
        >
          Resource Coverage
        </button>
        <button 
          className={`gap-builder-v2__tab ${viewTab === 'networks' ? 'active' : ''}`}
          onClick={() => setViewTab('networks')}
        >
          Networks & Locations
        </button>
        <button 
          className={`gap-builder-v2__tab ${viewTab === 'flow' ? 'active' : ''}`}
          onClick={() => setViewTab('flow')}
        >
          🔀 Policy Flow
        </button>
        <button 
          className={`gap-builder-v2__tab ${viewTab === 'controls' ? 'active' : ''}`}
          onClick={() => setViewTab('controls')}
        >
          Grant Controls
        </button>
        <button 
          className={`gap-builder-v2__tab ${viewTab === 'conditions' ? 'active' : ''}`}
          onClick={() => setViewTab('conditions')}
        >
          Conditions
        </button>
        
        {/* Flow Panel Toggle */}
        <button 
          className={`gap-builder-v2__flow-toggle ${showFlowPanel ? 'active' : ''}`}
          onClick={() => setShowFlowPanel(!showFlowPanel)}
          title="Toggle Policy Flow Panel"
        >
          📊
        </button>
      </div>

      {/* Main Content */}
      <div className="gap-builder-v2__content">
        {selectedPolicyIds.size === 0 ? (
          <div className="gap-builder-v2__empty">
            <p>Toggle policies above to analyze coverage gaps</p>
          </div>
        ) : (
          <>
            {viewTab === 'users' && coverageResult && (
              <div className="gap-builder-v2__coverage-detail">
                <CoverageDetailCard
                  title="Object Coverage (Users, Groups, Roles)"
                  coverage={coverageResult.overall.users}
                  entityType="user"
                  graphData={graphData}
                  selectedPolicyIds={selectedPolicyIds}
                  onGroupClick={(id, name) => openMemberModal(id, 'group', name)}
                  onRoleClick={(id, name) => openMemberModal(id, 'role', name)}
                />
              </div>
            )}

            {viewTab === 'apps' && coverageResult && (
              <div className="gap-builder-v2__coverage-detail">
                <CoverageDetailCard
                  title="Resource Coverage (Applications & Services)"
                  coverage={coverageResult.overall.applications}
                  entityType="app"
                  graphData={graphData}
                  selectedPolicyIds={selectedPolicyIds}
                />
              </div>
            )}

            {viewTab === 'networks' && (
              <div className="gap-builder-v2__networks-detail">
                <h3>📍 Network & Location Conditions</h3>
                
                {policyAnalysis.networkAnalysis.length === 0 ? (
                  <div className="gap-builder-v2__no-networks">
                    <p>No location-based conditions in selected policies</p>
                    <p className="gap-builder-v2__no-networks-hint">
                      Location conditions allow you to restrict or allow access based on IP ranges, countries, or trusted networks.
                    </p>
                  </div>
                ) : (
                  <div className="gap-builder-v2__network-cards">
                    {policyAnalysis.networkAnalysis.map((net, idx) => (
                      <div key={idx} className={`gap-builder-v2__network-card ${net.action === 'block' ? 'block' : 'allow'}`}>
                        <div className="gap-builder-v2__network-card-header">
                          <span className="gap-builder-v2__network-policy-name">
                            {net.policy.label || net.policy.id}
                          </span>
                          <span className={`gap-builder-v2__network-action gap-builder-v2__network-action--${net.action === 'block' ? 'block' : 'allow'}`}>
                            {net.action.toUpperCase()}
                          </span>
                        </div>
                        
                        <div className="gap-builder-v2__network-summary">
                          {net.summary}
                        </div>
                        
                        <div className="gap-builder-v2__network-details">
                          {net.includeKeywords.length > 0 && (
                            <div className="gap-builder-v2__network-row">
                              <span className="gap-builder-v2__network-label">Include Keywords:</span>
                              <div className="gap-builder-v2__network-pills">
                                {net.includeKeywords.map((kw, i) => (
                                  <span key={i} className="gap-builder-v2__network-pill include">
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {net.includeLocations.length > 0 && (
                            <div className="gap-builder-v2__network-row">
                              <span className="gap-builder-v2__network-label">
                                {net.action === 'block' ? '🚫 Blocked From:' : '✓ Required From:'}
                              </span>
                              <div className="gap-builder-v2__network-pills">
                                {net.includeLocations.map((loc, i) => (
                                  <span key={i} className={`gap-builder-v2__network-pill ${net.action === 'block' ? 'blocked' : 'included'}`}>
                                    {loc}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {net.excludeLocations.length > 0 && (
                            <div className="gap-builder-v2__network-row">
                              <span className="gap-builder-v2__network-label">
                                {net.action === 'block' ? '✓ Allowed From:' : '⚠️ Exempt (no control):'}
                              </span>
                              <div className="gap-builder-v2__network-pills">
                                {net.excludeLocations.map((loc, i) => (
                                  <span key={i} className="gap-builder-v2__network-pill excluded">
                                    {loc}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Network Coverage Summary */}
                {coverageResult && (
                  <div className="gap-builder-v2__network-summary-card">
                    <h4>Overall Network Coverage</h4>
                    <p>{coverageResult.overall.networks.note}</p>
                    {coverageResult.overall.networks.isGlobal && (
                      <div className="gap-builder-v2__network-global-badge">
                        🌐 Policies apply globally (from all locations)
                      </div>
                    )}
                    {coverageResult.overall.networks.includedLocations.size > 0 && (
                      <div className="gap-builder-v2__network-stat">
                        <strong>Named Locations Used:</strong> {coverageResult.overall.networks.includedLocations.size}
                      </div>
                    )}
                  {coverageResult.overall.networks.excludedLocations.size > 0 && (
                      <div className="gap-builder-v2__network-stat warning">
                        <strong>Excluded Locations:</strong> {coverageResult.overall.networks.excludedLocations.size}
                        <span className="gap-builder-v2__network-warning">
                          ⚠️ Traffic from these locations may bypass controls
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {viewTab === 'controls' && (
              <div className="gap-builder-v2__controls-grid">
                <div className="gap-builder-v2__control-section">
                  <h3>Grant Controls</h3>
                  <div className="gap-builder-v2__control-cards">
                    {GRANT_CONTROLS.map(control => {
                      const data = policyAnalysis.controlCounts[control.id]
                      const pct = selectedPolicyIds.size > 0 ? Math.round((data.count / selectedPolicyIds.size) * 100) : 0
                      return (
                        <div 
                          key={control.id} 
                          className={`gap-builder-v2__control-card ${data.count > 0 ? 'active' : ''}`}
                        >
                          <div className="gap-builder-v2__control-icon">{control.icon}</div>
                          <div className="gap-builder-v2__control-info">
                            <div className="gap-builder-v2__control-label">{control.label}</div>
                            <div className="gap-builder-v2__control-count">
                              {data.count} / {selectedPolicyIds.size} policies ({pct}%)
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                
                <div className="gap-builder-v2__control-section">
                  <h3>Session Controls</h3>
                  <div className="gap-builder-v2__control-cards">
                    {SESSION_CONTROLS.map(control => {
                      const data = policyAnalysis.sessionControlCounts[control.id]
                      const pct = selectedPolicyIds.size > 0 ? Math.round((data.count / selectedPolicyIds.size) * 100) : 0
                      return (
                        <div 
                          key={control.id} 
                          className={`gap-builder-v2__control-card session ${data.count > 0 ? 'active' : ''}`}
                        >
                          <div className="gap-builder-v2__control-icon">{control.icon}</div>
                          <div className="gap-builder-v2__control-info">
                            <div className="gap-builder-v2__control-label">{control.label}</div>
                            <div className="gap-builder-v2__control-count">
                              {data.count} / {selectedPolicyIds.size} policies ({pct}%)
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                    </div>
                  )}

            {viewTab === 'conditions' && (
              <div className="gap-builder-v2__conditions-grid">
                <h3>Policy Conditions</h3>
                <div className="gap-builder-v2__control-cards">
                  {CONDITION_CATEGORIES.map(condition => {
                    const data = policyAnalysis.conditionCounts[condition.id]
                    const pct = selectedPolicyIds.size > 0 ? Math.round((data.count / selectedPolicyIds.size) * 100) : 0
                    return (
                      <div 
                        key={condition.id} 
                        className={`gap-builder-v2__control-card condition ${data.count > 0 ? 'active' : ''}`}
                      >
                        <div className="gap-builder-v2__control-icon">{condition.icon}</div>
                        <div className="gap-builder-v2__control-info">
                          <div className="gap-builder-v2__control-label">{condition.label}</div>
                          <div className="gap-builder-v2__control-count">
                            {data.count} / {selectedPolicyIds.size} policies ({pct}%)
                          </div>
                          <div className="gap-builder-v2__control-desc">{condition.description}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {viewTab === 'flow' && (
              <div className="gap-builder-v2__flow-view">
                <div className="gap-builder-v2__flow-intro">
                  <h3>🔀 Policy Decision Flows</h3>
                  <p>Click a policy below to see its decision flow diagram - how the policy evaluates conditions and applies controls.</p>
            </div>

                <div className="gap-builder-v2__flow-grid">
                  <div className="gap-builder-v2__flow-policy-list">
                    <h4>Selected Policies</h4>
                    {rawPolicies?.filter(p => selectedPolicyIds.has(p.id)).map(policy => (
                      <div 
                        key={policy.id}
                        className={`gap-builder-v2__flow-policy-item ${selectedFlowPolicy?.id === policy.id ? 'selected' : ''}`}
                        onClick={() => setSelectedFlowPolicy(policy)}
                      >
                        <span className={`gap-builder-v2__flow-policy-state gap-builder-v2__flow-policy-state--${policy.state}`}>
                          {policy.state === 'enabled' ? '🟢' : 
                           policy.state === 'enabledForReportingButNotEnforced' ? '🟡' : '🔴'}
                        </span>
                        <span className="gap-builder-v2__flow-policy-name">
                          {policy.displayName}
                        </span>
                        <span className="gap-builder-v2__flow-policy-action">
                          {getGrantAction(policy)}
                        </span>
                      </div>
                ))}
            </div>
                  
                  <div className="gap-builder-v2__flow-diagram-container">
                    {selectedFlowPolicy ? (
                      <PolicyFlowDiagram 
                        policy={selectedFlowPolicy} 
                        onClose={() => setSelectedFlowPolicy(null)}
                      />
                    ) : (
                      <div className="gap-builder-v2__flow-empty">
                        <p>👈 Select a policy to view its decision flow</p>
          </div>
        )}
        </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Collapsible Flow Panel */}
      {showFlowPanel && selectedFlowPolicy && (
        <div className="gap-builder-v2__flow-panel">
          <PolicyFlowDiagram 
            policy={selectedFlowPolicy} 
            compact={true}
            onClose={() => setShowFlowPanel(false)}
          />
        </div>
      )}

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

// Helper to get grant action from policy
function getGrantAction(policy: any): string {
  const builtInControls = policy.accessControls?.grant?.builtInControls
  if (builtInControls === 'block') return '🚫 Block'
  if (builtInControls === 'mfa') return '🔐 MFA'
  if (Array.isArray(builtInControls)) {
    if (builtInControls.includes('block')) return '🚫 Block'
    if (builtInControls.includes('mfa')) return '🔐 MFA'
    return builtInControls.join(', ')
  }
  return builtInControls || 'Grant'
}

// Coverage Detail Card with exclusions
function CoverageDetailCard({
  title,
  coverage,
  entityType,
  graphData,
  selectedPolicyIds,
  onGroupClick,
  onRoleClick
}: {
  title: string
  coverage: any
  entityType: 'user' | 'app'
  graphData: GraphData
  selectedPolicyIds: Set<string>
  onGroupClick?: (id: string, name: string) => void
  onRoleClick?: (id: string, name: string) => void
}) {
  const covered = coverage.coveredCount ?? coverage.covered.size
  const uncovered = coverage.uncoveredCount ?? coverage.uncovered.size
  const excluded = coverage.excluded.size
  const total = coverage.actualTotal || coverage.total
  const usedAllKeyword = coverage.coveredCount !== undefined && coverage.covered.size === 0 && coverage.coveredCount > 0
  const coveredPct = total > 0 ? Math.round((covered / total) * 100) : 0

  // Get exclusion details from policies
  const exclusionDetails = useMemo(() => {
    const exclusions: Array<{ policyName: string; entities: Array<{ id: string; name: string; type: string }> }> = []
    
    const policies = graphData.nodes.filter(n => n.type === 'policy' && selectedPolicyIds.has(n.id))
    
    for (const policy of policies) {
      const assignments = policy.properties?.assignments as any
      if (!assignments?.exclude) continue
      
      const policyExclusions: Array<{ id: string; name: string; type: string }> = []
      
      if (entityType === 'user') {
        const excludeUsers = assignments.exclude.users?.entities || []
        const excludeGroups = assignments.exclude.groups?.entities || []
        const excludeRoles = assignments.exclude.roles?.entities || []
        
        for (const u of excludeUsers) {
          policyExclusions.push({ id: u.id, name: u.displayName || u.id, type: 'user' })
        }
        for (const g of excludeGroups) {
          policyExclusions.push({ id: g.id, name: g.displayName || g.id, type: 'group' })
        }
        for (const r of excludeRoles) {
          policyExclusions.push({ id: r.id, name: r.displayName || r.id, type: 'role' })
        }
      } else {
        const targetResources = policy.properties?.targetResources as any
        const apps = targetResources?.applications || targetResources
        const excludeApps = apps?.exclude?.entities || []
        
        for (const a of excludeApps) {
          policyExclusions.push({ id: a.id, name: a.displayName || a.id, type: 'app' })
        }
      }
      
      if (policyExclusions.length > 0) {
        exclusions.push({ policyName: policy.label || policy.id, entities: policyExclusions })
      }
    }
    
    return exclusions
  }, [graphData, selectedPolicyIds, entityType])

  return (
    <div className="coverage-detail-card">
      <div className="coverage-detail-card__header">
        <h3>{title}</h3>
        <div className="coverage-detail-card__summary">
          {covered.toLocaleString()} / {total.toLocaleString()} ({coveredPct}%)
        </div>
      </div>

      <div className="coverage-detail-card__bar">
        <div 
          className="coverage-detail-card__bar-fill covered" 
          style={{ width: `${coveredPct}%` }}
        />
      </div>
      
      <div className="coverage-detail-card__stats">
        {usedAllKeyword ? (
          <div className="coverage-detail-card__all-keyword">
            <span className="coverage-detail-card__all-badge">✓ All {entityType === 'user' ? 'Users' : 'Applications'}</span>
            <span className="coverage-detail-card__formula">
              = {total.toLocaleString()} total − {excluded.toLocaleString()} excluded = <strong>{covered.toLocaleString()} covered</strong>
            </span>
          </div>
        ) : (
          <div className="coverage-detail-card__counts">
            <span className="coverage-detail-card__count covered">✓ {covered.toLocaleString()} covered</span>
            <span className="coverage-detail-card__count uncovered">○ {uncovered.toLocaleString()} uncovered</span>
        </div>
        )}
      </div>

      {exclusionDetails.length > 0 && (
        <div className="coverage-detail-card__exclusions">
          <h4>⚠️ Exclusions ({excluded} entities)</h4>
          {exclusionDetails.map((exc, idx) => (
            <div key={idx} className="coverage-detail-card__exclusion-policy">
              <div className="coverage-detail-card__exclusion-policy-name">{exc.policyName}</div>
              <div className="coverage-detail-card__exclusion-entities">
                {exc.entities.map((entity, eIdx) => (
                  <span 
                    key={eIdx} 
                    className={`coverage-detail-card__entity-pill ${entity.type}`}
                    onClick={() => {
                      if (entity.type === 'group' && onGroupClick) {
                        onGroupClick(entity.id, entity.name)
                      } else if (entity.type === 'role' && onRoleClick) {
                        onRoleClick(entity.id, entity.name)
                      }
                    }}
                    style={{ cursor: entity.type === 'group' || entity.type === 'role' ? 'pointer' : 'default' }}
                  >
                    {entity.type === 'user' && '👤'}
                    {entity.type === 'group' && '👥'}
                    {entity.type === 'role' && '🛡️'}
                    {entity.type === 'app' && '📱'}
                    {entity.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
