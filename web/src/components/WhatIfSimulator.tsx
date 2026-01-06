import { useState, useMemo, useEffect } from 'react'
import type { GraphData } from '../types/graph'
import {
  evaluateWhatIf,
  extractNamedLocations,
  analyzeCommonGaps,
  type WhatIfInput,
  type WhatIfResult,
  type GapFinding,
  type UserType,
  type LocationType,
  type DevicePlatform,
  type DeviceCompliance,
  type ClientAppType,
  type RiskLevel
} from '../utils/policyEvaluator'
import './WhatIfSimulator.css'

interface PolicySummary {
  id: string
  label: string
  stateKey: string
  stateLabel: string
}

interface WhatIfSimulatorProps {
  graphData: GraphData
  rawPolicies: any[]
  policySummaries?: PolicySummary[]
  onPolicySelect?: (policyId: string) => void
}

export function WhatIfSimulator({ graphData: _graphData, rawPolicies, policySummaries = [], onPolicySelect }: WhatIfSimulatorProps) {
  // Policy selection state
  const [selectedPolicies, setSelectedPolicies] = useState<Set<string>>(new Set())
  const [policySearch, setPolicySearch] = useState('')
  const [stateFilter, setStateFilter] = useState<'all' | 'enabled' | 'reportOnly' | 'disabled'>('all')
  
  // Input state
  const [userType, setUserType] = useState<UserType>('member')
  const [location, setLocation] = useState<LocationType>('all')
  const [selectedLocationId, setSelectedLocationId] = useState<string>('')
  const [devicePlatform, setDevicePlatform] = useState<DevicePlatform>('all')
  const [deviceCompliance, setDeviceCompliance] = useState<DeviceCompliance>('all')
  const [clientApp, setClientApp] = useState<ClientAppType>('all')
  const [signInRisk, setSignInRisk] = useState<RiskLevel>('none')
  const [userRisk, setUserRisk] = useState<RiskLevel>('none')
  
  // Results
  const [result, setResult] = useState<WhatIfResult | null>(null)
  const [commonGaps, setCommonGaps] = useState<GapFinding[]>([])
  const [showCommonGaps, setShowCommonGaps] = useState(true)
  
  // Initialize with all enabled policies selected
  useEffect(() => {
    const enabledPolicies = policySummaries
      .filter(p => p.stateKey === 'enabled')
      .map(p => p.id)
    setSelectedPolicies(new Set(enabledPolicies))
  }, [policySummaries])
  
  // Extract named locations from policies
  const namedLocations = useMemo(() => {
    return extractNamedLocations(rawPolicies)
  }, [rawPolicies])
  
  // Filter policies for display
  const filteredPolicySummaries = useMemo(() => {
    return policySummaries.filter(p => {
      if (policySearch && !p.label.toLowerCase().includes(policySearch.toLowerCase())) return false
      if (stateFilter !== 'all' && p.stateKey !== stateFilter) return false
      return true
    })
  }, [policySummaries, policySearch, stateFilter])
  
  // Get the actual policies to evaluate (filtered by selection)
  const policiesToEvaluate = useMemo(() => {
    if (selectedPolicies.size === 0) return rawPolicies
    return rawPolicies.filter(p => selectedPolicies.has(p.id))
  }, [rawPolicies, selectedPolicies])
  
  // Analyze common gaps on mount
  useEffect(() => {
    const gaps = analyzeCommonGaps(policiesToEvaluate)
    setCommonGaps(gaps)
  }, [policiesToEvaluate])
  
  // Build input and evaluate
  const handleEvaluate = () => {
    const input: WhatIfInput = {
      userType,
      location,
      locationId: selectedLocationId || undefined,
      locationName: namedLocations.find(l => l.id === selectedLocationId)?.name,
      devicePlatform,
      deviceCompliance,
      clientApp,
      signInRisk,
      userRisk
    }
    
    const evalResult = evaluateWhatIf(input, policiesToEvaluate)
    setResult(evalResult)
    setShowCommonGaps(false)
  }
  
  // Quick scenario presets
  const applyPreset = (preset: string) => {
    switch (preset) {
      case 'guest-untrusted':
        setUserType('guest')
        setLocation('untrusted')
        setDeviceCompliance('unmanaged')
        setClientApp('browser')
        break
      case 'legacy-auth':
        setUserType('member')
        setLocation('all')
        setClientApp('legacy')
        break
      case 'high-risk':
        setUserType('member')
        setSignInRisk('high')
        setUserRisk('high')
        break
      case 'byod':
        setUserType('member')
        setDeviceCompliance('unmanaged')
        setDevicePlatform('iOS')
        setClientApp('mobileDesktop')
        break
      case 'corporate':
        setUserType('member')
        setLocation('trusted')
        setDeviceCompliance('compliant')
        setDevicePlatform('windows')
        setClientApp('mobileDesktop')
        break
    }
    // Clear previous result when changing scenario
    setResult(null)
    setShowCommonGaps(true)
  }
  
  const togglePolicy = (policyId: string) => {
    setSelectedPolicies(prev => {
      const next = new Set(prev)
      if (next.has(policyId)) {
        next.delete(policyId)
      } else {
        next.add(policyId)
      }
      return next
    })
    // Clear result when changing policies
    setResult(null)
  }
  
  const selectAllVisible = () => {
    setSelectedPolicies(prev => {
      const next = new Set(prev)
      for (const p of filteredPolicySummaries) {
        next.add(p.id)
      }
      return next
    })
    setResult(null)
  }
  
  const selectNoneVisible = () => {
    setSelectedPolicies(prev => {
      const next = new Set(prev)
      for (const p of filteredPolicySummaries) {
        next.delete(p.id)
      }
      return next
    })
    setResult(null)
  }
  
  const severityColors: Record<string, string> = {
    critical: '#ef4444',
    high: '#f97316',
    medium: '#eab308',
    low: '#3b82f6'
  }
  
  const severityIcons: Record<string, string> = {
    critical: '🚨',
    high: '⚠️',
    medium: '⚡',
    low: 'ℹ️'
  }
  
  const stateIndicators: Record<string, { icon: string; color: string }> = {
    enabled: { icon: '●', color: '#10b981' },
    reportOnly: { icon: '●', color: '#f59e0b' },
    disabled: { icon: '●', color: '#6b7280' }
  }
  
  return (
    <div className="whatif-simulator whatif-simulator--integrated">
      {/* Top Bar: Scenario Presets + Evaluate Button */}
      <div className="whatif-simulator__top-bar">
        <div className="whatif-simulator__title">
          <h2>What If Policy Simulator</h2>
          <span className="whatif-simulator__subtitle">
            Test sign-in scenarios against {selectedPolicies.size} of {rawPolicies.length} policies
          </span>
        </div>
        <div className="whatif-simulator__presets-inline">
          <span className="whatif-simulator__preset-label">Quick:</span>
          <button onClick={() => applyPreset('guest-untrusted')} className="preset-btn-sm">Guest External</button>
          <button onClick={() => applyPreset('legacy-auth')} className="preset-btn-sm">Legacy Auth</button>
          <button onClick={() => applyPreset('high-risk')} className="preset-btn-sm">High Risk</button>
          <button onClick={() => applyPreset('byod')} className="preset-btn-sm">BYOD</button>
          <button onClick={() => applyPreset('corporate')} className="preset-btn-sm">Corporate</button>
        </div>
        <button className="whatif-simulator__evaluate-btn-main" onClick={handleEvaluate}>
          Evaluate Scenario
        </button>
      </div>
      
      <div className="whatif-simulator__layout">
        {/* Left Column: Policy Selector */}
        <div className="whatif-simulator__policies-panel">
          <div className="whatif-simulator__policies-header">
            <h3>Policies to Evaluate</h3>
            <div className="whatif-simulator__policies-count">
              {selectedPolicies.size} / {policySummaries.length} selected
            </div>
          </div>
          
          <div className="whatif-simulator__policies-filters">
            <input 
              type="text" 
              placeholder="Search policies..." 
              value={policySearch}
              onChange={(e) => setPolicySearch(e.target.value)}
              className="whatif-simulator__policy-search"
            />
            <select 
              value={stateFilter} 
              onChange={(e) => setStateFilter(e.target.value as typeof stateFilter)}
              className="whatif-simulator__state-filter"
            >
              <option value="all">All States</option>
              <option value="enabled">Enabled</option>
              <option value="reportOnly">Report Only</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
          
          <div className="whatif-simulator__policies-actions">
            <button onClick={selectAllVisible}>Select All</button>
            <button onClick={selectNoneVisible}>Select None</button>
          </div>
          
          <div className="whatif-simulator__policies-list">
            {filteredPolicySummaries.map(policy => {
              const indicator = stateIndicators[policy.stateKey] || stateIndicators.disabled
              return (
                <label key={policy.id} className="whatif-simulator__policy-item">
                  <input 
                    type="checkbox" 
                    checked={selectedPolicies.has(policy.id)}
                    onChange={() => togglePolicy(policy.id)}
                  />
                  <span 
                    className="whatif-simulator__policy-state-dot"
                    style={{ color: indicator.color }}
                  >
                    {indicator.icon}
                  </span>
                  <span className="whatif-simulator__policy-name" title={policy.label}>
                    {policy.label}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
        
        {/* Middle Column: Conditions */}
        <div className="whatif-simulator__conditions-panel">
          <h3>Scenario Conditions</h3>
          
          <div className="whatif-simulator__conditions-grid">
            <div className="whatif-simulator__condition-group">
              <label>User Type</label>
              <select value={userType} onChange={(e) => setUserType(e.target.value as UserType)}>
                <option value="member">Member (Internal)</option>
                <option value="guest">Guest User</option>
                <option value="external">External User</option>
                <option value="all">Any User</option>
              </select>
            </div>
            
            <div className="whatif-simulator__condition-group">
              <label>Location</label>
              <select value={location} onChange={(e) => {
                setLocation(e.target.value as LocationType)
                setSelectedLocationId('')
              }}>
                <option value="all">Any Location</option>
                <option value="trusted">Trusted</option>
                <option value="untrusted">Untrusted</option>
                <option value="banned">Banned/Blocked</option>
              </select>
            </div>
            
            {namedLocations.length > 0 && (
              <div className="whatif-simulator__condition-group">
                <label>Named Location</label>
                <select 
                  value={selectedLocationId} 
                  onChange={(e) => setSelectedLocationId(e.target.value)}
                >
                  <option value="">-- Any --</option>
                  {namedLocations.map(loc => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            
            <div className="whatif-simulator__condition-group">
              <label>Platform</label>
              <select value={devicePlatform} onChange={(e) => setDevicePlatform(e.target.value as DevicePlatform)}>
                <option value="all">Any Platform</option>
                <option value="windows">Windows</option>
                <option value="macOS">macOS</option>
                <option value="iOS">iOS</option>
                <option value="android">Android</option>
                <option value="linux">Linux</option>
              </select>
            </div>
            
            <div className="whatif-simulator__condition-group">
              <label>Device Status</label>
              <select value={deviceCompliance} onChange={(e) => setDeviceCompliance(e.target.value as DeviceCompliance)}>
                <option value="all">Any Status</option>
                <option value="compliant">Compliant</option>
                <option value="hybridJoined">Hybrid AD Joined</option>
                <option value="registered">AD Registered</option>
                <option value="unmanaged">Unmanaged</option>
              </select>
            </div>
            
            <div className="whatif-simulator__condition-group">
              <label>Client App</label>
              <select value={clientApp} onChange={(e) => setClientApp(e.target.value as ClientAppType)}>
                <option value="all">Any Client</option>
                <option value="browser">Browser</option>
                <option value="mobileDesktop">Mobile/Desktop</option>
                <option value="legacy">Legacy Auth</option>
              </select>
            </div>
            
            <div className="whatif-simulator__condition-group">
              <label>Sign-in Risk</label>
              <select value={signInRisk} onChange={(e) => setSignInRisk(e.target.value as RiskLevel)}>
                <option value="none">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            
            <div className="whatif-simulator__condition-group">
              <label>User Risk</label>
              <select value={userRisk} onChange={(e) => setUserRisk(e.target.value as RiskLevel)}>
                <option value="none">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
        </div>
        
        {/* Right Column: Results */}
        <div className="whatif-simulator__results-panel">
          {showCommonGaps && commonGaps.length > 0 && !result && (
            <div className="whatif-simulator__common-gaps">
              <h3>Gap Analysis</h3>
              <p className="whatif-simulator__common-gaps-intro">
                Detected gaps in selected policies:
              </p>
              <div className="whatif-simulator__gaps-list">
                {commonGaps.slice(0, 5).map(gap => (
                  <div 
                    key={gap.id} 
                    className="whatif-simulator__gap-card-compact"
                    style={{ borderLeftColor: severityColors[gap.severity] }}
                  >
                    <div className="whatif-simulator__gap-header">
                      <span>{severityIcons[gap.severity]}</span>
                      <span style={{ color: severityColors[gap.severity] }}>{gap.severity.toUpperCase()}</span>
                    </div>
                    <h4>{gap.title}</h4>
                    <p>{gap.recommendation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {result && (
            <>
              {/* Decision Summary */}
              <div className={`whatif-simulator__decision whatif-simulator__decision--${result.finalDecision}`}>
                <div className="whatif-simulator__decision-icon">
                  {result.finalDecision === 'block' ? '🚫' : 
                   result.finalDecision === 'grant' ? '✅' : '⚠️'}
                </div>
                <div className="whatif-simulator__decision-text">
                  <h3>{result.summary}</h3>
                  <p>
                    {result.matchingPolicies.length} matching, {result.excludedPolicies.length} excluded
                  </p>
                </div>
              </div>
              
              {/* Required Controls */}
              {result.requiredControls.length > 0 && (
                <div className="whatif-simulator__controls-compact">
                  <h4>Required Controls</h4>
                  <div className="whatif-simulator__control-chips">
                    {result.requiredControls.map(control => (
                      <span key={control} className={`control-chip control-chip--${control}`}>
                        {formatControl(control)}
                      </span>
                    ))}
                  </div>
                  {result.authenticationStrength && (
                    <div className="whatif-simulator__auth-strength">
                      Auth Strength: {result.authenticationStrength}
                    </div>
                  )}
                </div>
              )}
              
              {/* Matching Policies */}
              {result.matchingPolicies.length > 0 && (
                <div className="whatif-simulator__matching-policies">
                  <h4>Matching Policies ({result.matchingPolicies.length})</h4>
                  {result.matchingPolicies.map(policy => (
                    <div 
                      key={policy.policyId} 
                      className={`whatif-simulator__policy-result ${policy.isBlocking ? 'blocking' : ''}`}
                      onClick={() => onPolicySelect?.(policy.policyId)}
                    >
                      <div className="whatif-simulator__policy-result-header">
                        <span className="name">{policy.policyName}</span>
                        <span className={`state state--${policy.policyState}`}>
                          {policy.policyState === 'enabled' ? '●' : '○'}
                        </span>
                      </div>
                      <div className="whatif-simulator__policy-result-controls">
                        {policy.grantControls.map(c => (
                          <span key={c} className={`control-chip-sm control-chip-sm--${c}`}>
                            {formatControlShort(c)}
                          </span>
                        ))}
                      </div>
                      {policy.locationConfig && (
                        <div className="whatif-simulator__policy-location-sm">
                          {policy.locationConfig.interpretation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              {/* Scenario-Specific Gaps */}
              {result.gaps.length > 0 && (
                <div className="whatif-simulator__scenario-gaps-compact">
                  <h4>Gaps for This Scenario</h4>
                  {result.gaps.map(gap => (
                    <div 
                      key={gap.id} 
                      className="whatif-simulator__gap-inline"
                      style={{ borderLeftColor: severityColors[gap.severity] }}
                    >
                      <span>{severityIcons[gap.severity]} {gap.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          
          {!result && commonGaps.length === 0 && (
            <div className="whatif-simulator__empty">
              <p>Select policies and conditions, then click "Evaluate Scenario"</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatControl(control: string): string {
  const labels: Record<string, string> = {
    mfa: '🔐 MFA',
    block: '🚫 Block',
    compliantDevice: '📱 Compliant Device',
    domainJoinedDevice: '💻 Hybrid AD Join',
    approvedApplication: '✅ Approved App',
    compliantApplication: '🛡️ App Protection',
    passwordChange: '🔑 Password Change',
    authenticationStrength: '⚡ Auth Strength'
  }
  return labels[control] || control
}

function formatControlShort(control: string): string {
  const labels: Record<string, string> = {
    mfa: 'MFA',
    block: 'Block',
    compliantDevice: 'Compliant',
    domainJoinedDevice: 'Hybrid',
    approvedApplication: 'Approved',
    compliantApplication: 'Protected',
    passwordChange: 'PW Change',
    authenticationStrength: 'Auth Str.'
  }
  return labels[control] || control
}

export default WhatIfSimulator
