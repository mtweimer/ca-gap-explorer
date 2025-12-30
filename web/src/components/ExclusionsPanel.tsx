import { useMemo } from 'react'
import type { GraphData } from '../types/graph'
import './ExclusionsPanel.css'

type ExclusionsPanelProps = {
  graphData: GraphData
  selectedPolicyIds: Set<string>
}

type ExclusionSummary = {
  users: Array<{ id: string; displayName: string; policyId: string; policyName: string }>
  groups: Array<{ id: string; displayName: string; memberCount: number; policyId: string; policyName: string }>
  roles: Array<{ id: string; displayName: string; memberCount: number; policyId: string; policyName: string }>
}

export function ExclusionsPanel({ graphData, selectedPolicyIds }: ExclusionsPanelProps) {
  const exclusions = useMemo(() => {
    const result: ExclusionSummary = {
      users: [],
      groups: [],
      roles: []
    }

    const policies = graphData.nodes.filter((n) => n.type === 'policy' && selectedPolicyIds.has(n.id))

    for (const policy of policies) {
      const assignments = policy.properties?.assignments as any
      if (!assignments?.exclude) continue

      // Excluded users (top-level only, don't include group/role members)
      const excludedUsers = assignments.exclude?.users?.entities || []
      for (const user of excludedUsers) {
        if (user.id && user.displayName) {
          result.users.push({
            id: user.id,
            displayName: user.displayName,
            policyId: policy.id,
            policyName: policy.label || policy.id
          })
        }
      }

      // Excluded groups
      const excludedGroups = assignments.exclude?.groups?.entities || []
      for (const group of excludedGroups) {
        if (group.id && group.displayName) {
          result.groups.push({
            id: group.id,
            displayName: group.displayName,
            memberCount: group.memberCount || group.members?.length || 0,
            policyId: policy.id,
            policyName: policy.label || policy.id
          })
        }
      }

      // Excluded roles
      const excludedRoles = assignments.exclude?.roles?.entities || []
      for (const role of excludedRoles) {
        if (role.id && role.displayName) {
          result.roles.push({
            id: role.id,
            displayName: role.displayName,
            memberCount: role.memberCount || role.members?.length || 0,
            policyId: policy.id,
            policyName: policy.label || policy.id
          })
        }
      }
    }

    return result
  }, [graphData, selectedPolicyIds])

  const totalExcluded = exclusions.users.length + exclusions.groups.length + exclusions.roles.length
  
  // Calculate total users excluded (direct + from groups + from roles)
  const totalUsersExcluded = useMemo(() => {
    const directUsers = exclusions.users.length
    const usersFromGroups = exclusions.groups.reduce((sum, g) => sum + g.memberCount, 0)
    const usersFromRoles = exclusions.roles.reduce((sum, r) => sum + r.memberCount, 0)
    return directUsers + usersFromGroups + usersFromRoles
  }, [exclusions])

  if (totalExcluded === 0) {
    return (
      <div className="exclusions-panel">
        <h4>Exclusions Summary</h4>
        <p className="exclusions-panel__empty">No exclusions in selected policies</p>
      </div>
    )
  }

  return (
    <div className="exclusions-panel">
      <h4>Exclusions Summary</h4>
      <p className="exclusions-panel__summary">
        <strong>{totalUsersExcluded}</strong> total users excluded ({exclusions.users.length} direct,{' '}
        {exclusions.groups.length} groups, {exclusions.roles.length} roles)
      </p>

      {exclusions.users.length > 0 && (
        <div className="exclusions-panel__section">
          <h5>Excluded Users ({exclusions.users.length})</h5>
          <ul className="exclusions-panel__list">
            {exclusions.users.slice(0, 10).map((user) => (
              <li key={`${user.policyId}-${user.id}`}>
                <span className="exclusions-panel__name">{user.displayName}</span>
                <span className="exclusions-panel__policy">{user.policyName}</span>
              </li>
            ))}
            {exclusions.users.length > 10 && (
              <li className="exclusions-panel__more">+ {exclusions.users.length - 10} more</li>
            )}
          </ul>
        </div>
      )}

      {exclusions.groups.length > 0 && (
        <div className="exclusions-panel__section">
          <h5>Excluded Groups ({exclusions.groups.length})</h5>
          <ul className="exclusions-panel__list">
            {exclusions.groups.slice(0, 10).map((group) => (
              <li key={`${group.policyId}-${group.id}`}>
                <span className="exclusions-panel__name">
                  {group.displayName} <span className="exclusions-panel__count">({group.memberCount} members)</span>
                </span>
                <span className="exclusions-panel__policy">{group.policyName}</span>
              </li>
            ))}
            {exclusions.groups.length > 10 && (
              <li className="exclusions-panel__more">+ {exclusions.groups.length - 10} more</li>
            )}
          </ul>
        </div>
      )}

      {exclusions.roles.length > 0 && (
        <div className="exclusions-panel__section">
          <h5>Excluded Roles ({exclusions.roles.length})</h5>
          <ul className="exclusions-panel__list">
            {exclusions.roles.slice(0, 10).map((role) => (
              <li key={`${role.policyId}-${role.id}`}>
                <span className="exclusions-panel__name">
                  {role.displayName} <span className="exclusions-panel__count">({role.memberCount} members)</span>
                </span>
                <span className="exclusions-panel__policy">{role.policyName}</span>
              </li>
            ))}
            {exclusions.roles.length > 10 && (
              <li className="exclusions-panel__more">+ {exclusions.roles.length - 10} more</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

