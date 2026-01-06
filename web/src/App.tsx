import { useEffect, useMemo, useState } from 'react'
import { GraphView } from './components/GraphView'
import { FilterBar } from './components/FilterBar'
import { PolicySummary } from './components/PolicySummary'
import { PolicyDetailsModal } from './components/PolicyDetailsModal'
import { GroupMembershipTree } from './components/GroupMembershipTree'
import { ConditionAnalyzer } from './components/ConditionAnalyzer'
import { GapBuilderTab } from './components/GapBuilderTab'
import { PolicyOrganizer } from './components/PolicyOrganizer'
import { PolicyTable } from './components/PolicyTable'
import { MemberModal, type Member } from './components/MemberModal'
import { WhatIfSimulator } from './components/WhatIfSimulator'
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
  const [viewMode, setViewMode] = useState<'gaps' | 'graph' | 'table' | 'groups' | 'conditions' | 'whatif'>('gaps')
  const [detailsPolicyId, setDetailsPolicyId] = useState<string | null>(null)
  const [expandMembership, setExpandMembership] = useState<boolean>(false)
  const [rawPolicies, setRawPolicies] = useState<any[]>([])
  
  // Member modal state for graph view
  const [memberModalOpen, setMemberModalOpen] = useState(false)
  const [selectedMemberEntity, setSelectedMemberEntity] = useState<{
    id: string
    type: 'group' | 'role'
    name: string
    members: Member[]
    nestedMembers?: Member[]
    nestedGroups?: Array<{ id: string; displayName: string; depth: number }>
    totalMemberCount?: number
  } | null>(null)
  const [groupsData, setGroupsData] = useState<any[]>([])
  const [rolesData, setRolesData] = useState<any[]>([])

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
    
    // Load groups and roles for member modal
    fetch('/entities/groups.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then(g => setGroupsData(g))
      .catch(() => setGroupsData([]))
    
    fetch('/entities/roles.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then(r => setRolesData(r))
      .catch(() => setRolesData([]))
    
    // Load raw policies for What If simulator
    fetch('/conditional_access_policies.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { policies: [] })
      .then(data => setRawPolicies(data.policies || []))
      .catch(() => setRawPolicies([]))
  }, [])

  const policySummaries = useMemo(() => {
    if (!graphData) return []
    const policyNodes = graphData.nodes.filter((node) => node.type === 'policy')
    const mapState = (raw: unknown) => {
      const s = String(raw ?? 'unknown')
      if (s === 'enabledForReportingButNotEnforced') return { key: 'reportOnly', label: 'Report Only', sortOrder: 2 }
      if (s === 'enabled') return { key: 'enabled', label: 'Enabled', sortOrder: 1 }
      if (s === 'disabled') return { key: 'disabled', label: 'Disabled', sortOrder: 3 }
      return { key: s, label: s, sortOrder: 4 }
    }
    const items = policyNodes.map((node) => {
      const st = mapState(node.properties?.state)
      return {
        id: node.id,
        label: node.label,
        stateKey: st.key,
        stateLabel: st.label,
        stateSortOrder: st.sortOrder,
        grantControls: Array.isArray(node.properties?.grantControls)
          ? (node.properties?.grantControls as unknown[]).map(String)
          : []
      }
    })

    // Sort by state: Enabled first, then Report Only, then Disabled
    items.sort((a, b) => a.stateSortOrder - b.stateSortOrder)
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

  // Handle node click from graph view to open member modal
  function handleGraphNodeClick(nodeId: string, nodeType: string, nodeLabel: string) {
    if (nodeType !== 'group' && nodeType !== 'role') return
    
    const source = nodeType === 'group' ? groupsData : rolesData
    const entity = source.find((e: any) => e.id === nodeId)
    
    if (entity) {
      setSelectedMemberEntity({
        id: nodeId,
        type: nodeType as 'group' | 'role',
        name: nodeLabel || entity.displayName,
        members: entity.members || [],
        nestedMembers: entity.nestedMembers || [],
        nestedGroups: entity.nestedGroups || [],
        totalMemberCount: entity.totalMemberCount
      })
      setMemberModalOpen(true)
    }
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
            title="Coverage analysis and gap identification"
          >
            Coverage
          </button>
          <button
            type="button"
            className={viewMode === 'table' ? 'active' : ''}
            onClick={() => setViewMode('table')}
            title="All policies with expandable details"
          >
            Policies
          </button>
          <button
            type="button"
            className={viewMode === 'conditions' ? 'active' : ''}
            onClick={() => setViewMode('conditions')}
            title="Analyze by condition, grant, and session controls"
          >
            Analyzer
          </button>
          <button
            type="button"
            className={viewMode === 'groups' ? 'active' : ''}
            onClick={() => setViewMode('groups')}
            title="Group membership drill-down"
          >
            Groups
          </button>
          <button
            type="button"
            className={viewMode === 'graph' ? 'active' : ''}
            onClick={() => setViewMode('graph')}
            title="Visual policy relationships"
          >
            Graph
          </button>
          <button
            type="button"
            className={viewMode === 'whatif' ? 'active' : ''}
            onClick={() => setViewMode('whatif')}
            title="What If? Policy Simulator"
          >
            What If
          </button>
        </div>
      </header>

      <section className="app__content">
        {/* Hide sidebar for What If and Analyzer views - they have integrated policy selectors */}
        {viewMode !== 'whatif' && viewMode !== 'conditions' && (
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
        )}
        {viewMode === 'graph' ? (
          <>
            <div className="panel panel--main">
              <GraphView
                graph={selectedPoliciesData?.neighborhood ?? { generatedAt: '', metadata: {}, nodes: [], edges: [] }}
                selectedPolicyIds={selectedPolicyIds}
                expandMembership={expandMembership}
                onNodeClick={handleGraphNodeClick}
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
          <div className="panel panel--table panel--full">
            <PolicyTable
              graphData={graphData}
              policies={filteredPolicies}
              selectedPolicyIds={selectedPolicyIds}
              onShowDetails={setDetailsPolicyId}
            />
          </div>
        ) : viewMode === 'gaps' && graphData ? (
          <div className="panel panel--main">
            <GapBuilderTab
              graphData={graphData}
              selectedPolicyIds={selectedPolicyIds}
              rawPolicies={rawPolicies}
            />
          </div>
        ) : viewMode === 'whatif' && graphData ? (
          <div className="panel panel--main panel--full">
            <WhatIfSimulator
              graphData={graphData}
              rawPolicies={rawPolicies}
              policySummaries={policySummaries}
              onPolicySelect={setDetailsPolicyId}
            />
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

      {/* Member Modal for graph node clicks */}
      {selectedMemberEntity && (
        <MemberModal
          isOpen={memberModalOpen}
          onClose={() => setMemberModalOpen(false)}
          entityId={selectedMemberEntity.id}
          entityType={selectedMemberEntity.type}
          entityName={selectedMemberEntity.name}
          members={selectedMemberEntity.members}
          nestedMembers={selectedMemberEntity.nestedMembers}
          nestedGroups={selectedMemberEntity.nestedGroups}
          totalMemberCount={selectedMemberEntity.totalMemberCount}
        />
      )}
    </main>
  )
}

export default App
