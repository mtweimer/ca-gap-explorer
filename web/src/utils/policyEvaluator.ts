/**
 * Policy Evaluator - Implements CA Policy Matching Algorithm
 * 
 * Based on Microsoft's documented evaluation logic:
 * 1. Compute match set: policies where user is included AND not excluded
 * 2. Resource is included AND not excluded  
 * 3. Conditions match (AND semantics for conditions inside the policy)
 * 4. If any matched policy has Block => decision = Block
 * 5. Otherwise aggregate grant requirements (AND across policies)
 */

import type { GraphData } from '../types/graph'

// ============================================================================
// Types
// ============================================================================

export type UserType = 'member' | 'guest' | 'external' | 'all'
export type LocationType = 'trusted' | 'untrusted' | 'banned' | 'all' | string
export type DevicePlatform = 'windows' | 'macOS' | 'iOS' | 'android' | 'linux' | 'all'
export type DeviceCompliance = 'compliant' | 'hybridJoined' | 'registered' | 'unmanaged' | 'all'
export type ClientAppType = 'browser' | 'mobileDesktop' | 'legacy' | 'all'
export type RiskLevel = 'high' | 'medium' | 'low' | 'none'

export interface WhatIfInput {
  userId?: string
  userGroups?: string[]
  userRoles?: string[]
  userType?: UserType
  applicationId?: string
  applicationName?: string
  location?: LocationType
  locationId?: string
  locationName?: string
  devicePlatform?: DevicePlatform
  deviceCompliance?: DeviceCompliance
  clientApp?: ClientAppType
  signInRisk?: RiskLevel
  userRisk?: RiskLevel
}

export interface PolicyMatch {
  policyId: string
  policyName: string
  policyState: string
  matchReason: string[]
  excluded: boolean
  excludeReason?: string
  conditionsMatched: string[]
  conditionsNotMatched: string[]
  grantControls: string[]
  grantOperator: 'AND' | 'OR'
  sessionControls: string[]
  authenticationStrength?: string
  isBlocking: boolean
  locationConfig?: LocationConfig
}

export interface LocationConfig {
  includesAll: boolean
  includedLocations: string[]
  excludedLocations: string[]
  grantControl: string
  interpretation: string
}

export interface GapFinding {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: 'coverage' | 'legacy' | 'location' | 'device' | 'risk' | 'guest' | 'app'
  title: string
  description: string
  recommendation: string
  affectedScenario: Partial<WhatIfInput>
}

export interface WhatIfResult {
  input: WhatIfInput
  matchingPolicies: PolicyMatch[]
  excludedPolicies: PolicyMatch[]
  finalDecision: 'block' | 'grant' | 'noPolicy'
  requiredControls: string[]
  sessionControls: string[]
  authenticationStrength?: string
  gaps: GapFinding[]
  summary: string
}

// ============================================================================
// Policy Parsing Helpers
// ============================================================================

interface RawPolicy {
  id: string
  displayName: string
  state: string
  assignments?: {
    include?: {
      users?: { entities?: any[]; keywords?: string[] }
      groups?: { entities?: any[]; keywords?: string[] }
      roles?: { entities?: any[]; keywords?: string[] }
    }
    exclude?: {
      users?: { entities?: any[]; keywords?: string[] }
      groups?: { entities?: any[]; keywords?: string[] }
      roles?: { entities?: any[]; keywords?: string[] }
    }
  }
  targetResources?: {
    applications?: {
      include?: { entities?: any[]; keywords?: string[] }
      exclude?: { entities?: any[]; keywords?: string[] }
    }
  }
  conditions?: {
    clientAppTypes?: string | string[]
    platforms?: { include?: string[]; exclude?: string[] }
    signInRiskLevels?: string[]
    userRiskLevels?: string[]
    locations?: {
      include?: { entities?: any[]; keywords?: string[] }
      exclude?: { entities?: any[]; keywords?: string[] }
    }
  }
  accessControls?: {
    grant?: {
      operator?: string
      builtInControls?: string | string[]
      authenticationStrength?: { displayName?: string }
    }
    session?: {
      signInFrequency?: { isEnabled?: boolean; value?: number; type?: string }
      persistentBrowser?: { isEnabled?: boolean; mode?: string }
    }
  }
}

function hasKeyword(collection: { keywords?: string[] } | undefined, keyword: string): boolean {
  if (!collection?.keywords) return false
  return collection.keywords.some(k => k.toLowerCase() === keyword.toLowerCase())
}

function hasEntityId(collection: { entities?: any[] } | undefined, id: string): boolean {
  if (!collection?.entities) return false
  return collection.entities.some((e: any) => e.id === id)
}

function getEntityIds(collection: { entities?: any[] } | undefined): string[] {
  if (!collection?.entities) return []
  return collection.entities.map((e: any) => e.id)
}

function getEntityNames(collection: { entities?: any[] } | undefined): string[] {
  if (!collection?.entities) return []
  return collection.entities.map((e: any) => e.displayName || e.id)
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

// ============================================================================
// Policy Matching Logic
// ============================================================================

function checkUserAssignment(
  policy: RawPolicy,
  input: WhatIfInput
): { included: boolean; excluded: boolean; reason: string[] } {
  const include = policy.assignments?.include
  const exclude = policy.assignments?.exclude
  const reason: string[] = []
  
  // Check if user is in include set
  let included = false
  
  // "All" keyword
  if (hasKeyword(include?.users, 'All')) {
    included = true
    reason.push('User matches "All Users"')
  }
  
  // Specific user ID
  if (input.userId && hasEntityId(include?.users, input.userId)) {
    included = true
    reason.push('User explicitly included')
  }
  
  // User groups
  if (input.userGroups?.length) {
    const includedGroupIds = getEntityIds(include?.groups)
    const matchingGroups = input.userGroups.filter(g => includedGroupIds.includes(g))
    if (matchingGroups.length > 0) {
      included = true
      reason.push(`User in included group(s)`)
    }
  }
  
  // User roles
  if (input.userRoles?.length) {
    const includedRoleIds = getEntityIds(include?.roles)
    const matchingRoles = input.userRoles.filter(r => includedRoleIds.includes(r))
    if (matchingRoles.length > 0) {
      included = true
      reason.push(`User has included role(s)`)
    }
  }
  
  // Guest/External user handling
  if (hasKeyword(include?.users, 'GuestsOrExternalUsers')) {
    if (input.userType === 'guest' || input.userType === 'external') {
      included = true
      reason.push('User is guest/external')
    }
  }
  
  // If nothing explicitly includes the user and there's no "All" keyword, not included
  if (!included) {
    return { included: false, excluded: false, reason: ['User not in policy scope'] }
  }
  
  // Check if user is excluded
  let excluded = false
  
  if (input.userId && hasEntityId(exclude?.users, input.userId)) {
    excluded = true
    reason.push('User explicitly excluded')
  }
  
  if (input.userGroups?.length) {
    const excludedGroupIds = getEntityIds(exclude?.groups)
    const matchingGroups = input.userGroups.filter(g => excludedGroupIds.includes(g))
    if (matchingGroups.length > 0) {
      excluded = true
      reason.push(`User in excluded group(s)`)
    }
  }
  
  if (input.userRoles?.length) {
    const excludedRoleIds = getEntityIds(exclude?.roles)
    const matchingRoles = input.userRoles.filter(r => excludedRoleIds.includes(r))
    if (matchingRoles.length > 0) {
      excluded = true
      reason.push(`User has excluded role(s)`)
    }
  }
  
  return { included, excluded, reason }
}

function checkApplicationAssignment(
  policy: RawPolicy,
  input: WhatIfInput
): { included: boolean; excluded: boolean; reason: string[] } {
  const include = policy.targetResources?.applications?.include
  const exclude = policy.targetResources?.applications?.exclude
  const reason: string[] = []
  
  let included = false
  
  // "All" keyword for applications
  if (hasKeyword(include, 'All')) {
    included = true
    reason.push('Applies to "All Applications"')
  }
  
  // Specific application
  if (input.applicationId && hasEntityId(include, input.applicationId)) {
    included = true
    reason.push('Application explicitly included')
  }
  
  if (!included) {
    return { included: false, excluded: false, reason: ['Application not in policy scope'] }
  }
  
  // Check exclusions
  let excluded = false
  if (input.applicationId && hasEntityId(exclude, input.applicationId)) {
    excluded = true
    reason.push('Application explicitly excluded')
  }
  
  return { included, excluded, reason }
}

function checkLocationCondition(
  policy: RawPolicy,
  input: WhatIfInput
): { matches: boolean; reason: string; config: LocationConfig } {
  const locations = policy.conditions?.locations
  const includeLocations = locations?.include
  const excludeLocations = locations?.exclude
  
  const includesAll = hasKeyword(includeLocations, 'All')
  const includedLocationNames = getEntityNames(includeLocations)
  const excludedLocationNames = getEntityNames(excludeLocations)
  const grantControl = toArray(policy.accessControls?.grant?.builtInControls)[0] || 'unknown'
  
  // Build interpretation
  let interpretation = ''
  
  // No location condition = applies to ALL locations
  const hasNoLocationCondition = 
    (!includeLocations?.keywords?.length && !includeLocations?.entities?.length) &&
    (!excludeLocations?.keywords?.length && !excludeLocations?.entities?.length)
  
  if (hasNoLocationCondition) {
    interpretation = `Applies from ALL locations → ${grantControl.toUpperCase()}`
    return {
      matches: true,
      reason: 'No location restriction',
      config: {
        includesAll: true,
        includedLocations: [],
        excludedLocations: [],
        grantControl,
        interpretation
      }
    }
  }
  
  // Include All + Exclude specific = Control everywhere EXCEPT excluded
  if (includesAll && excludedLocationNames.length > 0) {
    interpretation = `${grantControl.toUpperCase()} from everywhere EXCEPT: ${excludedLocationNames.join(', ')} (exempt)`
    
    // Check if current location is excluded
    if (input.locationId) {
      const excludedIds = getEntityIds(excludeLocations)
      if (excludedIds.includes(input.locationId)) {
        return {
          matches: false,
          reason: `Location "${input.locationName || input.locationId}" is excluded (exempt from control)`,
          config: {
            includesAll: true,
            includedLocations: ['All'],
            excludedLocations: excludedLocationNames,
            grantControl,
            interpretation
          }
        }
      }
    }
    
    // Check by location type/name
    if (input.location === 'trusted') {
      const hasTrustedExcluded = excludedLocationNames.some(n => 
        n.toLowerCase().includes('trusted') || 
        n.toLowerCase().includes('corporate')
      )
      if (hasTrustedExcluded) {
        return {
          matches: false,
          reason: `Trusted location is excluded (exempt from control)`,
          config: {
            includesAll: true,
            includedLocations: ['All'],
            excludedLocations: excludedLocationNames,
            grantControl,
            interpretation
          }
        }
      }
    }
    
    return {
      matches: true,
      reason: `Location not excluded, control applies`,
      config: {
        includesAll: true,
        includedLocations: ['All'],
        excludedLocations: excludedLocationNames,
        grantControl,
        interpretation
      }
    }
  }
  
  // Include specific locations only (e.g., Banned Countries)
  if (includedLocationNames.length > 0 && !includesAll) {
    interpretation = `${grantControl.toUpperCase()} ONLY from: ${includedLocationNames.join(', ')}`
    
    // Check if current location is in the include list
    if (input.locationId) {
      const includedIds = getEntityIds(includeLocations)
      if (includedIds.includes(input.locationId)) {
        return {
          matches: true,
          reason: `Location "${input.locationName || input.locationId}" is in included locations`,
          config: {
            includesAll: false,
            includedLocations: includedLocationNames,
            excludedLocations: excludedLocationNames,
            grantControl,
            interpretation
          }
        }
      }
    }
    
    // Check by location name match
    if (input.locationName) {
      const locationMatches = includedLocationNames.some(n => 
        n.toLowerCase() === input.locationName?.toLowerCase()
      )
      if (locationMatches) {
        return {
          matches: true,
          reason: `Location "${input.locationName}" matches included location`,
          config: {
            includesAll: false,
            includedLocations: includedLocationNames,
            excludedLocations: excludedLocationNames,
            grantControl,
            interpretation
          }
        }
      }
    }
    
    // Check by location type (banned, trusted, etc.)
    if (input.location === 'banned') {
      const hasBannedIncluded = includedLocationNames.some(n => 
        n.toLowerCase().includes('banned') || 
        n.toLowerCase().includes('block')
      )
      if (hasBannedIncluded) {
        return {
          matches: true,
          reason: `Banned location matches policy`,
          config: {
            includesAll: false,
            includedLocations: includedLocationNames,
            excludedLocations: excludedLocationNames,
            grantControl,
            interpretation
          }
        }
      }
    }
    
    return {
      matches: false,
      reason: `Location not in included list: ${includedLocationNames.join(', ')}`,
      config: {
        includesAll: false,
        includedLocations: includedLocationNames,
        excludedLocations: excludedLocationNames,
        grantControl,
        interpretation
      }
    }
  }
  
  // Include All with no exclusions
  if (includesAll) {
    interpretation = `${grantControl.toUpperCase()} from ALL locations`
    return {
      matches: true,
      reason: 'Applies to all locations',
      config: {
        includesAll: true,
        includedLocations: ['All'],
        excludedLocations: [],
        grantControl,
        interpretation
      }
    }
  }
  
  // Default: no location condition
  return {
    matches: true,
    reason: 'No location restriction',
    config: {
      includesAll: true,
      includedLocations: [],
      excludedLocations: [],
      grantControl,
      interpretation: `Applies from ALL locations → ${grantControl.toUpperCase()}`
    }
  }
}

function checkClientAppCondition(
  policy: RawPolicy,
  input: WhatIfInput
): { matches: boolean; reason: string } {
  const clientAppTypes = policy.conditions?.clientAppTypes
  
  // "all" or not specified = matches all client apps
  if (!clientAppTypes || clientAppTypes === 'all') {
    return { matches: true, reason: 'Applies to all client apps' }
  }
  
  const appTypes = toArray(clientAppTypes)
  
  // Legacy auth check
  const isLegacyPolicy = appTypes.some(t => 
    t === 'exchangeActiveSync' || t === 'other'
  )
  
  if (isLegacyPolicy) {
    if (input.clientApp === 'legacy') {
      return { matches: true, reason: 'Client app matches legacy auth policy' }
    }
    return { matches: false, reason: 'Policy targets legacy auth, client is modern' }
  }
  
  // Browser check
  if (appTypes.includes('browser') && input.clientApp === 'browser') {
    return { matches: true, reason: 'Client app matches browser condition' }
  }
  
  // Mobile/Desktop check
  if (appTypes.includes('mobileAppsAndDesktopClients') && input.clientApp === 'mobileDesktop') {
    return { matches: true, reason: 'Client app matches mobile/desktop condition' }
  }
  
  // If input is 'all', it matches any specific condition
  if (input.clientApp === 'all') {
    return { matches: true, reason: 'Client app matches (all types)' }
  }
  
  return { matches: false, reason: `Client app "${input.clientApp}" not in policy scope` }
}

function checkPlatformCondition(
  policy: RawPolicy,
  input: WhatIfInput
): { matches: boolean; reason: string } {
  const platforms = policy.conditions?.platforms
  
  // No platform condition = applies to all
  if (!platforms?.include?.length && !platforms?.exclude?.length) {
    return { matches: true, reason: 'Applies to all platforms' }
  }
  
  // Check exclusions first
  if (platforms?.exclude?.length && input.devicePlatform !== 'all') {
    const excludedPlatforms = platforms.exclude.map(p => p.toLowerCase())
    if (excludedPlatforms.includes(input.devicePlatform?.toLowerCase() || '')) {
      return { matches: false, reason: `Platform "${input.devicePlatform}" is excluded` }
    }
  }
  
  // Check inclusions
  if (platforms?.include?.length) {
    if (input.devicePlatform === 'all') {
      return { matches: true, reason: 'Platform matches (all types)' }
    }
    const includedPlatforms = platforms.include.map(p => p.toLowerCase())
    if (includedPlatforms.includes(input.devicePlatform?.toLowerCase() || '')) {
      return { matches: true, reason: `Platform "${input.devicePlatform}" is included` }
    }
    if (includedPlatforms.includes('all')) {
      return { matches: true, reason: 'Applies to all platforms' }
    }
    return { matches: false, reason: `Platform "${input.devicePlatform}" not in included list` }
  }
  
  return { matches: true, reason: 'Applies to all platforms' }
}

function checkRiskCondition(
  policy: RawPolicy,
  input: WhatIfInput
): { matches: boolean; reason: string } {
  const signInRiskLevels = policy.conditions?.signInRiskLevels
  const userRiskLevels = policy.conditions?.userRiskLevels
  
  // No risk condition = applies regardless of risk
  if (!signInRiskLevels?.length && !userRiskLevels?.length) {
    return { matches: true, reason: 'No risk condition' }
  }
  
  // Check sign-in risk
  if (signInRiskLevels?.length) {
    if (input.signInRisk && input.signInRisk !== 'none') {
      if (signInRiskLevels.includes(input.signInRisk)) {
        return { matches: true, reason: `Sign-in risk "${input.signInRisk}" matches` }
      }
      return { matches: false, reason: `Sign-in risk "${input.signInRisk}" not in policy scope` }
    }
    // Policy requires risk but input has no risk
    return { matches: false, reason: 'Policy requires sign-in risk but none detected' }
  }
  
  // Check user risk
  if (userRiskLevels?.length) {
    if (input.userRisk && input.userRisk !== 'none') {
      if (userRiskLevels.includes(input.userRisk)) {
        return { matches: true, reason: `User risk "${input.userRisk}" matches` }
      }
      return { matches: false, reason: `User risk "${input.userRisk}" not in policy scope` }
    }
    return { matches: false, reason: 'Policy requires user risk but none detected' }
  }
  
  return { matches: true, reason: 'Risk conditions match' }
}

function extractGrantControls(policy: RawPolicy): {
  controls: string[]
  operator: 'AND' | 'OR'
  isBlocking: boolean
  authStrength?: string
} {
  const grant = policy.accessControls?.grant
  const controls = toArray(grant?.builtInControls)
  const operator = (grant?.operator?.toUpperCase() === 'AND' ? 'AND' : 'OR') as 'AND' | 'OR'
  const isBlocking = controls.includes('block')
  const authStrength = grant?.authenticationStrength?.displayName || undefined
  
  return { controls, operator, isBlocking, authStrength }
}

function extractSessionControls(policy: RawPolicy): string[] {
  const session = policy.accessControls?.session
  const controls: string[] = []
  
  if (session?.signInFrequency?.isEnabled) {
    controls.push(`Sign-in frequency: ${session.signInFrequency.value} ${session.signInFrequency.type}`)
  }
  
  if (session?.persistentBrowser?.isEnabled) {
    controls.push(`Persistent browser: ${session.persistentBrowser.mode}`)
  }
  
  return controls
}

// ============================================================================
// Gap Detection
// ============================================================================

function detectGaps(
  input: WhatIfInput,
  matchingPolicies: PolicyMatch[],
  allPolicies: RawPolicy[]
): GapFinding[] {
  const gaps: GapFinding[] = []
  
  // No policy covers this scenario
  if (matchingPolicies.length === 0) {
    gaps.push({
      id: 'no-policy-coverage',
      severity: 'critical',
      category: 'coverage',
      title: 'No Policy Covers This Scenario',
      description: `No Conditional Access policy applies to this sign-in scenario. The user would authenticate with only a password.`,
      recommendation: 'Create a baseline MFA policy for all users and all applications.',
      affectedScenario: input
    })
  }
  
  // Legacy auth not blocked
  if (input.clientApp === 'legacy') {
    const blockingLegacy = matchingPolicies.some(p => p.isBlocking)
    if (!blockingLegacy) {
      const hasLegacyBlockPolicy = allPolicies.some(p => {
        const appTypes = toArray(p.conditions?.clientAppTypes)
        return appTypes.some(t => t === 'exchangeActiveSync' || t === 'other') &&
               toArray(p.accessControls?.grant?.builtInControls).includes('block')
      })
      
      if (!hasLegacyBlockPolicy) {
        gaps.push({
          id: 'legacy-auth-not-blocked',
          severity: 'critical',
          category: 'legacy',
          title: 'Legacy Authentication Not Blocked',
          description: 'Legacy authentication protocols (POP, IMAP, etc.) bypass MFA. No policy blocks them.',
          recommendation: 'Create a policy to block legacy authentication for all users.',
          affectedScenario: { clientApp: 'legacy' }
        })
      }
    }
  }
  
  // Untrusted location without MFA
  if (input.location === 'untrusted' || input.location === 'all') {
    const hasMfaForUntrusted = matchingPolicies.some(p => 
      p.grantControls.includes('mfa') && !p.excluded
    )
    if (!hasMfaForUntrusted && matchingPolicies.length > 0) {
      gaps.push({
        id: 'untrusted-location-no-mfa',
        severity: 'high',
        category: 'location',
        title: 'Untrusted Location Without MFA',
        description: 'Sign-ins from untrusted locations do not require MFA.',
        recommendation: 'Ensure MFA is required for sign-ins from untrusted or unknown locations.',
        affectedScenario: { location: 'untrusted' }
      })
    }
  }
  
  // Unmanaged device without controls
  if (input.deviceCompliance === 'unmanaged') {
    const hasDeviceControl = matchingPolicies.some(p =>
      p.grantControls.some(c => 
        c === 'compliantDevice' || 
        c === 'domainJoinedDevice' ||
        c === 'approvedApplication' ||
        c === 'compliantApplication'
      )
    )
    if (!hasDeviceControl && matchingPolicies.length > 0) {
      gaps.push({
        id: 'unmanaged-device-no-control',
        severity: 'medium',
        category: 'device',
        title: 'Unmanaged Device Without Additional Controls',
        description: 'Unmanaged/personal devices can access resources without device compliance requirements.',
        recommendation: 'Consider requiring app protection policies or approved apps for unmanaged devices.',
        affectedScenario: { deviceCompliance: 'unmanaged' }
      })
    }
  }
  
  // Guest user without MFA
  if (input.userType === 'guest' || input.userType === 'external') {
    const hasMfaForGuest = matchingPolicies.some(p =>
      p.grantControls.includes('mfa') && !p.excluded
    )
    if (!hasMfaForGuest) {
      gaps.push({
        id: 'guest-no-mfa',
        severity: 'high',
        category: 'guest',
        title: 'Guest Users Without MFA',
        description: 'Guest or external users can sign in without MFA.',
        recommendation: 'Create a policy requiring MFA for all guest and external users.',
        affectedScenario: { userType: input.userType }
      })
    }
  }
  
  // High risk sign-in not blocked
  if (input.signInRisk === 'high') {
    const blocksHighRisk = matchingPolicies.some(p => p.isBlocking)
    if (!blocksHighRisk) {
      gaps.push({
        id: 'high-risk-not-blocked',
        severity: 'critical',
        category: 'risk',
        title: 'High-Risk Sign-in Not Blocked',
        description: 'High-risk sign-ins are not blocked or remediated.',
        recommendation: 'Create a policy to block or require password change for high-risk sign-ins.',
        affectedScenario: { signInRisk: 'high' }
      })
    }
  }
  
  // High user risk not addressed
  if (input.userRisk === 'high') {
    const addressesUserRisk = matchingPolicies.some(p =>
      p.isBlocking || p.grantControls.includes('passwordChange')
    )
    if (!addressesUserRisk) {
      gaps.push({
        id: 'high-user-risk-not-addressed',
        severity: 'critical',
        category: 'risk',
        title: 'High User Risk Not Addressed',
        description: 'Users with high risk level can continue to sign in without remediation.',
        recommendation: 'Create a policy to block or require password change for high-risk users.',
        affectedScenario: { userRisk: 'high' }
      })
    }
  }
  
  return gaps
}

// ============================================================================
// Main Evaluation Function
// ============================================================================

export function evaluateWhatIf(
  input: WhatIfInput,
  rawPolicies: RawPolicy[]
): WhatIfResult {
  const matchingPolicies: PolicyMatch[] = []
  const excludedPolicies: PolicyMatch[] = []
  
  // Only evaluate enabled policies
  const enabledPolicies = rawPolicies.filter(p => 
    p.state === 'enabled' || p.state === 'enabledForReportingButNotEnforced'
  )
  
  for (const policy of enabledPolicies) {
    // Check user assignment
    const userCheck = checkUserAssignment(policy, input)
    if (!userCheck.included) {
      continue // User not in scope, skip
    }
    
    // Check application assignment
    const appCheck = checkApplicationAssignment(policy, input)
    if (!appCheck.included) {
      continue // App not in scope, skip
    }
    
    // Check conditions
    const conditionsMatched: string[] = []
    const conditionsNotMatched: string[] = []
    
    // Location
    const locationCheck = checkLocationCondition(policy, input)
    if (locationCheck.matches) {
      conditionsMatched.push(`Location: ${locationCheck.reason}`)
    } else {
      conditionsNotMatched.push(`Location: ${locationCheck.reason}`)
    }
    
    // Client app
    const clientAppCheck = checkClientAppCondition(policy, input)
    if (clientAppCheck.matches) {
      conditionsMatched.push(`Client App: ${clientAppCheck.reason}`)
    } else {
      conditionsNotMatched.push(`Client App: ${clientAppCheck.reason}`)
    }
    
    // Platform
    const platformCheck = checkPlatformCondition(policy, input)
    if (platformCheck.matches) {
      conditionsMatched.push(`Platform: ${platformCheck.reason}`)
    } else {
      conditionsNotMatched.push(`Platform: ${platformCheck.reason}`)
    }
    
    // Risk
    const riskCheck = checkRiskCondition(policy, input)
    if (riskCheck.matches) {
      conditionsMatched.push(`Risk: ${riskCheck.reason}`)
    } else {
      conditionsNotMatched.push(`Risk: ${riskCheck.reason}`)
    }
    
    // If any condition doesn't match, policy doesn't apply
    if (conditionsNotMatched.length > 0) {
      continue
    }
    
    // Extract controls
    const { controls, operator, isBlocking, authStrength } = extractGrantControls(policy)
    const sessionControls = extractSessionControls(policy)
    
    const policyMatch: PolicyMatch = {
      policyId: policy.id,
      policyName: policy.displayName,
      policyState: policy.state,
      matchReason: [...userCheck.reason, ...appCheck.reason],
      excluded: userCheck.excluded || appCheck.excluded,
      excludeReason: userCheck.excluded ? 'User excluded' : appCheck.excluded ? 'App excluded' : undefined,
      conditionsMatched,
      conditionsNotMatched,
      grantControls: controls,
      grantOperator: operator,
      sessionControls,
      authenticationStrength: authStrength,
      isBlocking,
      locationConfig: locationCheck.config
    }
    
    if (policyMatch.excluded) {
      excludedPolicies.push(policyMatch)
    } else {
      matchingPolicies.push(policyMatch)
    }
  }
  
  // Determine final decision
  let finalDecision: 'block' | 'grant' | 'noPolicy' = 'noPolicy'
  const requiredControls: string[] = []
  const sessionControls: string[] = []
  let authenticationStrength: string | undefined
  
  if (matchingPolicies.length > 0) {
    // Check if any policy blocks
    const blockingPolicy = matchingPolicies.find(p => p.isBlocking)
    if (blockingPolicy) {
      finalDecision = 'block'
    } else {
      finalDecision = 'grant'
      
      // Aggregate controls across all matching policies (AND semantics)
      for (const policy of matchingPolicies) {
        for (const control of policy.grantControls) {
          if (!requiredControls.includes(control)) {
            requiredControls.push(control)
          }
        }
        for (const sc of policy.sessionControls) {
          if (!sessionControls.includes(sc)) {
            sessionControls.push(sc)
          }
        }
        if (policy.authenticationStrength && !authenticationStrength) {
          authenticationStrength = policy.authenticationStrength
        }
      }
    }
  }
  
  // Detect gaps
  const gaps = detectGaps(input, matchingPolicies, rawPolicies)
  
  // Build summary
  let summary = ''
  if (finalDecision === 'block') {
    const blocker = matchingPolicies.find(p => p.isBlocking)
    summary = `Access BLOCKED by "${blocker?.policyName}"`
  } else if (finalDecision === 'grant') {
    if (requiredControls.length > 0) {
      summary = `Grant access with: ${requiredControls.join(' + ')}`
    } else {
      summary = 'Grant access (no additional controls required)'
    }
  } else {
    summary = 'No policy applies - access granted with password only'
  }
  
  return {
    input,
    matchingPolicies,
    excludedPolicies,
    finalDecision,
    requiredControls,
    sessionControls,
    authenticationStrength,
    gaps,
    summary
  }
}

// ============================================================================
// Helper to extract policies from graph data or raw policies JSON
// ============================================================================

export function extractPoliciesFromGraphData(_graphData: GraphData): RawPolicy[] {
  // GraphData nodes contain policy nodes, but we need the raw policy data
  // This would typically come from the conditional_access_policies.json
  // For now, return empty and expect rawPolicies to be passed separately
  return []
}

// ============================================================================
// Named Locations Extractor
// ============================================================================

export interface NamedLocation {
  id: string
  name: string
  type: 'ip' | 'country' | 'trusted' | 'unknown'
  isTrusted: boolean
}

export function extractNamedLocations(rawPolicies: RawPolicy[]): NamedLocation[] {
  const locations = new Map<string, NamedLocation>()
  
  for (const policy of rawPolicies) {
    const includeLocations = policy.conditions?.locations?.include?.entities || []
    const excludeLocations = policy.conditions?.locations?.exclude?.entities || []
    
    for (const loc of [...includeLocations, ...excludeLocations]) {
      if (!locations.has(loc.id)) {
        let type: NamedLocation['type'] = 'unknown'
        if (loc.type === 'ipNamedLocation') type = 'ip'
        else if (loc.type === 'countryNamedLocation') type = 'country'
        
        const isTrusted = loc.isTrusted === true ||
          loc.displayName?.toLowerCase().includes('trusted') ||
          loc.displayName?.toLowerCase().includes('corporate')
        
        locations.set(loc.id, {
          id: loc.id,
          name: loc.displayName || loc.id,
          type,
          isTrusted
        })
      }
    }
  }
  
  return Array.from(locations.values())
}

// ============================================================================
// Common Gap Patterns Check (run against all policies)
// ============================================================================

export function analyzeCommonGaps(rawPolicies: RawPolicy[]): GapFinding[] {
  const gaps: GapFinding[] = []
  const enabledPolicies = rawPolicies.filter(p => p.state === 'enabled')
  
  // Check for legacy auth block
  const hasLegacyBlock = enabledPolicies.some(p => {
    const appTypes = toArray(p.conditions?.clientAppTypes)
    const isLegacy = appTypes.some(t => t === 'exchangeActiveSync' || t === 'other')
    const isBlock = toArray(p.accessControls?.grant?.builtInControls).includes('block')
    return isLegacy && isBlock
  })
  
  if (!hasLegacyBlock) {
    gaps.push({
      id: 'global-legacy-auth-not-blocked',
      severity: 'critical',
      category: 'legacy',
      title: 'No Policy Blocks Legacy Authentication',
      description: 'There is no enabled policy that blocks legacy authentication protocols.',
      recommendation: 'Create a policy targeting "Other clients" and "Exchange ActiveSync clients" with Block access.',
      affectedScenario: {}
    })
  }
  
  // Check for baseline MFA policy
  const hasBaselineMfa = enabledPolicies.some(p => {
    const includesAllUsers = hasKeyword(p.assignments?.include?.users, 'All')
    const includesAllApps = hasKeyword(p.targetResources?.applications?.include, 'All')
    const requiresMfa = toArray(p.accessControls?.grant?.builtInControls).includes('mfa')
    return includesAllUsers && includesAllApps && requiresMfa
  })
  
  if (!hasBaselineMfa) {
    gaps.push({
      id: 'no-baseline-mfa',
      severity: 'high',
      category: 'coverage',
      title: 'No Baseline MFA Policy for All Users',
      description: 'There is no policy requiring MFA for all users accessing all applications.',
      recommendation: 'Create a baseline policy requiring MFA for all users on all cloud apps.',
      affectedScenario: {}
    })
  }
  
  // Check for high-risk sign-in policy
  const hasHighRiskPolicy = enabledPolicies.some(p => {
    const signInRisk = p.conditions?.signInRiskLevels || []
    return signInRisk.includes('high')
  })
  
  if (!hasHighRiskPolicy) {
    gaps.push({
      id: 'no-high-risk-policy',
      severity: 'high',
      category: 'risk',
      title: 'No Policy for High-Risk Sign-ins',
      description: 'There is no policy that addresses high-risk sign-ins (requires Entra ID P2).',
      recommendation: 'Create a policy to block or require MFA for high-risk sign-ins.',
      affectedScenario: {}
    })
  }
  
  // Check for policies with broad exclusions
  for (const policy of enabledPolicies) {
    const excludedUsers = policy.assignments?.exclude?.users?.entities?.length || 0
    const excludedGroups = policy.assignments?.exclude?.groups?.entities?.length || 0
    
    if (excludedUsers > 5 || excludedGroups > 3) {
      gaps.push({
        id: `broad-exclusions-${policy.id}`,
        severity: 'medium',
        category: 'coverage',
        title: `Policy Has Broad Exclusions: ${policy.displayName}`,
        description: `This policy excludes ${excludedUsers} users and ${excludedGroups} groups, which may create coverage gaps.`,
        recommendation: 'Review exclusions and consider using more targeted policies instead of broad exclusions.',
        affectedScenario: {}
      })
    }
  }
  
  // Check for report-only policies
  const reportOnlyPolicies = rawPolicies.filter(p => p.state === 'enabledForReportingButNotEnforced')
  if (reportOnlyPolicies.length > 0) {
    gaps.push({
      id: 'report-only-policies',
      severity: 'low',
      category: 'coverage',
      title: `${reportOnlyPolicies.length} Policies in Report-Only Mode`,
      description: `The following policies are not enforced: ${reportOnlyPolicies.map(p => p.displayName).join(', ')}`,
      recommendation: 'Review report-only policies and enable them if ready, or create a plan to enable them.',
      affectedScenario: {}
    })
  }
  
  return gaps
}

