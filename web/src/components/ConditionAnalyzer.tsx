/**
 * ConditionAnalyzer - Comprehensive CA policy analysis with decision tree visualization
 * 
 * Two views:
 * 1. Decision Tree - Visual flow of policy evaluation
 * 2. Category Cards - Original categorized view of conditions/controls
 */

import { useMemo, useState } from 'react'
import type { GraphData } from '../types/graph'
import { PolicyDecisionTree } from './PolicyDecisionTree'
import type { PolicyData } from '../utils/decisionTreeBuilder'
import './ConditionAnalyzer.css'

interface ConditionAnalyzerProps {
  graphData: GraphData
}

interface ConditionCategory {
  id: string
  name: string
  icon: string
  description: string
  group: 'conditions' | 'grants' | 'sessions'
  policies: PolicyConditionInfo[]
  coverage: number
}

interface PolicyConditionInfo {
  id: string
  name: string
  state: string
  details: PolicyDetails
}

interface PolicyDetails {
  grantControls: string[]
  grantOperator: string
  authenticationStrength?: {
    id: string | null
    displayName: string | null
    allowedCombinations?: string[]
  }
  termsOfUse?: string[]
  signInFrequency?: {
    value: number | null
    type: string | null
    isEnabled: boolean | null
    frequencyInterval?: string | null
    authenticationType?: string | null
  }
  persistentBrowser?: {
    mode: string | null
    isEnabled: boolean | null
  }
  cae?: {
    mode: string | null
    isEnabled: boolean | null
  }
  tokenProtection?: {
    enabled: boolean | null
  }
  appEnforcedRestrictions?: {
    isEnabled: boolean | null
  }
  cloudAppSecurity?: {
    cloudAppSecurityType: string | null
    isEnabled: boolean | null
  }
  userRiskLevels?: string[]
  signInRiskLevels?: string[]
  servicePrincipalRiskLevels?: string[]
  insiderRiskLevels?: string[]
  deviceFilter?: {
    configured: boolean
    mode: string | null
    rule: string | null
  }
  authenticationFlows?: {
    configured: boolean
    transferMethods: string[]
  }
  platforms?: string[]
  clientAppTypes?: string[]
  locations?: {
    includeKeywords: string[]
    includeEntities: string[]
    excludeKeywords: string[]
    excludeEntities: string[]
  }
}

const CONDITION_CATEGORIES: Array<{
  id: string
  name: string
  icon: string
  description: string
  group: 'conditions' | 'grants' | 'sessions'
}> = [
  { id: 'userRisk', name: 'User Risk', icon: '⚠️', description: 'Policies using user risk levels from Identity Protection', group: 'conditions' },
  { id: 'signInRisk', name: 'Sign-in Risk', icon: '🔐', description: 'Policies using sign-in risk levels from Identity Protection', group: 'conditions' },
  { id: 'servicePrincipalRisk', name: 'Service Principal Risk', icon: '🤖', description: 'Policies targeting workload identity risk', group: 'conditions' },
  { id: 'insiderRisk', name: 'Insider Risk', icon: '🕵️', description: 'Policies using Microsoft Purview Insider Risk', group: 'conditions' },
  { id: 'locations', name: 'Locations', icon: '📍', description: 'Policies with named location or country conditions', group: 'conditions' },
  { id: 'platforms', name: 'Device Platforms', icon: '📱', description: 'Policies targeting specific OS platforms', group: 'conditions' },
  { id: 'deviceFilter', name: 'Device Filter', icon: '🔧', description: 'Policies using device filter rules (e.g., PAW, tags)', group: 'conditions' },
  { id: 'clientApps', name: 'Client Apps', icon: '💻', description: 'Policies filtering by client app type (browser, mobile, legacy)', group: 'conditions' },
  { id: 'authFlows', name: 'Auth Flows', icon: '🔄', description: 'Policies restricting device code or transfer methods', group: 'conditions' },
  { id: 'mfa', name: 'MFA Required', icon: '🔑', description: 'Policies requiring multi-factor authentication', group: 'grants' },
  { id: 'authStrength', name: 'Auth Strength', icon: '🛡️', description: 'Policies specifying authentication strength (phishing-resistant, etc.)', group: 'grants' },
  { id: 'compliantDevice', name: 'Compliant Device', icon: '✅', description: 'Policies requiring Intune-compliant devices', group: 'grants' },
  { id: 'hybridJoin', name: 'Hybrid AD Join', icon: '🔗', description: 'Policies requiring Hybrid Azure AD joined devices', group: 'grants' },
  { id: 'approvedApp', name: 'Approved Client App', icon: '📲', description: 'Policies requiring approved client applications', group: 'grants' },
  { id: 'appProtection', name: 'App Protection', icon: '🛡️', description: 'Policies requiring Intune app protection policy', group: 'grants' },
  { id: 'passwordChange', name: 'Password Change', icon: '🔄', description: 'Policies requiring password change (for risky users)', group: 'grants' },
  { id: 'termsOfUse', name: 'Terms of Use', icon: '📜', description: 'Policies requiring acceptance of terms', group: 'grants' },
  { id: 'block', name: 'Block Access', icon: '🚫', description: 'Policies that block access entirely', group: 'grants' },
  { id: 'signInFrequency', name: 'Sign-in Frequency', icon: '⏱️', description: 'Policies enforcing re-authentication intervals', group: 'sessions' },
  { id: 'persistentBrowser', name: 'Persistent Browser', icon: '🌐', description: 'Policies controlling browser session persistence', group: 'sessions' },
  { id: 'cae', name: 'CAE Enforcement', icon: '🔁', description: 'Continuous Access Evaluation settings (strict/standard)', group: 'sessions' },
  { id: 'tokenProtection', name: 'Token Protection', icon: '🔒', description: 'Token binding/protection for sign-in sessions', group: 'sessions' },
  { id: 'cloudAppSecurity', name: 'Cloud App Security', icon: '☁️', description: 'Defender for Cloud Apps integration', group: 'sessions' },
  { id: 'appEnforced', name: 'App Restrictions', icon: '🔏', description: 'Application enforced restrictions (SharePoint/Exchange)', group: 'sessions' }
]

export function ConditionAnalyzer({ graphData }: ConditionAnalyzerProps) {
  const [viewTab, setViewTab] = useState<'tree' | 'categories'>('tree')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [showEnabled, setShowEnabled] = useState(true)
  const [showReportOnly, setShowReportOnly] = useState(true)
  const [showDisabled, setShowDisabled] = useState(false)
  const [groupFilter, setGroupFilter] = useState<'all' | 'conditions' | 'grants' | 'sessions'>('all')
  const [expandedPolicies, setExpandedPolicies] = useState<Set<string>>(new Set())
  
  // Policy selection for decision tree
  const [selectedTreePolicyIds, setSelectedTreePolicyIds] = useState<Set<string>>(() => {
    // Start with all enabled policies selected
    const enabledIds = graphData.nodes
      .filter(n => n.type === 'policy' && n.properties?.state === 'enabled')
      .map(n => n.id)
    return new Set(enabledIds)
  })

  // Convert graph policies to PolicyData format for decision tree
  const policyDataForTree = useMemo((): PolicyData[] => {
    return graphData.nodes
      .filter(n => n.type === 'policy')
      .map(node => {
        const props = node.properties as Record<string, unknown> || {}
        const conditions = props.conditions as Record<string, unknown> || {}
        const accessControls = props.accessControls as Record<string, unknown> || {}
        const assignments = props.assignments as Record<string, unknown> || {}
        const applications = props.applications as Record<string, unknown> || {}
        
        const assignInclude = (assignments?.include || {}) as Record<string, unknown>
        const assignExclude = (assignments?.exclude || {}) as Record<string, unknown>
        const appObj = (applications || {}) as Record<string, unknown>
        const condObj = (conditions || {}) as Record<string, unknown>
        const accObj = (accessControls || {}) as Record<string, unknown>
        
        return {
          id: node.id,
          displayName: node.label,
          state: props.state as string || 'unknown',
          assignments: {
            include: {
              users: (assignInclude.users || { keywords: [], entities: [] }) as PolicyData['assignments']['include']['users'],
              groups: (assignInclude.groups || { keywords: [], entities: [] }) as PolicyData['assignments']['include']['groups'],
              roles: (assignInclude.roles || { keywords: [], entities: [] }) as PolicyData['assignments']['include']['roles']
            },
            exclude: {
              users: (assignExclude.users || { keywords: [], entities: [] }) as PolicyData['assignments']['exclude']['users'],
              groups: (assignExclude.groups || { keywords: [], entities: [] }) as PolicyData['assignments']['exclude']['groups'],
              roles: (assignExclude.roles || { keywords: [], entities: [] }) as PolicyData['assignments']['exclude']['roles']
            }
          },
          applications: {
            include: appObj.include as PolicyData['applications'],
            exclude: appObj.exclude as PolicyData['applications']
          } as PolicyData['applications'],
          conditions: {
            locations: condObj.locations,
            platforms: condObj.platforms,
            clientAppTypes: condObj.clientAppTypes,
            userRiskLevels: condObj.userRiskLevels,
            signInRiskLevels: condObj.signInRiskLevels,
            deviceFilter: condObj.deviceFilter
          } as PolicyData['conditions'],
          grantControls: props.grantControls as string[] || [],
          accessControls: {
            grant: accObj.grant,
            session: accObj.session
          } as PolicyData['accessControls']
        }
      })
  }, [graphData])

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
      const grant = accessControls.grant as Record<string, unknown> || {}
      const session = accessControls.session as Record<string, unknown> || {}
      const grantControls = props.grantControls as string[] || []

      const details: PolicyDetails = {
        grantControls,
        grantOperator: (grant.operator as string) || 'OR',
        authenticationStrength: grant.authenticationStrength as PolicyDetails['authenticationStrength'],
        termsOfUse: grant.termsOfUse as string[] || undefined,
        signInFrequency: session.signInFrequency as PolicyDetails['signInFrequency'],
        persistentBrowser: session.persistentBrowser as PolicyDetails['persistentBrowser'],
        cae: session.continuousAccessEvaluation as PolicyDetails['cae'],
        tokenProtection: session.tokenProtection as PolicyDetails['tokenProtection'],
        appEnforcedRestrictions: session.applicationEnforcedRestrictions as PolicyDetails['appEnforcedRestrictions'],
        cloudAppSecurity: session.cloudAppSecurity as PolicyDetails['cloudAppSecurity'],
        userRiskLevels: Array.isArray(conditions.userRiskLevels) ? conditions.userRiskLevels : undefined,
        signInRiskLevels: Array.isArray(conditions.signInRiskLevels) ? conditions.signInRiskLevels : undefined,
        servicePrincipalRiskLevels: Array.isArray(conditions.servicePrincipalRiskLevels) ? conditions.servicePrincipalRiskLevels : undefined,
        insiderRiskLevels: (() => {
          const ir = conditions.insiderRiskLevels as Record<string, unknown> | undefined
          if (ir?.configured) {
            return Array.isArray(ir.levels) ? ir.levels : undefined
          }
          return Array.isArray(conditions.insiderRiskLevels) ? conditions.insiderRiskLevels : undefined
        })(),
        deviceFilter: (() => {
          const df = conditions.deviceFilter as Record<string, unknown> | undefined
          if (df) {
            return {
              configured: !!df.configured,
              mode: df.mode as string | null,
              rule: df.rule as string | null
            }
          }
          return undefined
        })(),
        authenticationFlows: (() => {
          const af = conditions.authenticationFlows as Record<string, unknown> | undefined
          if (af?.configured) {
            return {
              configured: true,
              transferMethods: Array.isArray(af.transferMethods) ? af.transferMethods : []
            }
          }
          return undefined
        })(),
        platforms: (() => {
          const plat = conditions.platforms as Record<string, unknown> | undefined
          if (plat?.include && Array.isArray(plat.include)) {
            return plat.include as string[]
          }
          return undefined
        })(),
        clientAppTypes: (() => {
          const cat = conditions.clientAppTypes
          if (Array.isArray(cat)) return cat
          if (typeof cat === 'string' && cat !== 'all') return [cat]
          return undefined
        })(),
        locations: (() => {
          const locs = conditions.locations as Record<string, unknown> | undefined
          if (!locs) return undefined
          const include = locs.include as Record<string, unknown> | undefined
          const exclude = locs.exclude as Record<string, unknown> | undefined
          const result = {
            includeKeywords: Array.isArray(include?.keywords) ? include.keywords : [],
            includeEntities: Array.isArray(include?.entities) ? (include.entities as Array<{displayName?: string}>).map(e => e.displayName || '') : [],
            excludeKeywords: Array.isArray(exclude?.keywords) ? exclude.keywords : [],
            excludeEntities: Array.isArray(exclude?.entities) ? (exclude.entities as Array<{displayName?: string}>).map(e => e.displayName || '') : []
          }
          if (result.includeKeywords.length || result.includeEntities.length || result.excludeKeywords.length || result.excludeEntities.length) {
            return result
          }
          return undefined
        })()
      }

      const policyInfo: PolicyConditionInfo = {
        id: policy.id,
        name: policy.label,
        state: props.state as string || 'unknown',
        details
      }

      // Categorize by conditions
      if (details.userRiskLevels && details.userRiskLevels.length > 0) {
        categorized.userRisk.push({ ...policyInfo })
      }
      if (details.signInRiskLevels && details.signInRiskLevels.length > 0) {
        categorized.signInRisk.push({ ...policyInfo })
      }
      if (details.servicePrincipalRiskLevels && details.servicePrincipalRiskLevels.length > 0) {
        categorized.servicePrincipalRisk.push({ ...policyInfo })
      }
      if (details.insiderRiskLevels && details.insiderRiskLevels.length > 0) {
        categorized.insiderRisk.push({ ...policyInfo })
      }
      if (details.locations) {
        categorized.locations.push({ ...policyInfo })
      }
      if (details.platforms && details.platforms.length > 0) {
        categorized.platforms.push({ ...policyInfo })
      }
      if (details.deviceFilter?.configured) {
        categorized.deviceFilter.push({ ...policyInfo })
      }
      if (details.clientAppTypes && details.clientAppTypes.length > 0) {
        categorized.clientApps.push({ ...policyInfo })
      }
      if (details.authenticationFlows?.configured) {
        categorized.authFlows.push({ ...policyInfo })
      }
      
      // Grant controls
      if (grantControls.includes('mfa')) {
        categorized.mfa.push({ ...policyInfo })
      }
      if (grantControls.some(gc => gc.startsWith('authStrength:')) || details.authenticationStrength?.displayName) {
        categorized.authStrength.push({ ...policyInfo })
      }
      if (grantControls.includes('compliantDevice')) {
        categorized.compliantDevice.push({ ...policyInfo })
      }
      if (grantControls.includes('domainJoinedDevice')) {
        categorized.hybridJoin.push({ ...policyInfo })
      }
      if (grantControls.includes('approvedApplication')) {
        categorized.approvedApp.push({ ...policyInfo })
      }
      if (grantControls.includes('compliantApplication')) {
        categorized.appProtection.push({ ...policyInfo })
      }
      if (grantControls.includes('passwordChange')) {
        categorized.passwordChange.push({ ...policyInfo })
      }
      if (details.termsOfUse && details.termsOfUse.length > 0) {
        categorized.termsOfUse.push({ ...policyInfo })
      }
      if (grantControls.includes('block')) {
        categorized.block.push({ ...policyInfo })
      }
      
      // Session controls
      if (details.signInFrequency?.isEnabled || details.signInFrequency?.value) {
        categorized.signInFrequency.push({ ...policyInfo })
      }
      if (details.persistentBrowser?.isEnabled || details.persistentBrowser?.mode) {
        categorized.persistentBrowser.push({ ...policyInfo })
      }
      if (details.cae?.isEnabled || details.cae?.mode) {
        categorized.cae.push({ ...policyInfo })
      }
      if (details.tokenProtection?.enabled) {
        categorized.tokenProtection.push({ ...policyInfo })
      }
      if (details.cloudAppSecurity?.isEnabled) {
        categorized.cloudAppSecurity.push({ ...policyInfo })
      }
      if (details.appEnforcedRestrictions?.isEnabled) {
        categorized.appEnforced.push({ ...policyInfo })
      }
    })

    return CONDITION_CATEGORIES.map(cat => ({
      ...cat,
      policies: categorized[cat.id],
      coverage: Math.round((categorized[cat.id].length / Math.max(totalPolicies, 1)) * 100)
    }))
  }, [graphData])

  const filteredCategories = useMemo(() => {
    if (groupFilter === 'all') return categories
    return categories.filter(c => c.group === groupFilter)
  }, [categories, groupFilter])

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

  const togglePolicyExpand = (policyId: string) => {
    setExpandedPolicies(prev => {
      const next = new Set(prev)
      if (next.has(policyId)) {
        next.delete(policyId)
      } else {
        next.add(policyId)
      }
      return next
    })
  }

  const stats = useMemo(() => {
    const grants = categories.filter(c => c.group === 'grants')
    const sessions = categories.filter(c => c.group === 'sessions')
    const conditions = categories.filter(c => c.group === 'conditions')
    
    return {
      totalPolicies: graphData.nodes.filter(n => n.type === 'policy').length,
      withMFA: categories.find(c => c.id === 'mfa')?.policies.length || 0,
      withAuthStrength: categories.find(c => c.id === 'authStrength')?.policies.length || 0,
      withBlock: categories.find(c => c.id === 'block')?.policies.length || 0,
      withSessionControls: sessions.reduce((acc, c) => acc + (c.policies.length > 0 ? 1 : 0), 0),
      withConditions: conditions.reduce((acc, c) => acc + (c.policies.length > 0 ? 1 : 0), 0),
      grantsUsed: grants.filter(g => g.policies.length > 0).length,
      totalGrants: grants.length
    }
  }, [categories, graphData])

  // Tree view handlers
  const handleTreePolicyToggle = (policyId: string) => {
    setSelectedTreePolicyIds(prev => {
      const next = new Set(prev)
      if (next.has(policyId)) {
        next.delete(policyId)
      } else {
        next.add(policyId)
      }
      return next
    })
  }

  const handleTreeSelectAll = () => {
    setSelectedTreePolicyIds(new Set(policyDataForTree.map(p => p.id)))
  }

  const handleTreeSelectNone = () => {
    setSelectedTreePolicyIds(new Set())
  }

  return (
    <div className="condition-analyzer">
      {/* Compact header */}
      <div className="condition-analyzer__header condition-analyzer__header--compact">
        <div className="condition-analyzer__title-row">
          <div className="condition-analyzer__title">
            <h2>Policy Analyzer</h2>
            <span className="condition-analyzer__subtitle">{stats.totalPolicies} policies</span>
          </div>
          
          <div className="condition-analyzer__view-tabs">
            <button
              className={viewTab === 'tree' ? 'active' : ''}
              onClick={() => setViewTab('tree')}
            >
              Decision Tree
            </button>
            <button
              className={viewTab === 'categories' ? 'active' : ''}
              onClick={() => setViewTab('categories')}
            >
              Categories
            </button>
          </div>
          
          <div className="condition-analyzer__quick-stats">
            <span className="quick-stat quick-stat--mfa">
              <span className="quick-stat__value">{stats.withMFA}</span> MFA
            </span>
            <span className="quick-stat quick-stat--strength">
              <span className="quick-stat__value">{stats.withAuthStrength}</span> Auth Strength
            </span>
            <span className="quick-stat quick-stat--block">
              <span className="quick-stat__value">{stats.withBlock}</span> Block
            </span>
          </div>
        </div>
      </div>

      {/* Decision Tree View */}
      {viewTab === 'tree' && (
        <PolicyDecisionTree
          policies={policyDataForTree}
          selectedPolicyIds={selectedTreePolicyIds}
          onPolicyToggle={handleTreePolicyToggle}
          onSelectAll={handleTreeSelectAll}
          onSelectNone={handleTreeSelectNone}
        />
      )}

      {/* Categories View */}
      {viewTab === 'categories' && (
        <>
          <div className="condition-analyzer__group-filter">
            <button 
              className={groupFilter === 'all' ? 'active' : ''} 
              onClick={() => setGroupFilter('all')}
            >
              All Categories
            </button>
            <button 
              className={groupFilter === 'conditions' ? 'active' : ''} 
              onClick={() => setGroupFilter('conditions')}
            >
              Conditions
            </button>
            <button 
              className={groupFilter === 'grants' ? 'active' : ''} 
              onClick={() => setGroupFilter('grants')}
            >
              Grant Controls
            </button>
            <button 
              className={groupFilter === 'sessions' ? 'active' : ''} 
              onClick={() => setGroupFilter('sessions')}
            >
              Session Controls
            </button>
          </div>

          <div className="condition-analyzer__grid">
            {filteredCategories.map(category => (
              <button
                key={category.id}
                className={`condition-analyzer__card ${selectedCategory === category.id ? 'condition-analyzer__card--selected' : ''} ${category.policies.length === 0 ? 'condition-analyzer__card--empty' : ''} condition-analyzer__card--${category.group}`}
                onClick={() => setSelectedCategory(selectedCategory === category.id ? null : category.id)}
              >
                <div className="condition-analyzer__card-header">
                  <span className="condition-analyzer__card-icon">{category.icon}</span>
                  <span className="condition-analyzer__card-name">{category.name}</span>
                  <span className={`condition-analyzer__card-group condition-analyzer__card-group--${category.group}`}>
                    {category.group}
                  </span>
                </div>
                <div className="condition-analyzer__card-stats">
                  <span className="condition-analyzer__card-count">{category.policies.length}</span>
                  <span className="condition-analyzer__card-label">policies</span>
                </div>
                <div className="condition-analyzer__card-bar">
                  <div 
                    className={`condition-analyzer__card-fill condition-analyzer__card-fill--${category.group}`}
                    style={{ width: `${category.coverage}%` }}
                  />
                </div>
                <div className="condition-analyzer__card-coverage">{category.coverage}% of policies</div>
              </button>
            ))}
          </div>

          {selectedCategoryData && (
            <div className="condition-analyzer__detail">
              <div className="condition-analyzer__detail-header">
                <div className="condition-analyzer__detail-title">
                  <span className="condition-analyzer__detail-icon">{selectedCategoryData.icon}</span>
                  <h3>{selectedCategoryData.name}</h3>
                  <span className={`condition-analyzer__detail-group condition-analyzer__detail-group--${selectedCategoryData.group}`}>
                    {selectedCategoryData.group}
                  </span>
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
                    <div key={policy.id} className={`condition-analyzer__policy ${expandedPolicies.has(policy.id) ? 'condition-analyzer__policy--expanded' : ''}`}>
                      <div 
                        className="condition-analyzer__policy-header"
                        onClick={() => togglePolicyExpand(policy.id)}
                      >
                        <span className="condition-analyzer__policy-toggle">
                          {expandedPolicies.has(policy.id) ? '▼' : '▶'}
                        </span>
                        <span className="condition-analyzer__policy-name">{policy.name}</span>
                        <span className={`condition-analyzer__policy-state condition-analyzer__policy-state--${policy.state === 'enabled' ? 'enabled' : policy.state === 'enabledForReportingButNotEnforced' ? 'report-only' : 'disabled'}`}>
                          {formatState(policy.state)}
                        </span>
                      </div>
                      
                      <div className="condition-analyzer__policy-badges">
                        {policy.details.grantControls.map((gc, i) => (
                          <span key={i} className="condition-analyzer__badge condition-analyzer__badge--grant">
                            {formatGrantControl(gc)}
                          </span>
                        ))}
                        <span className="condition-analyzer__badge condition-analyzer__badge--operator">
                          {policy.details.grantOperator === 'AND' ? 'Require ALL' : 'Require ONE'}
                        </span>
                      </div>

                      {expandedPolicies.has(policy.id) && (
                        <PolicyDetailPanel 
                          details={policy.details} 
                          categoryId={selectedCategoryData.id}
                        />
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PolicyDetailPanel({ details, categoryId }: { details: PolicyDetails, categoryId: string }) {
  return (
    <div className="policy-detail-panel">
      <div className="policy-detail-panel__section">
        <h4>Grant Controls</h4>
        <div className="policy-detail-panel__grid">
          <div className="policy-detail-panel__item">
            <span className="policy-detail-panel__label">Operator</span>
            <span className={`policy-detail-panel__value policy-detail-panel__value--${details.grantOperator.toLowerCase()}`}>
              {details.grantOperator === 'AND' ? '✓ Require ALL controls' : '○ Require ONE of controls'}
            </span>
          </div>
          
          {details.grantControls.length > 0 && (
            <div className="policy-detail-panel__item">
              <span className="policy-detail-panel__label">Required Controls</span>
              <div className="policy-detail-panel__value-list">
                {details.grantControls.map((gc, i) => (
                  <span key={i} className="policy-detail-panel__chip">{formatGrantControl(gc)}</span>
                ))}
              </div>
            </div>
          )}
          
          {(categoryId === 'authStrength' || details.authenticationStrength?.displayName) && (
            <div className="policy-detail-panel__item policy-detail-panel__item--highlight">
              <span className="policy-detail-panel__label">Authentication Strength</span>
              {details.authenticationStrength?.displayName ? (
                <div className="policy-detail-panel__auth-strength">
                  <span className="policy-detail-panel__auth-name">
                    {details.authenticationStrength.displayName}
                  </span>
                  {details.authenticationStrength.allowedCombinations && (
                    <div className="policy-detail-panel__auth-methods">
                      <span className="policy-detail-panel__sublabel">Allowed Methods:</span>
                      {details.authenticationStrength.allowedCombinations.map((m, i) => (
                        <span key={i} className="policy-detail-panel__method">{m}</span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span className="policy-detail-panel__value policy-detail-panel__value--none">
                  Not specified
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="policy-detail-panel__section">
        <h4>Session Controls</h4>
        <div className="policy-detail-panel__grid">
          <div className="policy-detail-panel__item">
            <span className="policy-detail-panel__label">Sign-in Frequency</span>
            {details.signInFrequency?.isEnabled || details.signInFrequency?.value ? (
              <span className="policy-detail-panel__value policy-detail-panel__value--configured">
                ✓ Every {details.signInFrequency.value} {details.signInFrequency.type || 'hours'}
              </span>
            ) : (
              <span className="policy-detail-panel__value policy-detail-panel__value--none">Not configured</span>
            )}
          </div>
          
          <div className="policy-detail-panel__item">
            <span className="policy-detail-panel__label">CAE Mode</span>
            {details.cae?.isEnabled || details.cae?.mode ? (
              <span className={`policy-detail-panel__value policy-detail-panel__value--configured ${details.cae.mode === 'strictLocation' ? 'policy-detail-panel__value--strict' : ''}`}>
                ✓ {details.cae.mode === 'strictLocation' ? 'Strict Location' : details.cae.mode || 'Enabled'}
              </span>
            ) : (
              <span className="policy-detail-panel__value policy-detail-panel__value--none">Default</span>
            )}
          </div>
          
          <div className="policy-detail-panel__item">
            <span className="policy-detail-panel__label">Token Protection</span>
            {details.tokenProtection?.enabled ? (
              <span className="policy-detail-panel__value policy-detail-panel__value--configured">✓ Enabled</span>
            ) : (
              <span className="policy-detail-panel__value policy-detail-panel__value--none">Not enabled</span>
            )}
          </div>
        </div>
      </div>

      <div className="policy-detail-panel__section">
        <h4>Conditions</h4>
        <div className="policy-detail-panel__grid">
          <div className="policy-detail-panel__item">
            <span className="policy-detail-panel__label">User Risk</span>
            {details.userRiskLevels && details.userRiskLevels.length > 0 ? (
              <div className="policy-detail-panel__value-list">
                {details.userRiskLevels.map((level, i) => (
                  <span key={i} className={`policy-detail-panel__chip policy-detail-panel__chip--risk-${level.toLowerCase()}`}>
                    {level}
                  </span>
                ))}
              </div>
            ) : (
              <span className="policy-detail-panel__value policy-detail-panel__value--none">Any</span>
            )}
          </div>
          
          <div className="policy-detail-panel__item">
            <span className="policy-detail-panel__label">Sign-in Risk</span>
            {details.signInRiskLevels && details.signInRiskLevels.length > 0 ? (
              <div className="policy-detail-panel__value-list">
                {details.signInRiskLevels.map((level, i) => (
                  <span key={i} className={`policy-detail-panel__chip policy-detail-panel__chip--risk-${level.toLowerCase()}`}>
                    {level}
                  </span>
                ))}
              </div>
            ) : (
              <span className="policy-detail-panel__value policy-detail-panel__value--none">Any</span>
            )}
          </div>
          
          <div className="policy-detail-panel__item">
            <span className="policy-detail-panel__label">Device Platforms</span>
            {details.platforms && details.platforms.length > 0 ? (
              <div className="policy-detail-panel__value-list">
                {details.platforms.map((p, i) => (
                  <span key={i} className="policy-detail-panel__chip">{p}</span>
                ))}
              </div>
            ) : (
              <span className="policy-detail-panel__value policy-detail-panel__value--none">All</span>
            )}
          </div>
          
          <div className="policy-detail-panel__item">
            <span className="policy-detail-panel__label">Client Apps</span>
            {details.clientAppTypes && details.clientAppTypes.length > 0 ? (
              <div className="policy-detail-panel__value-list">
                {details.clientAppTypes.map((app, i) => (
                  <span key={i} className="policy-detail-panel__chip">{formatClientApp(app)}</span>
                ))}
              </div>
            ) : (
              <span className="policy-detail-panel__value policy-detail-panel__value--none">All</span>
            )}
          </div>
          
          {details.locations && (
            <div className="policy-detail-panel__item policy-detail-panel__item--full">
              <span className="policy-detail-panel__label">Locations</span>
              <div className="policy-detail-panel__locations">
                {(details.locations.includeKeywords.length > 0 || details.locations.includeEntities.length > 0) && (
                  <div className="policy-detail-panel__loc-group">
                    <span className="policy-detail-panel__loc-label">Include:</span>
                    {details.locations.includeKeywords.map((kw, i) => (
                      <span key={`ikw-${i}`} className="policy-detail-panel__chip policy-detail-panel__chip--include">{kw}</span>
                    ))}
                    {details.locations.includeEntities.map((e, i) => (
                      <span key={`ie-${i}`} className="policy-detail-panel__chip policy-detail-panel__chip--include">{e}</span>
                    ))}
                  </div>
                )}
                {(details.locations.excludeKeywords.length > 0 || details.locations.excludeEntities.length > 0) && (
                  <div className="policy-detail-panel__loc-group">
                    <span className="policy-detail-panel__loc-label">Exclude:</span>
                    {details.locations.excludeKeywords.map((kw, i) => (
                      <span key={`ekw-${i}`} className="policy-detail-panel__chip policy-detail-panel__chip--exclude">{kw}</span>
                    ))}
                    {details.locations.excludeEntities.map((e, i) => (
                      <span key={`ee-${i}`} className="policy-detail-panel__chip policy-detail-panel__chip--exclude">{e}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
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

function formatGrantControl(grant: string): string {
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
  return labels[grant] || grant
}

function formatClientApp(app: string): string {
  const labels: Record<string, string> = {
    browser: 'Browser',
    mobileAppsAndDesktopClients: 'Mobile & Desktop',
    exchangeActiveSync: 'Exchange ActiveSync',
    other: 'Other (Legacy)'
  }
  return labels[app] || app
}
