// ConditionAnalyzer - Analyze policies by condition type
import { useMemo, useState } from 'react'
import type { GraphData } from '../types/graph'
import './ConditionAnalyzer.css'

interface ConditionAnalyzerProps {
  graphData: GraphData
}

interface ConditionCategory {
  id: string
  name: string
  icon: string
  description: string
  policies: PolicyConditionInfo[]
  coverage: number
}

interface PolicyConditionInfo {
  id: string
  name: string
  state: string
  conditions: string[]
  grantControls: string[]
}

const CONDITION_CATEGORIES = [
  { id: 'userRisk', name: 'User Risk', icon: '⚠️', description: 'Policies using user risk levels' },
  { id: 'signInRisk', name: 'Sign-in Risk', icon: '🔐', description: 'Policies using sign-in risk levels' },
  { id: 'locations', name: 'Locations', icon: '📍', description: 'Policies with location conditions' },
  { id: 'platforms', name: 'Device Platforms', icon: '📱', description: 'Policies targeting specific platforms' },
  { id: 'clientApps', name: 'Client Apps', icon: '💻', description: 'Policies filtering by client app type' },
  { id: 'deviceState', name: 'Device State', icon: '✅', description: 'Policies requiring device compliance' },
  { id: 'authStrength', name: 'Authentication Strength', icon: '🛡️', description: 'Policies with auth strength requirements' },
  { id: 'mfa', name: 'MFA Required', icon: '🔑', description: 'Policies requiring multi-factor authentication' },
  { id: 'block', name: 'Block Access', icon: '🚫', description: 'Policies that block access' },
  { id: 'sessionControls', name: 'Session Controls', icon: '⏱️', description: 'Policies with session restrictions' }
]

export function ConditionAnalyzer({ graphData }: ConditionAnalyzerProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [showEnabled, setShowEnabled] = useState(true)
  const [showReportOnly, setShowReportOnly] = useState(true)
  const [showDisabled, setShowDisabled] = useState(false)

  const categories = useMemo((): ConditionCategory[] => {
    const policyNodes = graphData.nodes.filter(n => n.type === 'policy')
    const totalPolicies = policyNodes.length

    const categorized: Record<string, PolicyConditionInfo[]> = {}
    CONDITION_CATEGORIES.forEach(cat => {
      categorized[cat.id] = []
    })

    policyNodes.forEach(policy => {
      const props = policy.properties as Record<string, unknown> || {}
      const conditions = props.conditions as Record<string, unknown> || {}
      const accessControls = props.accessControls as Record<string, unknown> || {}
      const session = accessControls.session as Record<string, unknown> || {}
      const grantControls = props.grantControls as string[] || []

      const policyInfo: PolicyConditionInfo = {
        id: policy.id,
        name: policy.label,
        state: props.state as string || 'unknown',
        conditions: [],
        grantControls
      }

      // Categorize by conditions
      const userRisk = Array.isArray(conditions.userRiskLevels) ? conditions.userRiskLevels : []
      if (userRisk.length > 0) {
        policyInfo.conditions.push(`User Risk: ${userRisk.join(', ')}`)
        categorized.userRisk.push({ ...policyInfo })
      }

      const signInRisk = Array.isArray(conditions.signInRiskLevels) ? conditions.signInRiskLevels : []
      if (signInRisk.length > 0) {
        policyInfo.conditions.push(`Sign-in Risk: ${signInRisk.join(', ')}`)
        categorized.signInRisk.push({ ...policyInfo })
      }

      const locations = (conditions.locations as Record<string, unknown>) || {}
      const locInclude = (locations.include as Record<string, unknown>) || {}
      const locExclude = (locations.exclude as Record<string, unknown>) || {}
      const locIncludeEntities = Array.isArray(locInclude.entities) ? locInclude.entities : []
      const locIncludeKeywords = Array.isArray(locInclude.keywords) ? locInclude.keywords : []
      const locExcludeEntities = Array.isArray(locExclude.entities) ? locExclude.entities : []
      if (locIncludeEntities.length > 0 || 
          locIncludeKeywords.length > 0 ||
          locExcludeEntities.length > 0) {
        policyInfo.conditions.push('Location restrictions')
        categorized.locations.push({ ...policyInfo })
      }

      const platforms = (conditions.platforms as Record<string, unknown>) || {}
      const platformInclude = Array.isArray(platforms.include) ? platforms.include : []
      if (platformInclude.length > 0) {
        policyInfo.conditions.push(`Platforms: ${platformInclude.join(', ')}`)
        categorized.platforms.push({ ...policyInfo })
      }

      const clientAppTypes = conditions.clientAppTypes
      const clientAppTypesArray = Array.isArray(clientAppTypes) 
        ? clientAppTypes 
        : (typeof clientAppTypes === 'string' && clientAppTypes !== 'all' ? [clientAppTypes] : [])
      if (clientAppTypesArray.length > 0 && !clientAppTypesArray.includes('all')) {
        policyInfo.conditions.push(`Client Apps: ${clientAppTypesArray.join(', ')}`)
        categorized.clientApps.push({ ...policyInfo })
      }

      // Categorize by grant controls
      if (grantControls.includes('compliantDevice') || grantControls.includes('domainJoinedDevice')) {
        categorized.deviceState.push({ ...policyInfo })
      }

      if (grantControls.some(gc => gc.startsWith('authStrength:'))) {
        categorized.authStrength.push({ ...policyInfo })
      }

      if (grantControls.includes('mfa')) {
        categorized.mfa.push({ ...policyInfo })
      }

      if (grantControls.includes('block')) {
        categorized.block.push({ ...policyInfo })
      }

      // Session controls
      if (session && Object.keys(session).length > 0) {
        const sessionTypes: string[] = []
        if (session.signInFrequency) sessionTypes.push('Sign-in Frequency')
        if (session.persistentBrowser) sessionTypes.push('Persistent Browser')
        if (session.cloudAppSecurity) sessionTypes.push('Cloud App Security')
        if (sessionTypes.length > 0) {
          policyInfo.conditions.push(`Session: ${sessionTypes.join(', ')}`)
          categorized.sessionControls.push({ ...policyInfo })
        }
      }
    })

    return CONDITION_CATEGORIES.map(cat => ({
      ...cat,
      policies: categorized[cat.id],
      coverage: Math.round((categorized[cat.id].length / Math.max(totalPolicies, 1)) * 100)
    }))
  }, [graphData])

  const selectedCategoryData = useMemo(() => {
    if (!selectedCategory) return null
    return categories.find(c => c.id === selectedCategory)
  }, [categories, selectedCategory])

  const filteredPolicies = useMemo(() => {
    if (!selectedCategoryData) return []
    
    return selectedCategoryData.policies.filter(p => {
      if (p.state === 'enabled' && !showEnabled) return false
      if (p.state === 'enabledForReportingButNotEnforced' && !showReportOnly) return false
      if (p.state === 'disabled' && !showDisabled) return false
      return true
    })
  }, [selectedCategoryData, showEnabled, showReportOnly, showDisabled])

  return (
    <div className="condition-analyzer">
      <div className="condition-analyzer__header">
        <div className="condition-analyzer__title">
          <h2>Condition Analyzer</h2>
          <p>Analyze policies by condition type and identify coverage gaps</p>
        </div>
      </div>

      <div className="condition-analyzer__grid">
        {categories.map(category => (
          <button
            key={category.id}
            className={`condition-analyzer__card ${selectedCategory === category.id ? 'condition-analyzer__card--selected' : ''} ${category.policies.length === 0 ? 'condition-analyzer__card--empty' : ''}`}
            onClick={() => setSelectedCategory(selectedCategory === category.id ? null : category.id)}
          >
            <div className="condition-analyzer__card-header">
              <span className="condition-analyzer__card-icon">{category.icon}</span>
              <span className="condition-analyzer__card-name">{category.name}</span>
            </div>
            <div className="condition-analyzer__card-stats">
              <span className="condition-analyzer__card-count">{category.policies.length}</span>
              <span className="condition-analyzer__card-label">policies</span>
            </div>
            <div className="condition-analyzer__card-bar">
              <div 
                className="condition-analyzer__card-fill"
                style={{ width: `${category.coverage}%` }}
              />
            </div>
            <div className="condition-analyzer__card-coverage">{category.coverage}% coverage</div>
          </button>
        ))}
      </div>

      {selectedCategoryData && (
        <div className="condition-analyzer__detail">
          <div className="condition-analyzer__detail-header">
            <div className="condition-analyzer__detail-title">
              <span className="condition-analyzer__detail-icon">{selectedCategoryData.icon}</span>
              <h3>{selectedCategoryData.name}</h3>
              <span className="condition-analyzer__detail-count">
                {filteredPolicies.length} {filteredPolicies.length === 1 ? 'policy' : 'policies'}
              </span>
            </div>
            <p>{selectedCategoryData.description}</p>
          </div>

          <div className="condition-analyzer__filters">
            <label>
              <input
                type="checkbox"
                checked={showEnabled}
                onChange={e => setShowEnabled(e.target.checked)}
              />
              Enabled
            </label>
            <label>
              <input
                type="checkbox"
                checked={showReportOnly}
                onChange={e => setShowReportOnly(e.target.checked)}
              />
              Report Only
            </label>
            <label>
              <input
                type="checkbox"
                checked={showDisabled}
                onChange={e => setShowDisabled(e.target.checked)}
              />
              Disabled
            </label>
          </div>

          <div className="condition-analyzer__policies">
            {filteredPolicies.length === 0 ? (
              <div className="condition-analyzer__empty">
                No policies match the current filters
              </div>
            ) : (
              filteredPolicies.map(policy => (
                <div key={policy.id} className="condition-analyzer__policy">
                  <div className="condition-analyzer__policy-header">
                    <span className="condition-analyzer__policy-name">{policy.name}</span>
                    <span className={`condition-analyzer__policy-state condition-analyzer__policy-state--${policy.state === 'enabled' ? 'enabled' : policy.state === 'enabledForReportingButNotEnforced' ? 'report-only' : 'disabled'}`}>
                      {formatState(policy.state)}
                    </span>
                  </div>
                  {policy.conditions.length > 0 && (
                    <div className="condition-analyzer__policy-conditions">
                      {policy.conditions.map((cond, i) => (
                        <span key={i} className="condition-analyzer__policy-tag">{cond}</span>
                      ))}
                    </div>
                  )}
                  {policy.grantControls.length > 0 && (
                    <div className="condition-analyzer__policy-grants">
                      {policy.grantControls.map((grant, i) => (
                        <span key={i} className="condition-analyzer__policy-grant">{formatGrant(grant)}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function formatState(state: string): string {
  const labels: Record<string, string> = {
    enabled: 'Enabled',
    enabledForReportingButNotEnforced: 'Report Only',
    disabled: 'Disabled'
  }
  return labels[state] || state
}

function formatGrant(grant: string): string {
  const labels: Record<string, string> = {
    mfa: 'MFA',
    block: 'Block',
    compliantDevice: 'Compliant Device',
    domainJoinedDevice: 'Hybrid Join'
  }
  if (grant.startsWith('authStrength:')) {
    return grant.replace('authStrength:', 'Auth: ')
  }
  return labels[grant] || grant
}

