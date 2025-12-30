import { useEffect, useMemo, useState } from 'react'
import { GraphView } from './components/GraphView'
import { FilterBar } from './components/FilterBar'
import { PolicySummary } from './components/PolicySummary'
import { PolicyDetailsModal } from './components/PolicyDetailsModal'
import { ExposureMatrix } from './components/ExposureMatrix'
import { GroupMembershipTree } from './components/GroupMembershipTree'
import { ConditionAnalyzer } from './components/ConditionAnalyzer'
import { ObjectsTab } from './components/ObjectsTab'
import { GapBuilderTab } from './components/GapBuilderTab'
import { PolicyOrganizer } from './components/PolicyOrganizer'
import { loadGraphData } from './data/loadGraphData'
import type { GraphData } from './types/graph'
import './App.css'

function App() {
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<Set<string>>(new Set())
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set())
  const [selectedGrants, setSelectedGrants] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'gaps' | 'graph' | 'table' | 'objects' | 'exposure' | 'groups' | 'conditions'>('gaps')
  const [detailsPolicyId, setDetailsPolicyId] = useState<string | null>(null)
  const [expandMembership, setExpandMembership] = useState<boolean>(false)

  useEffect(() => {
    async function loadData() {
      try {
        const data = await loadGraphData()
        setGraphData(data)
        // Do not auto-select a policy; allow blank graph until user chooses
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    loadData().catch((err) => {
      console.error(err)
    })
  }, [])

  const policySummaries = useMemo(() => {
    if (!graphData) return []
    const policyNodes = graphData.nodes.filter((node) => node.type === 'policy')
    const mapState = (raw: unknown) => {
      const s = String(raw ?? 'unknown')
      if (s === 'enabledForReportingButNotEnforced') return { key: 'reportOnly', label: 'Report Only' }
      if (s === 'enabled') return { key: 'enabled', label: 'Enabled' }
      if (s === 'disabled') return { key: 'disabled', label: 'Disabled' }
      return { key: s, label: s }
    }
    const items = policyNodes.map((node) => {
      const st = mapState(node.properties?.state)
      return {
        id: node.id,
        label: node.label,
        stateKey: st.key,
        stateLabel: st.label,
        grantControls: Array.isArray(node.properties?.grantControls)
          ? (node.properties?.grantControls as unknown[]).map(String)
          : []
      }
    })

    return items
  }, [graphData])

  const allStates = useMemo(() => {
    const s = new Set<string>()
    for (const p of policySummaries) s.add(p.stateLabel)
    return Array.from(s).sort()
  }, [policySummaries])

  const allGrantControls = useMemo(() => {
    const g = new Set<string>()
    for (const p of policySummaries) {
      // @ts-ignore added at runtime
      for (const gc of p.grantControls ?? []) g.add(String(gc))
    }
    return Array.from(g).sort()
  }, [policySummaries])

  const filteredPolicies = useMemo(() => {
    const text = search.trim().toLowerCase()
    const stateActive = selectedStates.size > 0
    const grantsActive = selectedGrants.size > 0
    return policySummaries.filter((p) => {
      if (stateActive && !selectedStates.has(p.stateLabel)) return false
      // @ts-ignore
      const pGrants: string[] = p.grantControls ?? []
      if (grantsActive && !pGrants.some((gc) => selectedGrants.has(gc))) return false
      if (text && !p.label.toLowerCase().includes(text)) return false
      return true
    })
  }, [policySummaries, search, selectedStates, selectedGrants])

  const selectedPoliciesData = useMemo(() => {
    if (!graphData || selectedPolicyIds.size === 0) return null

    const policies = Array.from(selectedPolicyIds)
      .map((id) => graphData.nodes.find((n) => n.id === id && n.type === 'policy'))
      .filter((p): p is typeof graphData.nodes[0] => p !== undefined)

    if (policies.length === 0) return null

    // Gather edges from all selected policies
    const allEdges = graphData.edges.filter((e) => selectedPolicyIds.has(e.from))

    // Build neighborhood: all selected policies + all their targets
    const neighborNodeIds = new Set<string>()
    for (const p of policies) neighborNodeIds.add(p.id)
    for (const e of allEdges) neighborNodeIds.add(e.to)

    const neighborhood: GraphData = {
      generatedAt: graphData.generatedAt,
      metadata: graphData.metadata,
      nodes: graphData.nodes.filter((n) => neighborNodeIds.has(n.id)),
      edges: allEdges
    }

    // Compute overlaps: which target entities are shared by multiple policies
    const targetToPolicies = new Map<string, Set<string>>()
    for (const e of allEdges) {
      if (!targetToPolicies.has(e.to)) targetToPolicies.set(e.to, new Set())
      targetToPolicies.get(e.to)!.add(e.from)
    }
    const overlappingTargets = Array.from(targetToPolicies.entries())
      .filter(([, pIds]) => pIds.size > 1)
      .map(([targetId, pIds]) => ({
        targetId,
        target: graphData.nodes.find((n) => n.id === targetId),
        policyIds: Array.from(pIds)
      }))

    return { policies, edges: allEdges, neighborhood, overlappingTargets }
  }, [graphData, selectedPolicyIds])

  if (loading) {
    return (
      <main className="app app--loading">
        <div className="loader" />
        <span>Loading conditional access graph…</span>
      </main>
    )
  }

  if (error) {
    return (
      <main className="app app--error">
        <h1>Conditional Access Gap Explorer</h1>
        <p className="error-message">{error}</p>
        <p>
          Ensure `conditional_access_graph.json` exists in `../output` or use the
          sample data provided in `scripts/sample-graph-data.json`.
        </p>
      </main>
    )
  }

  if (!graphData) {
    return (
      <main className="app app--empty">
        <h1>Conditional Access Gap Explorer</h1>
        <p>No graph data available.</p>
      </main>
    )
  }

  function togglePolicySelection(policyId: string) {
    const next = new Set(selectedPolicyIds)
    if (next.has(policyId)) {
      next.delete(policyId)
    } else {
      next.add(policyId)
    }
    setSelectedPolicyIds(next)
  }

  return (
    <main className="app">
      <header className="app__header">
        <div className="app__title">
          <h1>Conditional Access Gap Explorer</h1>
        </div>
        <FilterBar
          states={allStates}
          selectedStates={selectedStates}
          onToggleState={(s) => {
            const next = new Set(selectedStates)
            if (next.has(s)) next.delete(s)
            else next.add(s)
            setSelectedStates(next)
          }}
          grantControls={allGrantControls}
          selectedGrants={selectedGrants}
          onToggleGrant={(g) => {
            const next = new Set(selectedGrants)
            if (next.has(g)) next.delete(g)
            else next.add(g)
            setSelectedGrants(next)
          }}
          search={search}
          onSearchChange={setSearch}
          expandMembership={expandMembership}
          onToggleExpand={setExpandMembership}
        />
        <div className="app__view-toggle">
          <button
            type="button"
            className={viewMode === 'gaps' ? 'active' : ''}
            onClick={() => setViewMode('gaps')}
          >
            Gaps
          </button>
          <button
            type="button"
            className={viewMode === 'exposure' ? 'active' : ''}
            onClick={() => setViewMode('exposure')}
          >
            Exposures
          </button>
          <button
            type="button"
            className={viewMode === 'conditions' ? 'active' : ''}
            onClick={() => setViewMode('conditions')}
          >
            Conditions
          </button>
          <button
            type="button"
            className={viewMode === 'groups' ? 'active' : ''}
            onClick={() => setViewMode('groups')}
          >
            Groups
          </button>
          <button
            type="button"
            className={viewMode === 'graph' ? 'active' : ''}
            onClick={() => setViewMode('graph')}
          >
            Graph
          </button>
          <button
            type="button"
            className={viewMode === 'table' ? 'active' : ''}
            onClick={() => setViewMode('table')}
          >
            Table
          </button>
          <button
            type="button"
            className={viewMode === 'objects' ? 'active' : ''}
            onClick={() => setViewMode('objects')}
          >
            Objects
          </button>
        </div>
      </header>

      <section className="app__content">
        <div className="panel panel--left">
          <PolicySummary
            policies={filteredPolicies}
            selectedPolicyIds={selectedPolicyIds}
            onTogglePolicy={togglePolicySelection}
            onShowDetails={setDetailsPolicyId}
            onSelectAll={() => setSelectedPolicyIds(new Set(filteredPolicies.map(p => p.id)))}
            onSelectNone={() => setSelectedPolicyIds(new Set())}
          />
        </div>
        {viewMode === 'graph' ? (
          <>
            <div className="panel panel--main">
              <GraphView
                graph={selectedPoliciesData?.neighborhood ?? { generatedAt: '', metadata: {}, nodes: [], edges: [] }}
                selectedPolicyIds={selectedPolicyIds}
                expandMembership={expandMembership}
              />
            </div>
            {selectedPoliciesData && (
            <div className="panel panel--details">
              <PolicyOrganizer
                policies={selectedPoliciesData.policies}
                onShowDetails={setDetailsPolicyId}
              />
              <div className="details" style={{ display: 'none' }}>
                <h2>
                  {selectedPoliciesData.policies.length === 1
                    ? selectedPoliciesData.policies[0].label
                    : `${selectedPoliciesData.policies.length} Policies Selected`}
                </h2>
                {selectedPoliciesData.overlappingTargets.filter(ov => 
                  ov.target?.type !== 'keyword' && 
                  !ov.targetId.includes(':KW')
                ).length > 0 && (
                  <div className="details__overlaps">
                    <h3>
                      Overlapping Assignments (
                      {selectedPoliciesData.overlappingTargets.filter(ov => 
                        ov.target?.type !== 'keyword' && 
                        !ov.targetId.includes(':KW')
                      ).length})
                    </h3>
                    <ul>
                      {selectedPoliciesData.overlappingTargets
                        .filter(ov => ov.target?.type !== 'keyword' && !ov.targetId.includes(':KW'))
                        .map((ov) => {
                          // Add entity type badge
                          const entityType = ov.target?.type || 'unknown'
                          const typeLabel = entityType === 'user' ? 'User' 
                            : entityType === 'group' ? 'Group'
                            : entityType === 'role' ? 'Role'
                            : entityType === 'servicePrincipal' ? 'App'
                            : entityType === 'namedLocation' ? 'Location'
                            : entityType
                          
                          return (
                            <li key={ov.targetId}>
                              <span className="details__tag details__tag--info">{typeLabel}</span>
                              <span className="details__target">
                                {ov.target?.label ?? ov.targetId}
                              </span>
                              <span className="details__via">
                                Shared by {ov.policyIds.length} policies
                              </span>
                            </li>
                          )
                        })}
                    </ul>
                  </div>
                )}
                <h3>
                  All Assignments (
                  {selectedPoliciesData.edges.filter((e) => !e.relationship.includes('keyword')).length})
                </h3>
                <ul className="details__list">
                  {selectedPoliciesData.edges
                    .filter((edge) => !edge.relationship.includes('keyword'))
                    .map((edge, idx) => {
                      const viaArray = Array.isArray(edge.properties?.via) ? edge.properties.via : []
                      
                      // Format relationship label to be more human-readable
                      let relationshipLabel = edge.relationship
                        .replace('include:', 'Include ')
                        .replace('exclude:', 'Exclude ')
                        .replace('SERVICEPRINCIPAL', 'Application')
                        .replace('USER', 'User')
                        .replace('GROUP', 'Group')
                        .replace('ROLE', 'Role')
                        .replace('NAMEDLOCATION', 'Location')
                      
                      return (
                        <li key={`${edge.from}-${edge.to}-${edge.relationship}-${idx}`}>
                          <span className="details__relationship">{relationshipLabel}</span>
                          <span className="details__target">
                            {edge.properties?.targetDisplayName ?? edge.to}
                          </span>
                          {viaArray.length > 0 ? (
                            <span className="details__via">via {viaArray.join(' > ')}</span>
                          ) : null}
                          {edge.relationship.startsWith('exclude') ? (
                            <span className="details__tag details__tag--warning">Exclude</span>
                          ) : null}
                        </li>
                      )
                    })}
                </ul>
              </div>
            </div>
            )}
          </>
        ) : viewMode === 'table' ? (
          <div className="panel panel--table">
            <table className="policy-table">
              <thead>
                <tr>
                  <th>Policy Name</th>
                  <th>State</th>
                  <th>Grant Controls</th>
                  <th>Includes</th>
                  <th>Excludes</th>
                </tr>
              </thead>
              <tbody>
                {filteredPolicies.map((p) => {
                  const edges = graphData.edges.filter((e) => e.from === p.id)
                  const includes = edges.filter((e) => e.relationship.startsWith('include'))
                  const excludes = edges.filter((e) => e.relationship.startsWith('exclude'))
                  const node = graphData.nodes.find((n) => n.id === p.id)
                  const grants = Array.isArray(node?.properties?.grantControls)
                    ? (node?.properties?.grantControls as string[])
                    : []
                  return (
                    <tr 
                      key={p.id} 
                      className={selectedPolicyIds.has(p.id) ? 'selected' : ''}
                    >
                      <td 
                        onClick={() => setDetailsPolicyId(p.id)}
                        style={{ cursor: 'pointer' }}
                        title="Click to view details"
                      >
                        {p.label}
                      </td>
                      <td>
                        <span className={`badge badge--${p.stateKey}`}>{p.stateLabel}</span>
                      </td>
                      <td>{grants.join(', ')}</td>
                      <td>{includes.length}</td>
                      <td>{excludes.length}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
      </div>
        ) : viewMode === 'gaps' && graphData ? (
          <div className="panel panel--main">
            <GapBuilderTab
              graphData={graphData}
              selectedPolicyIds={selectedPolicyIds}
              policySummaries={policySummaries}
            />
          </div>
        ) : viewMode === 'objects' && graphData ? (
          <div className="panel panel--main">
            <ObjectsTab graphData={graphData} />
          </div>
        ) : viewMode === 'exposure' && graphData ? (
          <div className="panel panel--main panel--full">
            <ExposureMatrix graphData={graphData} />
          </div>
        ) : viewMode === 'groups' && graphData ? (
          <div className="panel panel--main panel--full">
            <GroupMembershipTree graphData={graphData} />
          </div>
        ) : viewMode === 'conditions' && graphData ? (
          <div className="panel panel--main panel--full">
            <ConditionAnalyzer graphData={graphData} />
          </div>
        ) : null}
      </section>

      <footer className="app__footer">
        <p>
          Data source: `conditional_access_graph.json` | Drop refreshed exports into `output/` then reload.
        </p>
      </footer>

      {detailsPolicyId && graphData && (
        <PolicyDetailsModal
          policyId={detailsPolicyId}
          graphData={graphData}
          onClose={() => setDetailsPolicyId(null)}
        />
      )}
    </main>
  )
}

export default App
