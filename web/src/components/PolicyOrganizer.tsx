import { useMemo } from 'react'
import type { GraphNode } from '../types/graph'
import './PolicyOrganizer.css'

type PolicyOrganizerProps = {
  policies: GraphNode[]
  onShowDetails?: (policyId: string) => void
}

type PolicyGrouping = {
  grantControls: string[]
  conditions: string[]
  policyCount: number
  policies: Array<{
    id: string
    label: string
    state: string
    stateLabel: string
  }>
}

export function PolicyOrganizer({ policies, onShowDetails }: PolicyOrganizerProps) {
  const groupings = useMemo(() => {
    const groups = new Map<string, PolicyGrouping>()

    for (const policy of policies) {
      // Extract grant controls
      const grantControls = (policy.properties?.grantControls as string[]) || []
      
      // Extract conditions
      const conditions = policy.properties?.conditions as any
      const conditionsList: string[] = []
      
      if (conditions) {
        if (conditions.userRiskLevels?.length > 0) conditionsList.push('User Risk')
        if (conditions.signInRiskLevels?.length > 0) conditionsList.push('Sign-In Risk')
        if (conditions.servicePrincipalRiskLevels?.length > 0) conditionsList.push('Service Principal Risk')
        if (conditions.insiderRiskLevels?.length > 0) conditionsList.push('Insider Risk')
        if (conditions.platforms?.includePlatforms?.length > 0 || conditions.platforms?.excludePlatforms?.length > 0) {
          conditionsList.push('Device Platform')
        }
        if (conditions.clientAppTypes?.length > 0 && !conditions.clientAppTypes.includes('all')) {
          conditionsList.push('Client App Type')
        }
        if (conditions.devices?.includeDeviceStates?.length > 0 || conditions.devices?.excludeDeviceStates?.length > 0) {
          conditionsList.push('Device State')
        }
        if (conditions.devices?.deviceFilter) {
          conditionsList.push('Device Filter')
        }
        if (conditions.locations?.include || conditions.locations?.exclude) {
          conditionsList.push('Location')
        }
        if (conditions.authenticationContextClassReferences?.length > 0) {
          conditionsList.push('Auth Context')
        }
        if (conditions.applications?.applicationFilter) {
          conditionsList.push('App Filter')
        }
      }

      // Create a unique key for this combination
      const key = `${grantControls.sort().join(',')}|${conditionsList.sort().join(',')}`
      
      if (!groups.has(key)) {
        groups.set(key, {
          grantControls,
          conditions: conditionsList,
          policyCount: 0,
          policies: []
        })
      }

      const group = groups.get(key)!
      group.policyCount++
      
      const state = (policy.properties?.state as string) || 'unknown'
      let stateLabel = state
      if (state === 'enabled') stateLabel = 'Enabled'
      else if (state === 'enabledForReportingButNotEnforced') stateLabel = 'Report Only'
      else if (state === 'disabled') stateLabel = 'Disabled'
      
      group.policies.push({
        id: policy.id,
        label: policy.label || policy.id,
        state,
        stateLabel
      })
    }

    // Sort by policy count (descending)
    return Array.from(groups.values()).sort((a, b) => b.policyCount - a.policyCount)
  }, [policies])

  if (policies.length === 0) {
    return (
      <div className="policy-organizer">
        <h2>Policy Organization</h2>
        <p className="policy-organizer__empty">No policies selected</p>
      </div>
    )
  }

  return (
    <div className="policy-organizer">
      <h2>Policy Organization</h2>
      <p className="policy-organizer__subtitle">
        {policies.length} {policies.length === 1 ? 'policy' : 'policies'} grouped by controls & conditions
      </p>

      {groupings.map((group, idx) => (
        <div key={idx} className="policy-organizer__group">
          <div className="policy-organizer__group-header">
            <div className="policy-organizer__labels">
              {group.grantControls.length > 0 ? (
                <div className="policy-organizer__section">
                  <strong>Grant Controls:</strong>
                  <div className="policy-organizer__tags">
                    {group.grantControls.map((gc) => (
                      <span key={gc} className="policy-organizer__tag policy-organizer__tag--grant">
                        {gc}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="policy-organizer__section">
                  <strong>Grant Controls:</strong> <span className="policy-organizer__none">None</span>
                </div>
              )}
              {group.conditions.length > 0 ? (
                <div className="policy-organizer__section">
                  <strong>Conditions:</strong>
                  <div className="policy-organizer__tags">
                    {group.conditions.map((cond) => (
                      <span key={cond} className="policy-organizer__tag policy-organizer__tag--condition">
                        {cond}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="policy-organizer__section">
                  <strong>Conditions:</strong> <span className="policy-organizer__none">None</span>
                </div>
              )}
            </div>
          </div>

          <ul className="policy-organizer__policies">
            {group.policies.map((pol) => (
              <li
                key={pol.id}
                className="policy-organizer__policy"
                onClick={() => onShowDetails?.(pol.id)}
              >
                <div className="policy-organizer__policy-name">{pol.label}</div>
                <span className={`policy-organizer__state policy-organizer__state--${pol.state}`}>
                  {pol.stateLabel}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

