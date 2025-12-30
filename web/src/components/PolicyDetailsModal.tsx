import { useMemo } from 'react'
import type { GraphData, GraphEdge } from '../types/graph'
import './PolicyDetailsModal.css'

interface PolicyDetailsModalProps {
  policyId: string
  graphData: GraphData
  onClose: () => void
}

// Helper to safely get nested property
const getProp = (obj: any, path: string): any => {
  if (!obj) return null
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    if (current == null) return null
    current = current[part]
  }
  return current
}

export function PolicyDetailsModal({ policyId, graphData, onClose }: PolicyDetailsModalProps) {
  const policyData = useMemo(() => {
    const node = graphData.nodes.find((n) => n.id === policyId && n.type === 'policy')
    if (!node) return null

    const fullPolicy = node.properties as any
    const edges = graphData.edges.filter((e) => e.from === policyId)
    const includes = edges.filter((e) => e.relationship.startsWith('include'))
    const excludes = edges.filter((e) => e.relationship.startsWith('exclude'))

    // Group by target type
    const groupByType = (edgeList: GraphEdge[]) => {
      const groups = new Map<string, GraphEdge[]>()
      for (const edge of edgeList) {
        const type = edge.relationship.split(':')[1] || 'unknown'
        if (!groups.has(type)) groups.set(type, [])
        groups.get(type)!.push(edge)
      }
      return groups
    }

    return {
      node,
      fullPolicy,
      edges,
      includes: groupByType(includes),
      excludes: groupByType(excludes),
      grantControls: Array.isArray(node.properties?.grantControls)
        ? (node.properties.grantControls as string[])
        : [],
      state: String(node.properties?.state ?? 'unknown'),
      createdDateTime: node.properties?.createdDateTime as string | undefined,
      modifiedDateTime: node.properties?.modifiedDateTime as string | undefined,
    }
  }, [policyId, graphData])

  if (!policyData) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal__header">
            <h2>Policy Not Found</h2>
            <button onClick={onClose} className="modal__close">
              ×
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Render user/group/role assignments from policy data structure
  const renderUserAssignments = (scope: 'include' | 'exclude') => {
    const assignments = getProp(policyData?.fullPolicy, `assignments.${scope}`)
    if (!assignments) return null

    const users = assignments.users || {}
    const groups = assignments.groups || {}
    const roles = assignments.roles || {}
    
    const userEntities = users.entities || []
    const userKeywords = users.keywords || []
    const groupEntities = groups.entities || []
    const groupKeywords = groups.keywords || []
    const roleEntities = roles.entities || []
    const roleKeywords = roles.keywords || []

    const totalCount = userEntities.length + userKeywords.length + 
                      groupEntities.length + groupKeywords.length + 
                      roleEntities.length + roleKeywords.length

    if (totalCount === 0) return null

    const title = scope === 'include' ? 'User & Group Assignments - Include' : 'User & Group Assignments - Exclude'

    return (
      <div className="policy-section">
        <h3>{title}</h3>
        
        {/* Users */}
        {(userEntities.length > 0 || userKeywords.length > 0) && (
          <div className="policy-group">
            <h4>Users ({userEntities.length + userKeywords.length})</h4>
            <ul className="policy-list">
              {userKeywords.map((kw: string) => {
                let displayLabel = kw
                if (kw === 'All' || kw === 'AllUsers') {
                  displayLabel = 'All Users'
                } else if (kw === 'None') {
                  displayLabel = 'No Users'
                }
                return (
                  <li key={kw}>
                    <span className="policy-badge policy-badge--keyword">Keyword</span>
                    <span className="policy-target">{displayLabel}</span>
                  </li>
                )
              })}
              {userEntities.slice(0, 50).map((user: any) => (
                <li key={user.id}>
                  <span className="policy-target">{user.displayName || user.userPrincipalName}</span>
                </li>
              ))}
              {userEntities.length > 50 && (
                <li className="policy-more">... and {userEntities.length - 50} more</li>
              )}
            </ul>
          </div>
        )}

        {/* Groups */}
        {(groupEntities.length > 0 || groupKeywords.length > 0) && (
          <div className="policy-group">
            <h4>Groups ({groupEntities.length + groupKeywords.length})</h4>
            <ul className="policy-list">
              {groupKeywords.map((kw: string) => (
                <li key={kw}>
                  <span className="policy-badge policy-badge--keyword">Keyword</span>
                  <span className="policy-target">{kw}</span>
                </li>
              ))}
              {groupEntities.slice(0, 50).map((group: any) => (
                <li key={group.id}>
                  <span className="policy-target">{group.displayName}</span>
                </li>
              ))}
              {groupEntities.length > 50 && (
                <li className="policy-more">... and {groupEntities.length - 50} more</li>
              )}
            </ul>
          </div>
        )}

        {/* Roles */}
        {(roleEntities.length > 0 || roleKeywords.length > 0) && (
          <div className="policy-group">
            <h4>Directory Roles ({roleEntities.length + roleKeywords.length})</h4>
            <ul className="policy-list">
              {roleKeywords.map((kw: string) => (
                <li key={kw}>
                  <span className="policy-badge policy-badge--keyword">Keyword</span>
                  <span className="policy-target">{kw}</span>
                </li>
              ))}
              {roleEntities.slice(0, 50).map((role: any) => (
                <li key={role.id}>
                  <span className="policy-target">{role.displayName}</span>
                </li>
              ))}
              {roleEntities.length > 50 && (
                <li className="policy-more">... and {roleEntities.length - 50} more</li>
              )}
            </ul>
          </div>
        )}
      </div>
    )
  }

  const renderGuestUsers = () => {
    const includeGuests = getProp(policyData?.fullPolicy, 'conditions.users.includeGuestsOrExternalUsers')
    const excludeGuests = getProp(policyData?.fullPolicy, 'conditions.users.excludeGuestsOrExternalUsers')
    
    const hasInclude = includeGuests?.guestOrExternalUserTypes
    const hasExclude = excludeGuests?.guestOrExternalUserTypes

    if (!hasInclude && !hasExclude) return null

    return (
      <div className="policy-section">
        <h3>Guest / External Users</h3>
        {hasInclude && (
          <div className="policy-group">
            <h4>Include</h4>
            <div className="policy-detail">
              <strong>User Types:</strong> {includeGuests.guestOrExternalUserTypes}
            </div>
            {includeGuests.externalTenants?.membershipKind && (
              <div className="policy-detail">
                <strong>External Tenants:</strong> {includeGuests.externalTenants.membershipKind}
              </div>
            )}
          </div>
        )}
        {hasExclude && (
          <div className="policy-group">
            <h4>Exclude</h4>
            <div className="policy-detail">
              <strong>User Types:</strong> {excludeGuests.guestOrExternalUserTypes}
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderTargetResources = () => {
    const apps = getProp(policyData?.fullPolicy, 'targetResources.applications')
    if (!apps) return null

    const includeApps = apps.include?.entities || []
    const excludeApps = apps.exclude?.entities || []
    const includeKeywords = apps.include?.keywords || []
    const excludeKeywords = apps.exclude?.keywords || []
    const includeAuthContexts = apps.includeAuthenticationContextClassReferences || []
    const excludeAuthContexts = apps.excludeAuthenticationContextClassReferences || []
    const includeUserActions = apps.includeUserActions || []

    const hasAny = includeApps.length > 0 || excludeApps.length > 0 || 
                   includeKeywords.length > 0 || excludeKeywords.length > 0 ||
                   includeAuthContexts.length > 0 || excludeAuthContexts.length > 0 ||
                   includeUserActions.length > 0

    if (!hasAny) return null

    return (
      <div className="policy-section">
        <h3>Target Resources</h3>
        
        {/* Applications */}
        {(includeApps.length > 0 || includeKeywords.length > 0 || excludeApps.length > 0 || excludeKeywords.length > 0) && (
          <div className="policy-group">
            <h4>Applications</h4>
            {(includeApps.length > 0 || includeKeywords.length > 0) && (
              <>
                <div style={{ marginTop: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>Include ({includeApps.length + includeKeywords.length})</div>
                <ul className="policy-list">
                  {includeKeywords.map((kw: string) => {
                    let displayLabel = kw
                    if (kw === 'All' || kw === 'AllApps') {
                      displayLabel = 'All Applications'
                    } else if (kw === 'None') {
                      displayLabel = 'No Applications'
                    }
                    return (
                      <li key={kw}>
                        <span className="policy-badge policy-badge--keyword">Keyword</span>
                        <span className="policy-target policy-keyword">{displayLabel}</span>
                      </li>
                    )
                  })}
                  {includeApps.slice(0, 20).map((app: any) => (
                    <li key={app.id}>
                      <span className="policy-target">{app.displayName || app.appId}</span>
                      {app.appId && <span className="policy-via">App ID: {app.appId}</span>}
                    </li>
                  ))}
                  {includeApps.length > 20 && (
                    <li className="policy-more">... and {includeApps.length - 20} more</li>
                  )}
                </ul>
              </>
            )}
            {(excludeApps.length > 0 || excludeKeywords.length > 0) && (
              <>
                <div style={{ marginTop: '0.75rem', fontWeight: 600, fontSize: '0.9rem' }}>Exclude ({excludeApps.length + excludeKeywords.length})</div>
                <ul className="policy-list">
                  {excludeKeywords.map((kw: string) => {
                    let displayLabel = kw
                    if (kw === 'All' || kw === 'AllApps') {
                      displayLabel = 'All Applications'
                    } else if (kw === 'None') {
                      displayLabel = 'No Applications'
                    }
                    return (
                      <li key={kw}>
                        <span className="policy-badge policy-badge--keyword">Keyword</span>
                        <span className="policy-target policy-keyword">{displayLabel}</span>
                      </li>
                    )
                  })}
                  {excludeApps.map((app: any) => (
                    <li key={app.id}>
                      <span className="policy-target">{app.displayName || app.appId}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {/* Authentication Contexts */}
        {(includeAuthContexts.length > 0 || excludeAuthContexts.length > 0) && (
          <div className="policy-group">
            <h4>Authentication Contexts</h4>
            {includeAuthContexts.length > 0 && (
              <div className="policy-detail">
                <strong>Include:</strong> 
                <div style={{ marginTop: '0.25rem' }}>
                  {includeAuthContexts.map((ctx: string) => (
                    <span key={ctx} className="badge badge--auth-context" style={{ marginRight: '0.5rem' }}>
                      {ctx}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {excludeAuthContexts.length > 0 && (
              <div className="policy-detail" style={{ marginTop: '0.5rem' }}>
                <strong>Exclude:</strong> 
                <div style={{ marginTop: '0.25rem' }}>
                  {excludeAuthContexts.map((ctx: string) => (
                    <span key={ctx} className="badge badge--auth-context" style={{ marginRight: '0.5rem' }}>
                      {ctx}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* User Actions */}
        {includeUserActions.length > 0 && (
          <div className="policy-group">
            <h4>User Actions</h4>
            <ul className="policy-list">
              {includeUserActions.map((action: string) => (
                <li key={action}>
                  <span className="policy-target">{action}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  const renderConditions = () => {
    const conditions = getProp(policyData?.fullPolicy, 'conditions')
    if (!conditions) return null

    const hasAnyCondition =
      conditions.signInRiskLevels ||
      conditions.userRiskLevels ||
      conditions.servicePrincipalRiskLevels ||
      conditions.insiderRiskLevels?.configured ||
      conditions.authenticationFlows?.configured ||
      conditions.deviceFilter?.configured ||
      conditions.clientAppTypes ||
      conditions.platforms?.include ||
      conditions.platforms?.exclude ||
      conditions.devices ||
      conditions.authenticationContextClassReferences ||
      (conditions.locations?.include?.entities?.length > 0 || conditions.locations?.include?.keywords?.length > 0) ||
      (conditions.locations?.exclude?.entities?.length > 0 || conditions.locations?.exclude?.keywords?.length > 0) ||
      conditions.applications?.applicationFilter

    if (!hasAnyCondition) return null

    return (
      <div className="policy-section">
        <h3>Conditions</h3>
        
        {/* Risk Levels */}
        {(conditions.userRiskLevels || conditions.signInRiskLevels || conditions.servicePrincipalRiskLevels || conditions.insiderRiskLevels?.configured) && (
          <div className="policy-group">
            <h4>Risk Conditions</h4>
            
            {conditions.userRiskLevels && (
              <div className="policy-detail">
                <strong>User Risk:</strong>{' '}
                {Array.isArray(conditions.userRiskLevels) 
                  ? conditions.userRiskLevels.map((level: string) => (
                      <span key={level} className="badge badge--risk" style={{ marginLeft: '0.25rem' }}>
                        {level}
                      </span>
                    ))
                  : conditions.userRiskLevels}
              </div>
            )}
            
            {conditions.signInRiskLevels && (
              <div className="policy-detail">
                <strong>Sign-in Risk:</strong>{' '}
                {Array.isArray(conditions.signInRiskLevels) 
                  ? conditions.signInRiskLevels.map((level: string) => (
                      <span key={level} className="badge badge--risk" style={{ marginLeft: '0.25rem' }}>
                        {level}
                      </span>
                    ))
                  : conditions.signInRiskLevels}
              </div>
            )}

            {conditions.servicePrincipalRiskLevels && (
              <div className="policy-detail">
                <strong>Service Principal Risk:</strong>{' '}
                {Array.isArray(conditions.servicePrincipalRiskLevels) 
                  ? conditions.servicePrincipalRiskLevels.map((level: string) => (
                      <span key={level} className="badge badge--risk" style={{ marginLeft: '0.25rem' }}>
                        {level}
                      </span>
                    ))
                  : conditions.servicePrincipalRiskLevels}
              </div>
            )}

            {conditions.insiderRiskLevels?.configured && (
              <div className="policy-detail">
                <strong>Insider Risk (Purview):</strong>{' '}
                {Array.isArray(conditions.insiderRiskLevels.levels) 
                  ? conditions.insiderRiskLevels.levels.map((level: string) => (
                      <span key={level} className="badge badge--insider-risk" style={{ marginLeft: '0.25rem' }}>
                        {level}
                      </span>
                    ))
                  : conditions.insiderRiskLevels.levels}
              </div>
            )}
          </div>
        )}

        {/* Authentication Flows - only show if there are actual methods */}
        {conditions.authenticationFlows?.configured && 
         conditions.authenticationFlows.transferMethods && 
         Array.isArray(conditions.authenticationFlows.transferMethods) && 
         conditions.authenticationFlows.transferMethods.length > 0 && (
          <div className="policy-group">
            <h4>Authentication Flows</h4>
            <div className="policy-detail">
              <strong>Transfer Methods:</strong>{' '}
              {conditions.authenticationFlows.transferMethods.map((method: string) => (
                <span key={method} className="badge badge--auth-flow" style={{ marginLeft: '0.25rem' }}>
                  {method}
                </span>
              ))}
            </div>
          </div>
        )}

        {conditions.clientAppTypes && conditions.clientAppTypes !== 'all' && (
          <div className="policy-detail">
            <strong>Client App Types:</strong> {conditions.clientAppTypes}
          </div>
        )}

        {(conditions.platforms?.include || conditions.platforms?.exclude) && (
          <div className="policy-group">
            <h4>Device Platforms</h4>
            {conditions.platforms.include && (
              <div className="policy-detail">
                <strong>Include:</strong> {Array.isArray(conditions.platforms.include) ? conditions.platforms.include.join(', ') : conditions.platforms.include}
              </div>
            )}
            {conditions.platforms.exclude && (
              <div className="policy-detail">
                <strong>Exclude:</strong> {Array.isArray(conditions.platforms.exclude) ? conditions.platforms.exclude.join(', ') : conditions.platforms.exclude}
              </div>
            )}
          </div>
        )}

        {/* Device Filter - Enhanced Display - only show if there's an actual rule */}
        {conditions.deviceFilter?.configured && conditions.deviceFilter.rule && (
          <div className="policy-group">
            <h4>Device Filter</h4>
            <div className="policy-detail">
              <strong>Mode:</strong>{' '}
              <span className={`badge badge--${conditions.deviceFilter.mode === 'include' ? 'include' : 'exclude'}`}>
                {conditions.deviceFilter.mode || 'include'}
              </span>
            </div>
            <div className="policy-detail" style={{ marginTop: '0.5rem' }}>
              <strong>Filter Rule:</strong>
              <div style={{ 
                marginTop: '0.5rem', 
                padding: '0.75rem', 
                backgroundColor: '#1e1e1e', 
                borderRadius: '4px',
                fontFamily: 'monospace', 
                fontSize: '0.85rem', 
                color: '#d4d4d4',
                overflowX: 'auto'
              }}>
                {conditions.deviceFilter.rule}
              </div>
            </div>
          </div>
        )}

        {conditions.devices && (conditions.devices.include || conditions.devices.exclude || conditions.deviceStates) && (
          <div className="policy-group">
            <h4>Device States</h4>
            {(conditions.devices.include || conditions.deviceStates?.include) && (
              <div className="policy-detail">
                <strong>Include:</strong> {Array.isArray(conditions.devices.include || conditions.deviceStates?.include) 
                  ? (conditions.devices.include || conditions.deviceStates?.include).join(', ') 
                  : (conditions.devices.include || conditions.deviceStates?.include)}
              </div>
            )}
            {(conditions.devices.exclude || conditions.deviceStates?.exclude) && (
              <div className="policy-detail">
                <strong>Exclude:</strong> {Array.isArray(conditions.devices.exclude || conditions.deviceStates?.exclude) 
                  ? (conditions.devices.exclude || conditions.deviceStates?.exclude).join(', ') 
                  : (conditions.devices.exclude || conditions.deviceStates?.exclude)}
              </div>
            )}
          </div>
        )}

        {conditions.applications?.applicationFilter && (
          <div className="policy-group">
            <h4>Application Filter</h4>
            <div className="policy-detail">
              <strong>Mode:</strong> {conditions.applications.applicationFilter.mode || 'include'}
            </div>
            <div className="policy-detail">
              <strong>Rule:</strong> 
              <div style={{ marginTop: '0.5rem', fontFamily: 'monospace', fontSize: '0.85rem', color: '#a0a0a0' }}>
                {conditions.applications.applicationFilter.rule}
              </div>
            </div>
          </div>
        )}

        {/* Networks / Locations - Enhanced Display */}
        {conditions.locations && (
          <div className="policy-group">
            <h4>Networks / Locations</h4>
            
            {(conditions.locations.include?.entities?.length > 0 || conditions.locations.include?.keywords?.length > 0) && (
              <>
                <div style={{ marginTop: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>Include</div>
                <ul className="policy-list">
                  {conditions.locations.include.keywords?.map((kw: string) => {
                    let displayLabel = kw
                    let badgeClass = 'policy-badge--keyword'
                    if (kw === 'All') {
                      displayLabel = 'Any network location'
                    } else if (kw === 'AllTrusted') {
                      displayLabel = 'All trusted networks and locations'
                      badgeClass = 'policy-badge--trusted'
                    }
                    return (
                      <li key={kw}>
                        <span className={`policy-badge ${badgeClass}`}>Keyword</span>
                        <span className="policy-target policy-keyword">{displayLabel}</span>
                      </li>
                    )
                  })}
                  {conditions.locations.include.entities?.map((loc: any) => {
                    const isTrusted = loc.isTrusted
                    const locType = loc.type || 'namedLocation'
                    const typeLabel = locType === 'ipNamedLocation' ? 'IP-based' : locType === 'countryNamedLocation' ? 'Geography-based' : 'Named Location'
                    
                    return (
                      <li key={loc.id}>
                        <span className={`policy-badge ${isTrusted ? 'policy-badge--trusted' : 'policy-badge--untrusted'}`}>
                          {typeLabel}
                        </span>
                        <span className="policy-target">{loc.displayName || loc.id}</span>
                        {isTrusted !== undefined && (
                          <span className="policy-via">
                            {isTrusted ? 'Trusted' : 'Not Trusted'}
                          </span>
                        )}
                        {loc.ipRanges && loc.ipRanges.length > 0 && (
                          <span className="policy-via">
                            {loc.ipRanges.length} IP range{loc.ipRanges.length > 1 ? 's' : ''}
                          </span>
                        )}
                        {loc.countriesAndRegions && loc.countriesAndRegions.length > 0 && (
                          <span className="policy-via">
                            {loc.countriesAndRegions.length} region{loc.countriesAndRegions.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
            
            {(conditions.locations.exclude?.entities?.length > 0 || conditions.locations.exclude?.keywords?.length > 0) && (
              <>
                <div style={{ marginTop: '0.75rem', fontWeight: 600, fontSize: '0.9rem' }}>Exclude</div>
                <ul className="policy-list">
                  {conditions.locations.exclude.keywords?.map((kw: string) => {
                    let displayLabel = kw
                    let badgeClass = 'policy-badge--keyword'
                    if (kw === 'All') {
                      displayLabel = 'Any network location'
                    } else if (kw === 'AllTrusted') {
                      displayLabel = 'All trusted networks and locations'
                      badgeClass = 'policy-badge--trusted'
                    }
                    return (
                      <li key={kw}>
                        <span className={`policy-badge ${badgeClass}`}>Keyword</span>
                        <span className="policy-target policy-keyword">{displayLabel}</span>
                      </li>
                    )
                  })}
                  {conditions.locations.exclude.entities?.map((loc: any) => {
                    const isTrusted = loc.isTrusted
                    const locType = loc.type || 'namedLocation'
                    const typeLabel = locType === 'ipNamedLocation' ? 'IP-based' : locType === 'countryNamedLocation' ? 'Geography-based' : 'Named Location'
                    
                    return (
                      <li key={loc.id}>
                        <span className={`policy-badge ${isTrusted ? 'policy-badge--trusted' : 'policy-badge--untrusted'}`}>
                          {typeLabel}
                        </span>
                        <span className="policy-target">{loc.displayName || loc.id}</span>
                        {isTrusted !== undefined && (
                          <span className="policy-via">
                            {isTrusted ? 'Trusted' : 'Not Trusted'}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  // Helper to check if an object has any real properties (not just empty object or null values)
  const hasRealProperties = (obj: any): boolean => {
    if (!obj || typeof obj !== 'object') return false
    const keys = Object.keys(obj)
    if (keys.length === 0) return false
    // Check if any property has a non-null, non-undefined value
    return keys.some(key => {
      const val = obj[key]
      return val !== null && val !== undefined && (typeof val !== 'object' || Object.keys(val).length > 0)
    })
  }

  const renderSessionControls = () => {
    const session = getProp(policyData?.fullPolicy, 'accessControls.session')
    if (!session) return null

    // Check for actual configured session controls with real values
    const hasAnySession =
      (session.signInFrequency?.isEnabled === true) ||
      (session.persistentBrowser?.isEnabled === true) ||
      (session.applicationEnforcedRestrictions?.isEnabled === true) ||
      (session.cloudAppSecurity?.isEnabled === true) ||
      (session.continuousAccessEvaluation && hasRealProperties(session.continuousAccessEvaluation) && session.continuousAccessEvaluation.mode) ||
      (session.tokenProtection?.isEnabled === true) ||
      (session.secureSignInSession?.isEnabled === true) ||
      (session.globalSecureAccessSecurityProfile && hasRealProperties(session.globalSecureAccessSecurityProfile)) ||
      (session.networkAccess?.isEnabled === true) ||
      (session.disableResilienceDefaults === true)

    if (!hasAnySession) return null

    return (
      <div className="policy-section">
        <h3>Session Controls</h3>
        
        {/* Security Enhancements - only show if actually enabled */}
        {((session.continuousAccessEvaluation && hasRealProperties(session.continuousAccessEvaluation) && session.continuousAccessEvaluation.mode) || 
          session.tokenProtection?.isEnabled === true || 
          session.secureSignInSession?.isEnabled === true) && (
          <div className="policy-group">
            <h4>Security Enhancements</h4>
            
            {session.continuousAccessEvaluation && hasRealProperties(session.continuousAccessEvaluation) && session.continuousAccessEvaluation.mode && (
              <div className="policy-detail">
                <span className="badge badge--session-control">Continuous Access Evaluation (CAE)</span>
                <div style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#a0a0a0' }}>
                  Mode: <strong>{session.continuousAccessEvaluation.mode}</strong>
                </div>
              </div>
            )}
            
            {session.tokenProtection?.isEnabled === true && (
              <div className="policy-detail">
                <span className="badge badge--session-control">Token Protection</span>
                <div style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#a0a0a0' }}>
                  Phishing-resistant token binding enabled
                </div>
              </div>
            )}
            
            {session.secureSignInSession?.isEnabled === true && (
              <div className="policy-detail">
                <span className="badge badge--session-control">Secure Sign-in Session</span>
                <div style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#a0a0a0' }}>
                  Elevated session security enabled
                </div>
              </div>
            )}
          </div>
        )}

        {/* Network & Access - only show if actually enabled */}
        {(session.networkAccess?.isEnabled === true || 
          (session.globalSecureAccessSecurityProfile && hasRealProperties(session.globalSecureAccessSecurityProfile))) && (
          <div className="policy-group">
            <h4>Network & Access</h4>
            
            {session.networkAccess?.isEnabled === true && (
              <div className="policy-detail">
                <strong>Network Access:</strong>{' '}
                <span className="badge badge--network">
                  {session.networkAccess.networkAccessType || 'Configured'}
                </span>
              </div>
            )}
            
            {session.globalSecureAccessSecurityProfile && hasRealProperties(session.globalSecureAccessSecurityProfile) && (
              <div className="policy-detail">
                <span className="badge badge--session-control">Global Secure Access Security Profile</span>
                <div style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#a0a0a0' }}>
                  GSA integration enabled
                </div>
              </div>
            )}
          </div>
        )}

        {/* Session Behavior */}
        {(session.signInFrequency?.isEnabled === true || session.persistentBrowser?.isEnabled === true) && (
          <div className="policy-group">
            <h4>Session Behavior</h4>
            
            {session.signInFrequency?.isEnabled === true && (
              <div className="policy-detail">
                <strong>Sign-in Frequency:</strong>{' '}
                <span className="badge badge--frequency">
                  {session.signInFrequency.value} {session.signInFrequency.type}
                </span>
                {session.signInFrequency.authenticationType && (
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: '#a0a0a0' }}>
                    ({session.signInFrequency.authenticationType})
                  </span>
                )}
              </div>
            )}

            {session.persistentBrowser?.isEnabled === true && (
              <div className="policy-detail">
                <strong>Persistent Browser:</strong>{' '}
                <span className="badge badge--browser">
                  {session.persistentBrowser.mode || 'Enabled'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* App Controls */}
        {(session.applicationEnforcedRestrictions?.isEnabled === true || session.cloudAppSecurity?.isEnabled === true) && (
          <div className="policy-group">
            <h4>Application Controls</h4>
            
            {session.applicationEnforcedRestrictions?.isEnabled === true && (
              <div className="policy-detail">
                <span className="badge badge--app-control">Application Enforced Restrictions</span>
                <div style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#a0a0a0' }}>
                  App-level restrictions enabled
                </div>
              </div>
            )}

            {session.cloudAppSecurity?.isEnabled === true && (
              <div className="policy-detail">
                <strong>Conditional Access App Control:</strong>{' '}
                <span className="badge badge--app-control">
                  {session.cloudAppSecurity.cloudAppSecurityType || 'Enabled'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Other Settings */}
        {session.disableResilienceDefaults === true && (
          <div className="policy-detail" style={{ marginTop: '0.75rem' }}>
            <span className="badge badge--warning">Resilience Defaults Disabled</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <h2>{policyData.node.label}</h2>
            <span className={`badge badge--${policyData.state}`}>{policyData.state}</span>
          </div>
          <button onClick={onClose} className="modal__close" aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal__body">
          <div className="policy-metadata">
            <div className="policy-meta-item">
              <strong>Policy ID:</strong> <code>{policyData.node.id}</code>
            </div>
            {policyData.createdDateTime && (
              <div className="policy-meta-item">
                <strong>Created:</strong> {new Date(policyData.createdDateTime).toLocaleString()}
              </div>
            )}
            {policyData.modifiedDateTime && (
              <div className="policy-meta-item">
                <strong>Modified:</strong> {new Date(policyData.modifiedDateTime).toLocaleString()}
              </div>
            )}
          </div>

          {policyData.grantControls.length > 0 && (
            <div className="policy-section">
              <h3>Grant Controls</h3>
              <div className="policy-grants">
                {policyData.grantControls.map((gc) => (
                  <span key={gc} className="badge badge--grant">
                    {gc}
                  </span>
                ))}
              </div>
            </div>
          )}

          {renderUserAssignments('include')}
          {renderUserAssignments('exclude')}

          {renderGuestUsers()}
          {renderTargetResources()}
          {renderConditions()}
          {renderSessionControls()}

          <div className="policy-stats">
            <div className="policy-stat">
              <strong>Total Assignments:</strong> {policyData.edges.length}
            </div>
            <div className="policy-stat">
              <strong>Includes:</strong>{' '}
              {Array.from(policyData.includes.values()).reduce((sum, arr) => sum + arr.length, 0)}
            </div>
            <div className="policy-stat">
              <strong>Excludes:</strong>{' '}
              {Array.from(policyData.excludes.values()).reduce((sum, arr) => sum + arr.length, 0)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

