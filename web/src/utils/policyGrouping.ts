import type { GraphNode } from '../types/graph'

export type ConditionType =
  | 'userRisk'
  | 'signInRisk'
  | 'servicePrincipalRisk'
  | 'devicePlatform'
  | 'clientAppType'
  | 'location'
  | 'guestOrExternal'

export interface PolicyGroup {
  key: string
  label: string
  policies: GraphNode[]
  count: number
}

// Grant control labels
export const GRANT_CONTROL_LABELS: Record<string, string> = {
  mfa: 'Multi-Factor Authentication',
  block: 'Block Access',
  compliantDevice: 'Compliant Device Required',
  domainJoinedDevice: 'Domain-Joined Device Required',
  passwordChange: 'Password Change Required',
  approvedApplication: 'Approved Application Required',
  authStrength: 'Authentication Strength',
  '(none)': 'No Grant Control'
}

// Condition type labels
export const CONDITION_LABELS: Record<ConditionType, string> = {
  userRisk: 'User Risk Level',
  signInRisk: 'Sign-In Risk Level',
  servicePrincipalRisk: 'Service Principal Risk',
  devicePlatform: 'Device Platform',
  clientAppType: 'Client App Type',
  location: 'Location/Network',
  guestOrExternal: 'Guest/External Users'
}

/**
 * Group policies by grant control type
 */
export function groupByGrantControl(policies: GraphNode[]): PolicyGroup[] {
  const groups = new Map<string, GraphNode[]>()

  for (const policy of policies) {
    const grantControls = Array.isArray(policy.properties?.grantControls)
      ? (policy.properties?.grantControls as string[])
      : []

    if (grantControls.length === 0) {
      if (!groups.has('(none)')) groups.set('(none)', [])
      groups.get('(none)')!.push(policy)
    } else {
      for (const gc of grantControls) {
        const key = String(gc).toLowerCase()
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(policy)
      }
    }
  }

  const result: PolicyGroup[] = []
  for (const [key, pols] of groups.entries()) {
    result.push({
      key,
      label: GRANT_CONTROL_LABELS[key] || key,
      policies: pols,
      count: pols.length
    })
  }

  // Sort by count descending, then by label
  result.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.label.localeCompare(b.label)
  })

  return result
}

/**
 * Group policies by condition type
 */
export function groupByCondition(policies: GraphNode[]): Map<ConditionType, PolicyGroup> {
  const groups = new Map<ConditionType, GraphNode[]>()

  for (const policy of policies) {
    const conditions = policy.properties?.conditions as any

    if (!conditions) continue

    // User Risk
    const userRiskLevels = conditions.userRiskLevels || []
    if (Array.isArray(userRiskLevels) && userRiskLevels.length > 0) {
      if (!groups.has('userRisk')) groups.set('userRisk', [])
      groups.get('userRisk')!.push(policy)
    }

    // Sign-In Risk
    const signInRiskLevels = conditions.signInRiskLevels || []
    if (Array.isArray(signInRiskLevels) && signInRiskLevels.length > 0) {
      if (!groups.has('signInRisk')) groups.set('signInRisk', [])
      groups.get('signInRisk')!.push(policy)
    }

    // Service Principal Risk
    const spRiskLevels = conditions.servicePrincipalRiskLevels || []
    if (Array.isArray(spRiskLevels) && spRiskLevels.length > 0) {
      if (!groups.has('servicePrincipalRisk')) groups.set('servicePrincipalRisk', [])
      groups.get('servicePrincipalRisk')!.push(policy)
    }

    // Device Platform
    const platforms = conditions.platforms
    if (platforms && (platforms.includePlatforms?.length > 0 || platforms.excludePlatforms?.length > 0)) {
      if (!groups.has('devicePlatform')) groups.set('devicePlatform', [])
      groups.get('devicePlatform')!.push(policy)
    }

    // Client App Type
    const clientAppTypes = conditions.clientAppTypes || []
    if (Array.isArray(clientAppTypes) && clientAppTypes.length > 0 && !clientAppTypes.includes('all')) {
      if (!groups.has('clientAppType')) groups.set('clientAppType', [])
      groups.get('clientAppType')!.push(policy)
    }

    // Location
    const locations = conditions.locations
    if (locations && (locations.includeLocations || locations.excludeLocations)) {
      if (!groups.has('location')) groups.set('location', [])
      groups.get('location')!.push(policy)
    }

    // Guest/External Users
    const users = conditions.users
    if (users) {
      const includeGuests = users.includeGuestsOrExternalUsers
      const excludeGuests = users.excludeGuestsOrExternalUsers
      if (
        (includeGuests && includeGuests.guestOrExternalUserTypes) ||
        (excludeGuests && excludeGuests.guestOrExternalUserTypes)
      ) {
        if (!groups.has('guestOrExternal')) groups.set('guestOrExternal', [])
        groups.get('guestOrExternal')!.push(policy)
      }
    }
  }

  const result = new Map<ConditionType, PolicyGroup>()
  for (const [type, pols] of groups.entries()) {
    result.set(type, {
      key: type,
      label: CONDITION_LABELS[type],
      policies: pols,
      count: pols.length
    })
  }

  return result
}

/**
 * Get human-readable summary of conditions for a policy
 */
export function getConditionSummary(policy: GraphNode): string[] {
  const summary: string[] = []
  const conditions = policy.properties?.conditions as any

  if (!conditions) return summary

  // User Risk
  const userRiskLevels = conditions.userRiskLevels || []
  if (userRiskLevels.length > 0) {
    summary.push(`User Risk: ${userRiskLevels.join(', ')}`)
  }

  // Sign-In Risk
  const signInRiskLevels = conditions.signInRiskLevels || []
  if (signInRiskLevels.length > 0) {
    summary.push(`Sign-In Risk: ${signInRiskLevels.join(', ')}`)
  }

  // Device Platform
  const platforms = conditions.platforms
  if (platforms) {
    if (platforms.includePlatforms?.length > 0) {
      summary.push(`Platforms: ${platforms.includePlatforms.join(', ')}`)
    }
    if (platforms.excludePlatforms?.length > 0) {
      summary.push(`Exclude Platforms: ${platforms.excludePlatforms.join(', ')}`)
    }
  }

  // Client App Types
  const clientAppTypes = conditions.clientAppTypes || []
  if (clientAppTypes.length > 0 && !clientAppTypes.includes('all')) {
    summary.push(`Client Apps: ${clientAppTypes.join(', ')}`)
  }

  // Locations
  const locations = conditions.locations
  if (locations) {
    if (locations.includeLocations) {
      summary.push(`Include Locations: ${JSON.stringify(locations.includeLocations)}`)
    }
    if (locations.excludeLocations) {
      summary.push(`Exclude Locations: ${JSON.stringify(locations.excludeLocations)}`)
    }
  }

  return summary
}

/**
 * Get human-readable summary of grant controls for a policy
 */
export function getGrantControlSummary(policy: GraphNode): string[] {
  const grantControls = Array.isArray(policy.properties?.grantControls)
    ? (policy.properties?.grantControls as string[])
    : []

  return grantControls.map((gc) => GRANT_CONTROL_LABELS[String(gc).toLowerCase()] || String(gc))
}

