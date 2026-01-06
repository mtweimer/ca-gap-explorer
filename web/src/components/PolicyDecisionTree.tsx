/**
 * PolicyDecisionTree - Interactive decision tree visualization for CA policies
 * 
 * Features:
 * - Mermaid-based flowchart rendering
 * - Policy selection with color coding
 * - Gap highlighting
 * - Overlap detection
 * - Click-to-expand node details
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  buildDecisionTree,
  assignPolicyColors,
  findGaps,
  findOverlaps,
  type PolicyData,
  type DecisionNode
} from '../utils/decisionTreeBuilder'
import {
  generateMermaidDiagram,
  generateSinglePolicyDiagram,
  type MermaidConfig
} from '../utils/mermaidGenerator'
import './PolicyDecisionTree.css'

interface PolicyDecisionTreeProps {
  policies: PolicyData[]
  selectedPolicyIds: Set<string>
  onPolicyToggle: (policyId: string) => void
  onSelectAll: () => void
  onSelectNone: () => void
}

export function PolicyDecisionTree({
  policies,
  selectedPolicyIds,
  onPolicyToggle,
  onSelectAll,
  onSelectNone
}: PolicyDecisionTreeProps) {
  const [viewMode, setViewMode] = useState<'unified' | 'single' | 'compare'>('unified')
  const [selectedSinglePolicy, setSelectedSinglePolicy] = useState<string | null>(null)
  const [detailNode, setDetailNode] = useState<DecisionNode | null>(null)
  const [mermaidConfig, setMermaidConfig] = useState<MermaidConfig>({
    direction: 'TD',
    showPolicyNames: false,
    showPolicyCounts: true,
    highlightGaps: true,
    highlightOverlaps: true
  })
  const [searchTerm, setSearchTerm] = useState('')
  const diagramRef = useRef<HTMLDivElement>(null)
  const [diagramSvg, setDiagramSvg] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Assign colors to policies
  const policyColors = useMemo(() => assignPolicyColors(policies), [policies])

  // Build the decision tree
  const tree = useMemo(() => {
    if (selectedPolicyIds.size === 0) return null
    return buildDecisionTree(policies, selectedPolicyIds)
  }, [policies, selectedPolicyIds])

  // Find gaps and overlaps
  const gaps = useMemo(() => tree ? findGaps(tree) : [], [tree])
  const overlaps = useMemo(() => tree ? findOverlaps(tree) : new Map(), [tree])

  // Generate Mermaid diagram
  const mermaidCode = useMemo(() => {
    if (viewMode === 'single' && selectedSinglePolicy) {
      const policy = policies.find(p => p.id === selectedSinglePolicy)
      if (policy) {
        return generateSinglePolicyDiagram(policy)
      }
    }
    
    if (tree && viewMode === 'unified') {
      return generateMermaidDiagram(tree, policyColors, mermaidConfig)
    }
    
    return null
  }, [tree, viewMode, selectedSinglePolicy, policies, policyColors, mermaidConfig])

  // Render Mermaid diagram
  const renderMermaid = useCallback(async (code: string) => {
    setIsLoading(true)
    setError(null)
    
    try {
      // Dynamic import of mermaid
      const mermaid = await import('mermaid')
      mermaid.default.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          primaryColor: '#2d3748',
          primaryTextColor: '#e2e8f0',
          primaryBorderColor: '#4a5568',
          lineColor: '#718096',
          secondaryColor: '#4a5568',
          tertiaryColor: '#1a202c'
        },
        flowchart: {
          useMaxWidth: true,
          htmlLabels: true,
          curve: 'basis'
        },
        securityLevel: 'loose'
      })
      
      const { svg } = await mermaid.default.render('mermaid-diagram', code)
      setDiagramSvg(svg)
    } catch (err) {
      console.error('Mermaid rendering error:', err)
      setError(`Failed to render diagram: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (mermaidCode) {
      renderMermaid(mermaidCode)
    } else {
      setDiagramSvg('')
    }
  }, [mermaidCode, renderMermaid])

  // Filter policies by search
  const filteredPolicies = useMemo(() => {
    if (!searchTerm) return policies
    const term = searchTerm.toLowerCase()
    return policies.filter(p => p.displayName.toLowerCase().includes(term))
  }, [policies, searchTerm])

  // Stats
  const stats = useMemo(() => ({
    total: policies.length,
    selected: selectedPolicyIds.size,
    enabled: policies.filter(p => selectedPolicyIds.has(p.id) && p.state === 'enabled').length,
    reportOnly: policies.filter(p => selectedPolicyIds.has(p.id) && p.state === 'enabledForReportingButNotEnforced').length,
    disabled: policies.filter(p => selectedPolicyIds.has(p.id) && p.state === 'disabled').length,
    gaps: gaps.length,
    overlaps: overlaps.size
  }), [policies, selectedPolicyIds, gaps, overlaps])

  const getStateClass = (state: string) => {
    if (state === 'enabled') return 'state--enabled'
    if (state === 'enabledForReportingButNotEnforced') return 'state--report'
    return 'state--disabled'
  }

  const getPolicyColor = (policyId: string): string => {
    return policyColors.find(c => c.id === policyId)?.color || '#718096'
  }

  return (
    <div className="policy-decision-tree">
      {/* Header */}
      <div className="pdt-header">
        <div className="pdt-header__title">
          <h2>Policy Decision Tree</h2>
          <p>Visualize how CA policies evaluate sign-in requests</p>
        </div>
        
        <div className="pdt-header__stats">
          <div className="pdt-stat">
            <span className="pdt-stat__value">{stats.selected}</span>
            <span className="pdt-stat__label">Selected</span>
          </div>
          <div className="pdt-stat pdt-stat--enabled">
            <span className="pdt-stat__value">{stats.enabled}</span>
            <span className="pdt-stat__label">Enabled</span>
          </div>
          <div className="pdt-stat pdt-stat--report">
            <span className="pdt-stat__value">{stats.reportOnly}</span>
            <span className="pdt-stat__label">Report Only</span>
          </div>
          {stats.gaps > 0 && (
            <div className="pdt-stat pdt-stat--gap">
              <span className="pdt-stat__value">{stats.gaps}</span>
              <span className="pdt-stat__label">Gaps Found</span>
            </div>
          )}
          {stats.overlaps > 0 && (
            <div className="pdt-stat pdt-stat--overlap">
              <span className="pdt-stat__value">{stats.overlaps}</span>
              <span className="pdt-stat__label">Overlaps</span>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="pdt-controls">
        <div className="pdt-controls__view">
          <button
            className={viewMode === 'unified' ? 'active' : ''}
            onClick={() => setViewMode('unified')}
          >
            Unified Tree
          </button>
          <button
            className={viewMode === 'single' ? 'active' : ''}
            onClick={() => setViewMode('single')}
          >
            Single Policy
          </button>
        </div>

        <div className="pdt-controls__options">
          <label>
            <input
              type="checkbox"
              checked={mermaidConfig.showPolicyCounts}
              onChange={e => setMermaidConfig(c => ({ ...c, showPolicyCounts: e.target.checked }))}
            />
            Show Counts
          </label>
          <label>
            <input
              type="checkbox"
              checked={mermaidConfig.highlightGaps}
              onChange={e => setMermaidConfig(c => ({ ...c, highlightGaps: e.target.checked }))}
            />
            Highlight Gaps
          </label>
          <label>
            <input
              type="checkbox"
              checked={mermaidConfig.highlightOverlaps}
              onChange={e => setMermaidConfig(c => ({ ...c, highlightOverlaps: e.target.checked }))}
            />
            Highlight Overlaps
          </label>
          <select
            value={mermaidConfig.direction}
            onChange={e => setMermaidConfig(c => ({ ...c, direction: e.target.value as MermaidConfig['direction'] }))}
          >
            <option value="TD">Top to Bottom</option>
            <option value="LR">Left to Right</option>
          </select>
        </div>
      </div>

      {/* Main content area */}
      <div className="pdt-content">
        {/* Policy selector sidebar */}
        <div className="pdt-sidebar">
          <div className="pdt-sidebar__header">
            <h3>Policies</h3>
            <div className="pdt-sidebar__actions">
              <button onClick={onSelectAll}>All</button>
              <button onClick={onSelectNone}>None</button>
            </div>
          </div>
          
          <div className="pdt-sidebar__search">
            <input
              type="text"
              placeholder="Search policies..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="pdt-sidebar__list">
            {filteredPolicies.map(policy => {
              const isSelected = selectedPolicyIds.has(policy.id)
              const color = getPolicyColor(policy.id)
              
              return (
                <div
                  key={policy.id}
                  className={`pdt-policy-item ${isSelected ? 'pdt-policy-item--selected' : ''} ${getStateClass(policy.state)}`}
                  onClick={() => onPolicyToggle(policy.id)}
                >
                  <div
                    className="pdt-policy-item__color"
                    style={{ backgroundColor: isSelected ? color : 'transparent', borderColor: color }}
                  />
                  <div className="pdt-policy-item__content">
                    <span className="pdt-policy-item__name">{policy.displayName}</span>
                    <span className={`pdt-policy-item__state ${getStateClass(policy.state)}`}>
                      {policy.state === 'enabled' ? 'On' : policy.state === 'enabledForReportingButNotEnforced' ? 'Report' : 'Off'}
                    </span>
                  </div>
                  {viewMode === 'single' && (
                    <button
                      className="pdt-policy-item__view"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedSinglePolicy(policy.id)
                      }}
                    >
                      View
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Diagram area */}
        <div className="pdt-diagram">
          {isLoading && (
            <div className="pdt-diagram__loading">
              <div className="pdt-spinner" />
              <span>Generating diagram...</span>
            </div>
          )}
          
          {error && (
            <div className="pdt-diagram__error">
              <span className="pdt-error-icon">⚠️</span>
              <span>{error}</span>
              <button onClick={() => mermaidCode && renderMermaid(mermaidCode)}>
                Retry
              </button>
            </div>
          )}
          
          {!isLoading && !error && selectedPolicyIds.size === 0 && (
            <div className="pdt-diagram__empty">
              <span className="pdt-empty-icon">📊</span>
              <h3>Select Policies to Analyze</h3>
              <p>Choose one or more policies from the sidebar to visualize their decision flow.</p>
              <button onClick={onSelectAll}>Select All Policies</button>
            </div>
          )}
          
          {!isLoading && !error && selectedPolicyIds.size > 0 && !diagramSvg && viewMode === 'single' && !selectedSinglePolicy && (
            <div className="pdt-diagram__empty">
              <span className="pdt-empty-icon">👆</span>
              <h3>Select a Policy to View</h3>
              <p>Click the "View" button next to a policy in the sidebar.</p>
            </div>
          )}
          
          {!isLoading && !error && diagramSvg && (
            <div
              ref={diagramRef}
              className="pdt-diagram__svg"
              dangerouslySetInnerHTML={{ __html: diagramSvg }}
            />
          )}

          {/* Code view toggle */}
          {mermaidCode && (
            <details className="pdt-diagram__code">
              <summary>View Mermaid Code</summary>
              <pre>{mermaidCode}</pre>
            </details>
          )}
        </div>

        {/* Details panel */}
        {detailNode && (
          <div className="pdt-details">
            <div className="pdt-details__header">
              <h3>{detailNode.label}</h3>
              <button onClick={() => setDetailNode(null)}>×</button>
            </div>
            <div className="pdt-details__content">
              {detailNode.sublabel && (
                <p className="pdt-details__sublabel">{detailNode.sublabel}</p>
              )}
              <div className="pdt-details__section">
                <h4>Policies at this node ({detailNode.policies.length})</h4>
                <ul>
                  {detailNode.policyNames.map((name, i) => (
                    <li key={i}>
                      <span
                        className="pdt-details__color"
                        style={{ backgroundColor: getPolicyColor(detailNode.policies[i]) }}
                      />
                      {name}
                      <span className={`pdt-details__state ${getStateClass(detailNode.policyStates[detailNode.policies[i]])}`}>
                        {detailNode.policyStates[detailNode.policies[i]] === 'enabled' ? 'On' :
                         detailNode.policyStates[detailNode.policies[i]] === 'enabledForReportingButNotEnforced' ? 'Report' : 'Off'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {detailNode.grantControls && (
                <div className="pdt-details__section">
                  <h4>Grant Controls</h4>
                  <div className="pdt-details__controls">
                    {detailNode.grantControls.map((ctrl, i) => (
                      <span key={i} className="pdt-details__control">
                        {formatControl(ctrl)}
                      </span>
                    ))}
                    {detailNode.grantOperator && (
                      <span className="pdt-details__operator">
                        {detailNode.grantOperator === 'AND' ? 'Require ALL' : 'Require ONE'}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Gaps summary */}
      {gaps.length > 0 && mermaidConfig.highlightGaps && (
        <div className="pdt-gaps">
          <h3>Coverage Gaps ({gaps.length})</h3>
          <p>These condition paths have no policy coverage:</p>
          <div className="pdt-gaps__list">
            {gaps.map((gap, i) => (
              <div key={i} className="pdt-gap-item">
                <span className="pdt-gap-item__icon">⚠️</span>
                <span className="pdt-gap-item__label">{gap.label}</span>
                {gap.conditionField && (
                  <span className="pdt-gap-item__field">{gap.conditionField}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      {selectedPolicyIds.size > 0 && (
        <div className="pdt-legend">
          <h4>Policy Colors</h4>
          <div className="pdt-legend__items">
            {policyColors
              .filter(c => selectedPolicyIds.has(c.id))
              .map(pc => (
                <div key={pc.id} className="pdt-legend__item">
                  <span
                    className="pdt-legend__color"
                    style={{ backgroundColor: pc.color }}
                  />
                  <span className="pdt-legend__name">{pc.name}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

function formatControl(control: string): string {
  const labels: Record<string, string> = {
    mfa: 'MFA',
    block: 'Block',
    compliantDevice: 'Compliant Device',
    domainJoinedDevice: 'Hybrid AD Join',
    approvedApplication: 'Approved App',
    compliantApplication: 'App Protection',
    passwordChange: 'Password Change'
  }
  if (control.startsWith('authStrength:')) {
    return control.replace('authStrength:', 'Auth: ')
  }
  return labels[control] || control
}

