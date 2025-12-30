import { useMemo, useState, useEffect } from 'react'
import type { GraphData } from '../types/graph'
import { calculateCoverageByGrantControl, calculateCoverageByCondition, type GrantControlCoverage } from '../utils/coverage'
import { GRANT_CONTROL_LABELS } from '../utils/policyGrouping'
import { buildObjectsIndexWithCountsSync } from '../utils/objectsIndexWithCounts'
import { ExclusionsPanel } from './ExclusionsPanel'
import { PolicyOrganizer } from './PolicyOrganizer'
import './GapBuilderTab.css'

type GapBuilderProps = {
  graphData: GraphData
  selectedPolicyIds: Set<string>
  policySummaries: Array<{ id: string; label: string; stateKey: string; stateLabel: string }>
}

export function GapBuilderTab({ graphData, selectedPolicyIds, policySummaries }: GapBuilderProps) {
  const [viewMode, setViewMode] = useState<'grantControl' | 'condition'>('grantControl')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [counts, setCounts] = useState<any>(null)

  // Load counts.json on mount
  useEffect(() => {
    fetch('/entities/counts.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => setCounts(c))
      .catch(() => setCounts(null))
  }, [])

  // Build index with actual counts
  const indexWithCounts = useMemo(() => {
    return buildObjectsIndexWithCountsSync(graphData, null, counts)
  }, [graphData, counts])

  // Calculate coverage by grant control or condition
  const coverageResult = useMemo(() => {
    if (selectedPolicyIds.size === 0) return null
    if (viewMode === 'condition') {
      // For condition view, return a compatible structure
      const byCondition = calculateCoverageByCondition(graphData, selectedPolicyIds, indexWithCounts)
      // Calculate overall
      return {
        byGrantControl: byCondition, // Reuse the same structure
        overall: byCondition.get('All Conditions') || {
          users: { covered: new Set(), excluded: new Set(), uncovered: new Set(), total: 0, actualTotal: indexWithCounts.totals.user, coveredCount: 0, uncoveredCount: 0 },
          applications: { covered: new Set(), excluded: new Set(), uncovered: new Set(), total: 0, actualTotal: indexWithCounts.totals.servicePrincipal, coveredCount: 0, uncoveredCount: 0 },
          networks: { includedLocations: new Set(), excludedLocations: new Set(), isGlobal: false, note: 'No conditions' }
        }
      }
    }
    return calculateCoverageByGrantControl(graphData, selectedPolicyIds, indexWithCounts)
  }, [graphData, selectedPolicyIds, indexWithCounts, viewMode])

  const toggleGroup = (key: string) => {
    const next = new Set(expandedGroups)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpandedGroups(next)
  }

  const formatPercent = (covered: number, total: number) => {
    if (total === 0) return '0%'
    return Math.round((covered / total) * 100) + '%'
  }

  const exportCoverage = () => {
    if (!coverageResult) return

    const rows: string[][] = [
      ['Grant Control', 'Policies', 'Users Covered', 'Users Uncovered', 'Users Excluded', 'Users Total', 'Users %', 'Apps Covered', 'Apps Uncovered', 'Apps Excluded', 'Apps Total', 'Apps %', 'Network Note']
    ]

    for (const [gc, cov] of coverageResult.byGrantControl.entries()) {
      // Use coveredCount/uncoveredCount if available (when "All" is used), otherwise use Set sizes
      const usersCovered = cov.users.coveredCount !== undefined ? cov.users.coveredCount : cov.users.covered.size
      const usersUncovered = cov.users.uncoveredCount !== undefined ? cov.users.uncoveredCount : cov.users.uncovered.size
      const usersExcluded = cov.users.excluded.size
      const usersTotal = cov.users.actualTotal || cov.users.total
      
      const appsCovered = cov.applications.coveredCount !== undefined ? cov.applications.coveredCount : cov.applications.covered.size
      const appsUncovered = cov.applications.uncoveredCount !== undefined ? cov.applications.uncoveredCount : cov.applications.uncovered.size
      const appsExcluded = cov.applications.excluded.size
      const appsTotal = cov.applications.actualTotal || cov.applications.total
      
      const userPct = formatPercent(usersCovered, usersTotal)
      const appPct = formatPercent(appsCovered, appsTotal)
      
      rows.push([
        GRANT_CONTROL_LABELS[gc] || gc,
        String(cov.policyCount),
        String(usersCovered),
        String(usersUncovered),
        String(usersExcluded),
        String(usersTotal),
        userPct,
        String(appsCovered),
        String(appsUncovered),
        String(appsExcluded),
        String(appsTotal),
        appPct,
        cov.networks.note
      ])
    }

    const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gap-analysis-${new Date().toISOString().split('T')[0]}.csv`
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  return (
    <div className="gap-builder">
      <div className="gap-builder__main">
        <div className="gap-builder__header">
          <h2>Gap Analysis</h2>
          <p className="gap-builder__hint">
            Select policies from the sidebar and use filters to analyze coverage across users, applications, and networks.
          </p>
        </div>

        <div className="gap-builder__controls">
          <div className="gap-builder__control-group">
            <label className="gap-builder__control-label">View Mode:</label>
            <div className="gap-builder__toggle">
              <button
                className={`gap-builder__toggle-btn ${viewMode === 'grantControl' ? 'active' : ''}`}
                onClick={() => setViewMode('grantControl')}
              >
                By Grant Control
              </button>
              <button
                className={`gap-builder__toggle-btn ${viewMode === 'condition' ? 'active' : ''}`}
                onClick={() => setViewMode('condition')}
              >
                By Condition
              </button>
            </div>
          </div>

          {coverageResult && (
            <button className="gap-builder__export-btn" onClick={exportCoverage}>
              Export CSV
            </button>
          )}
        </div>

        <div className="gap-builder__content">
        {!coverageResult ? (
          <div className="gap-builder__empty">
            <p>Select at least one policy from the left sidebar to compute coverage.</p>
            <p className="gap-builder__empty-hint">
              Policies: {selectedPolicyIds.size} selected
            </p>
          </div>
        ) : (
          <div className="gap-builder__results">
            {/* Overall Summary */}
            <div className="gap-builder__overall">
              <h3>Overall Coverage ({selectedPolicyIds.size} policies)</h3>
              <div className="gap-builder__overall-grid">
                <CoverageCard
                  title="Users"
                  coverage={coverageResult.overall.users}
                />
                <CoverageCard
                  title="Applications"
                  coverage={coverageResult.overall.applications}
                />
                <div className="coverage-card">
                  <div className="coverage-card__header">
                    <strong>Networks</strong>
                  </div>
                  <div className="coverage-card__network-note">{coverageResult.overall.networks.note}</div>
                  {coverageResult.overall.networks.excludedLocations.size > 0 && (
                    <div className="coverage-card__detail">
                      Excluded Locations: {coverageResult.overall.networks.excludedLocations.size}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Exclusions Summary */}
            <ExclusionsPanel graphData={graphData} selectedPolicyIds={selectedPolicyIds} />

            {/* By Grant Control */}
            <div className="gap-builder__groups">
              <h3>Coverage by {viewMode === 'condition' ? 'Condition' : 'Grant Control'}</h3>
              {Array.from(coverageResult.byGrantControl.entries())
                .sort((a, b) => b[1].policyCount - a[1].policyCount)
                .map(([gc, cov]) => (
                  <GrantControlGroup
                    key={gc}
                    grantControl={gc}
                    coverage={cov}
                    isExpanded={expandedGroups.has(gc)}
                    onToggle={() => toggleGroup(gc)}
                    policies={policySummaries.filter((p) => cov.policyIds.includes(p.id))}
                    viewMode={viewMode}
                  />
                ))}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Right Sidebar with Policy Organization */}
      {selectedPolicyIds.size > 0 && (
        <div className="gap-builder__sidebar">
          <PolicyOrganizer
            policies={graphData.nodes.filter(n => n.type === 'policy' && selectedPolicyIds.has(n.id))}
            onShowDetails={(policyId) => {
              console.log('Show details for', policyId)
            }}
          />
        </div>
      )}
    </div>
  )
}

// Coverage Card Component
function CoverageCard({
  title,
  coverage
}: {
  title: string
  coverage: any
}) {
  // Use coveredCount and uncoveredCount if available (when "All" is used)
  // Otherwise fall back to Set sizes
  const covered = coverage.coveredCount !== undefined ? coverage.coveredCount : coverage.covered.size
  const uncovered = coverage.uncoveredCount !== undefined ? coverage.uncoveredCount : coverage.uncovered.size
  const excluded = coverage.excluded.size
  const total = coverage.actualTotal || coverage.total

  const coveredPct = total > 0 ? Math.round((covered / total) * 100) : 0
  const uncoveredPct = total > 0 ? Math.round((uncovered / total) * 100) : 0

  return (
    <div className="coverage-card">
      <div className="coverage-card__header">
        <strong>{title}</strong>
        <span className="coverage-card__summary">
          {covered} / {total} ({coveredPct}%)
        </span>
      </div>
      <div className="coverage-card__bar">
        <div className="coverage-card__bar-fill" style={{ width: `${coveredPct}%` }} />
      </div>
      <div className="coverage-card__details">
        <span>Covered: {covered}</span>
        <span>Uncovered: {uncovered} ({uncoveredPct}%)</span>
        <span>Excluded: {excluded}</span>
      </div>
    </div>
  )
}

// Grant Control Group Component
function GrantControlGroup({
  grantControl,
  coverage,
  isExpanded,
  onToggle,
  policies,
  viewMode = 'grantControl'
}: {
  grantControl: string
  coverage: GrantControlCoverage
  isExpanded: boolean
  onToggle: () => void
  policies: Array<{ id: string; label: string; stateKey: string; stateLabel: string }>
  viewMode?: 'grantControl' | 'condition'
}) {
  // If in condition mode, use the key as-is (e.g., "User Risk")
  // Otherwise, look up the grant control label
  const label = viewMode === 'condition' ? grantControl : (GRANT_CONTROL_LABELS[grantControl] || grantControl)

  return (
    <div className="grant-control-group">
      <div className="grant-control-group__header" onClick={onToggle}>
        <div className="grant-control-group__title">
          <span className="grant-control-group__expand">{isExpanded ? '▼' : '▶'}</span>
          <strong>{label}</strong>
          <span className="grant-control-group__count">({coverage.policyCount} policies)</span>
        </div>
      </div>

      <div className="grant-control-group__coverage">
        <CoverageCard
          title="Users"
          coverage={coverage.users}
        />
        <CoverageCard
          title="Applications"
          coverage={coverage.applications}
        />
        <div className="coverage-card">
          <div className="coverage-card__header">
            <strong>Networks</strong>
          </div>
          <div className="coverage-card__network-note">{coverage.networks.note}</div>
        </div>
      </div>

      {isExpanded && (
        <div className="grant-control-group__policies">
          <h4>Policies in this group:</h4>
          <ul>
            {policies.map((p) => (
              <li key={p.id}>
                {p.label} <span className={`badge badge--${p.stateKey}`}>{p.stateLabel}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
