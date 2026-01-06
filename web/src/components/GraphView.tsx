import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dagre from 'dagre'
import type { GraphData, GraphEdge, GraphNode } from '../types/graph'
import './GraphView.css'

type Dimensions = {
  width: number
  height: number
}

type PositionedNode = GraphNode & {
  x: number
  y: number
}

type PositionedEdge = GraphEdge & {
  points: { x: number; y: number }[]
}

interface GraphViewProps {
  graph: GraphData
  selectedPolicyIds: Set<string>
  expandMembership?: boolean
  onNodeClick?: (nodeId: string, nodeType: string, nodeLabel: string) => void
}

const NODE_WIDTH = 180
const NODE_HEIGHT = 96
const POLICY_NODE_WIDTH = 300
const POLICY_NODE_HEIGHT = 112
const NODE_PADDING = 45
const EDGE_CURVE = 12

const typeColors: Record<string, string> = {
  policy: '#4f8cff',
  user: '#61c6ff',
  group: '#ffc480',
  role: '#d486ff',
  servicePrincipal: '#7ef0c2',
  namedLocation: '#ff8888',
  device: '#9ba7ff',
  keyword: '#ffffff',
  organization: '#f0bf5a'
}

const typeIcons: Record<string, string> = {
  policy: '🛡️',
  user: '👤',
  group: '👥',
  role: '🎛️',
  servicePrincipal: '🔑',
  namedLocation: '📍',
  device: '💻',
  keyword: '🔎',
  organization: '🏢'
}

function nodeDims(type: string) {
  if (type === 'policy') return { width: POLICY_NODE_WIDTH, height: POLICY_NODE_HEIGHT }
  return { width: NODE_WIDTH, height: NODE_HEIGHT }
}

function layoutGraph(graph: GraphData, selectedPolicyIds: Set<string>) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: NODE_PADDING, ranksep: NODE_PADDING })
  g.setDefaultEdgeLabel(() => ({}))

  graph.nodes.forEach((node) => {
    const { width, height } = nodeDims(node.type)

    const weight = node.type === 'policy' && selectedPolicyIds.has(node.id) ? 2 : 1

    g.setNode(node.id, {
      width,
      height,
      rank: node.type === 'policy' ? 0 : undefined,
      weight
    })
  })

  graph.edges.forEach((edge) => {
    g.setEdge(edge.from, edge.to)
  })

  dagre.layout(g)

  const positionedNodes: PositionedNode[] = graph.nodes.map((node) => {
    const positioned = g.node(node.id)
    if (!positioned) {
      console.error('[layoutGraph] No position for node:', node.id, node.label)
    }
    return {
      ...node,
      x: positioned?.x ?? 0,
      y: positioned?.y ?? 0
    }
  })
  
  console.log('[layoutGraph] Positioned', positionedNodes.length, 'nodes, first node:', positionedNodes[0]?.id, 'at', positionedNodes[0]?.x, positionedNodes[0]?.y)

  const positionedEdges: PositionedEdge[] = graph.edges.map((edge) => {
    const layoutEdge = g.edge(edge.from, edge.to)
    const points = layoutEdge?.points ?? []

    const curvedPoints = points.length >= 2 ? points : []

    if (curvedPoints.length === 2) {
      const [start, end] = curvedPoints
      const midX = (start.x + end.x) / 2
      const midY = (start.y + end.y) / 2
      const control = { x: midX, y: midY - EDGE_CURVE }
      return {
        ...edge,
        points: [start, control, end]
      }
    }

    return {
      ...edge,
      points: curvedPoints
    }
  })

  const graphDimensions: Dimensions = {
    width: g.graph().width ?? 800,
    height: g.graph().height ?? 600
  }

  return { nodes: positionedNodes, edges: positionedEdges, dimensions: graphDimensions }
}

function buildPath(points: { x: number; y: number }[]) {
  if (points.length < 2) return ''
  const [p0] = points
  const pLast = points[points.length - 1]
  // Robust visible path: use quadratic curve when we have a mid-point, else straight line
  if (points.length >= 3) {
    const pm = points[1]
    return `M ${p0.x},${p0.y} Q ${pm.x},${pm.y} ${pLast.x},${pLast.y}`
  }
  return `M ${p0.x},${p0.y} L ${pLast.x},${pLast.y}`
}

export function GraphView({ graph, selectedPolicyIds, expandMembership = false, onNodeClick }: GraphViewProps) {
  // Normalize legacy keyword edges/nodes to domain-specific ones at render time
  const normalizedGraph: GraphData = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>()
    for (const n of graph.nodes) nodeMap.set(n.id, n)

    function resolveKeyword(scope: 'include' | 'exclude', policyNode?: GraphNode) {
      const full = policyNode?.properties as any
      if (!full) return { type: undefined as string | undefined, label: undefined as string | undefined }
      const assignments = full.assignments || {}
      const scoped = assignments?.[scope] || {}
      const hasKw = (arr: unknown) => Array.isArray(arr) && arr.some((x) => String(x).toLowerCase().startsWith('all') || String(x).toLowerCase() === 'allusers' || String(x).toLowerCase().includes('trusted'))

      // Users
      if (hasKw(scoped?.users?.keywords)) return { type: 'user', label: 'All Users' }
      // Applications
      if (hasKw(scoped?.servicePrincipals?.keywords) || hasKw(full?.targetResources?.applications?.[scope]?.keywords)) {
        return { type: 'servicePrincipal', label: 'All Applications' }
      }
      // Locations
      const locKw = scoped?.locations?.keywords || full?.conditions?.locations?.[scope]?.keywords
      if (Array.isArray(locKw) && locKw.some((k: string) => /alltrusted/i.test(String(k)))) {
        return { type: 'namedLocation', label: 'All Trusted Locations' }
      }
      if (hasKw(locKw)) return { type: 'namedLocation', label: 'All Locations' }
      return { type: undefined, label: undefined }
    }

    const outNodes: GraphNode[] = []
    const outEdges: GraphEdge[] = []

    for (const n of graph.nodes) outNodes.push({ ...n })

    for (const e of graph.edges) {
      const [scope, relType] = e.relationship.split(':') as ['include' | 'exclude', string]
      if (relType === 'keyword') {
        const policyNode = nodeMap.get(e.from)
        const resolved = resolveKeyword(scope, policyNode)
        if (resolved.type) {
          // Re-type the target node if it is a keyword node
          const target = nodeMap.get(e.to)
          if (target && target.type === 'keyword') {
            const idx = outNodes.findIndex((n) => n.id === target.id)
            if (idx >= 0) {
              outNodes[idx] = { ...outNodes[idx], type: resolved.type as any, label: resolved.label ?? outNodes[idx].label }
            }
          }
          outEdges.push({ ...e, relationship: `${scope}:${resolved.type}` })
          continue
        }
      }
      outEdges.push(e)
    }

    // Synthesize Guest/External Users and External Organizations from policy conditions
    for (const n of outNodes.filter((x) => x.type === 'policy')) {
      const policyId = n.id
      const full: any = n.properties || {}
      const users = full?.conditions?.users
      if (!users) continue
      const scopes: Array<{ scope: 'include' | 'exclude'; obj: any }> = [
        { scope: 'include', obj: users.includeGuestsOrExternalUsers },
        { scope: 'exclude', obj: users.excludeGuestsOrExternalUsers }
      ]
      for (const { scope, obj } of scopes) {
        if (!obj) continue
        const typesStr = obj.guestOrExternalUserTypes as string | undefined
        const types = typeof typesStr === 'string' ? typesStr.split(',').map((s) => s.trim()).filter(Boolean) : []
        if (types.length > 0) {
          const guestId = `guest:${policyId}:${scope}`
          if (!nodeMap.has(guestId)) {
            const guestNode: GraphNode = { id: guestId, type: 'user', label: `Guest / External Users (${types.length} types)`, properties: { userTypes: types } }
            outNodes.push(guestNode)
            nodeMap.set(guestId, guestNode)
          }
          outEdges.push({ from: policyId, to: guestId, relationship: `${scope}:user`, properties: { description: 'Guest / External user types' } })
}

        const ext = obj.externalTenants
        const members = ext?.members
        if (Array.isArray(members) && members.length > 0) {
          for (const m of members) {
            const orgId = String(m.id || m.tenantId || '')
            if (!orgId) continue
            const label = String(m.displayName || m.name || orgId)
            if (!nodeMap.has(orgId)) {
              const orgNode: GraphNode = { id: orgId, type: 'organization' as any, label, properties: m }
              outNodes.push(orgNode)
              nodeMap.set(orgId, orgNode)
            }
            outEdges.push({ from: policyId, to: orgId, relationship: `${scope}:organization`, properties: { description: 'External tenant' } })
          }
        } else if (String(ext?.membershipKind || '') === 'enumerated') {
          const enumId = `org:enumerated:${policyId}:${scope}`
          if (!nodeMap.has(enumId)) {
            const orgEnum: GraphNode = { id: enumId, type: 'organization' as any, label: 'External Organization (enumerated)', properties: { membershipKind: 'enumerated' } }
            outNodes.push(orgEnum)
            nodeMap.set(enumId, orgEnum)
          }
          outEdges.push({ from: policyId, to: enumId, relationship: `${scope}:organization`, properties: { description: 'External tenant (enumerated)' } })
        }
      }
    }

    if (expandMembership) {
      // Reroute group/role-expanded users to be children of the group/role
      const rerouted: GraphEdge[] = []
      for (const e of outEdges) {
        const [scope, relType] = e.relationship.split(':') as ['include' | 'exclude', string]
        const rawVia = e.properties?.via as unknown
        const via = Array.isArray(rawVia) ? rawVia : rawVia ? [rawVia] : []
        const expandedThroughGroup = relType === 'user' && via.length > 0
        if (!expandedThroughGroup) {
          rerouted.push(e)
          continue
        }
        const viaLabel = String(via[via.length - 1])
        let parent = outNodes.find((n) => (n.type === 'group' || n.type === 'role') && n.label === viaLabel)
        if (!parent) {
          parent = outNodes.find((n) => (n.type === 'group' || n.type === 'role') && via.includes(n.label))
        }
        if (!parent) {
          const placeholderId = `via:${e.from}:${viaLabel}`
          if (!nodeMap.has(placeholderId)) {
            const placeholder: GraphNode = { id: placeholderId, type: 'group', label: viaLabel }
            outNodes.push(placeholder)
            nodeMap.set(placeholderId, placeholder)
            parent = placeholder
          } else {
            parent = nodeMap.get(placeholderId)!
          }
        }
        rerouted.push({ from: parent.id, to: e.to, relationship: `${scope}:user`, properties: { ...e.properties } })
      }
      // Keep only user nodes that remain referenced by edges
      const referenced = new Set<string>()
      for (const e of rerouted) { referenced.add(e.from); referenced.add(e.to) }
      const prunedNodes = outNodes.filter((n) => n.type !== 'user' || referenced.has(n.id))
      return { ...graph, nodes: prunedNodes, edges: rerouted }
    }

    // Without membership expansion: drop expanded Policy→User edges
    const filtered: GraphEdge[] = outEdges.filter((e) => {
      const [_, relType] = e.relationship.split(':')
      const rawVia = e.properties?.via as unknown
      const via = Array.isArray(rawVia) ? rawVia : rawVia ? [rawVia] : []
      return !(relType === 'user' && via.length > 0)
    })
    // Hide user nodes that are no longer referenced to drastically reduce graph size
    const referenced = new Set<string>()
    for (const e of filtered) { referenced.add(e.from); referenced.add(e.to) }
    const prunedNodes = outNodes.filter((n) => n.type !== 'user' || referenced.has(n.id))
    return { ...graph, nodes: prunedNodes, edges: filtered }
  }, [graph, expandMembership])
  const [dimensions, setDimensions] = useState<Dimensions>({ width: 960, height: 720 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [dragging, setDragging] = useState<{ id: string | null; dx: number; dy: number } | null>(null)
  const [viewTransform, setViewTransform] = useState<{ scale: number; x: number; y: number }>({ scale: 1, x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef<{ x: number; y: number; transformX: number; transformY: number } | null>(null)
  const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null)

  const layout = useMemo(() => layoutGraph(normalizedGraph, selectedPolicyIds), [normalizedGraph, selectedPolicyIds])

  const updateDimensions = useCallback(() => {
    if (!containerRef.current) return
    const { clientWidth, clientHeight } = containerRef.current
    setDimensions({ width: clientWidth, height: clientHeight })
  }, [])

  useEffect(() => {
    if (!measureCtxRef.current) {
      const canvas = document.createElement('canvas')
      measureCtxRef.current = canvas.getContext('2d')
    }
    const observer = new ResizeObserver(() => updateDimensions())
    if (containerRef.current) {
      updateDimensions()
      observer.observe(containerRef.current)
    }
    return () => observer.disconnect()
  }, [updateDimensions])

  // Auto-fit the graph on initial load or layout change
  useEffect(() => {
    const padding = 80
    const scaleX = (dimensions.width - padding) / layout.dimensions.width
    const scaleY = (dimensions.height - padding) / layout.dimensions.height
    const autoScale = Math.min(scaleX, scaleY, 1)
    const centerX = (dimensions.width - layout.dimensions.width * autoScale) / 2
    const centerY = (dimensions.height - layout.dimensions.height * autoScale) / 2
    setViewTransform({
      scale: autoScale,
      x: Math.max(centerX, 40),
      y: Math.max(centerY, 40)
    })
  }, [dimensions.width, dimensions.height, layout.dimensions.width, layout.dimensions.height])

  const scale = viewTransform.scale
  const translate = { x: viewTransform.x, y: viewTransform.y }

  const displayedNodes = useMemo(() => {
    const raw = layout.nodes.map((n) => {
      const override = positions[n.id]
      return override ? { ...n, x: override.x, y: override.y } : n
    })
    // Simple collision avoidance: nudge nodes that share the exact position
    const posCount = new Map<string, number>()
    return raw.map((n) => {
      const key = `${Math.round(n.x)}:${Math.round(n.y)}`
      const cnt = (posCount.get(key) ?? 0) + 1
      posCount.set(key, cnt)
      if (cnt === 1) return n
      const offset = (cnt - 1) * 14
      return { ...n, y: n.y + offset }
    })
  }, [layout.nodes, positions])

  const displayedNodeMap = useMemo(() => {
    const map = new Map<string, PositionedNode>()
    for (const n of displayedNodes) map.set(n.id, n)
    return map
  }, [displayedNodes])

  const displayedEdges: PositionedEdge[] = useMemo(() => {
    const edges: PositionedEdge[] = []
    console.log('[displayedEdges] Processing', normalizedGraph.edges.length, 'edges')
    console.log('[displayedEdges] displayedNodeMap has', displayedNodeMap.size, 'nodes')
    
    // Sample a few nodes from the map
    const sampleNodeIds = Array.from(displayedNodeMap.keys()).slice(0, 3)
    for (const id of sampleNodeIds) {
      const n = displayedNodeMap.get(id)
      console.log('[displayedEdges] Sample node', id.substring(0, 8), 'x:', n?.x, 'y:', n?.y)
    }
    
    function getBorderPoint(fromNode: PositionedNode, toNode: PositionedNode) {
      const dx = toNode.x - fromNode.x
      const dy = toNode.y - fromNode.y
      const dims = nodeDims(fromNode.type)
      const halfW = dims.width / 2
      const halfH = dims.height / 2
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      const scale = Math.max(absDx / halfW, absDy / halfH) || 1
      return { x: fromNode.x + dx / scale, y: fromNode.y + dy / scale }
    }

    for (const e of normalizedGraph.edges) {
      const from = displayedNodeMap.get(e.from)
      const to = displayedNodeMap.get(e.to)
      
      // Debug the first edge
      if (edges.length === 0) {
        console.log('[displayedEdges] First edge from:', e.from.substring(0, 8), 'to:', e.to.substring(0, 8))
        console.log('[displayedEdges] from node:', from ? `x=${from.x}, y=${from.y}` : 'NOT FOUND')
        console.log('[displayedEdges] to node:', to ? `x=${to.x}, y=${to.y}` : 'NOT FOUND')
      }
      
      // Skip if nodes don't exist or don't have valid positions
      if (!from || !to || from.x === undefined || from.y === undefined || to.x === undefined || to.y === undefined) {
        if (edges.length === 0) {
          console.warn('[displayedEdges] Skipping first edge due to invalid positions')
        }
        continue
      }
      const start = getBorderPoint(from, to)
      const end = getBorderPoint(to, from)
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - EDGE_CURVE }
      edges.push({ ...e, points: [start, mid, end] })
    }
    console.log('[displayedEdges] Final edge count:', edges.length)
    return edges
  }, [normalizedGraph.edges, displayedNodeMap])

  function clientToGraphCoords(clientX: number, clientY: number) {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const x = (clientX - rect.left - translate.x) / scale
    const y = (clientY - rect.top - translate.y) / scale
    return { x, y }
  }

  function onNodePointerDown(e: React.PointerEvent<SVGGElement>, nodeId: string) {
    const node = displayedNodeMap.get(nodeId)
    if (!node) return
    const { x: lx, y: ly } = clientToGraphCoords(e.clientX, e.clientY)
    setDragging({ id: nodeId, dx: node.x - lx, dy: node.y - ly })
    ;(e.currentTarget as SVGGElement).setPointerCapture(e.pointerId)
  }

  function onNodePointerMove(e: React.PointerEvent<SVGGElement>, nodeId: string) {
    if (!dragging || dragging.id !== nodeId) return
    const { x: lx, y: ly } = clientToGraphCoords(e.clientX, e.clientY)
    const nx = lx + dragging.dx
    const ny = ly + dragging.dy
    setPositions((prev) => ({ ...prev, [nodeId]: { x: nx, y: ny } }))
  }

  function onNodePointerUp(e: React.PointerEvent<SVGGElement>) {
    if (dragging) {
      try {
        ;(e.currentTarget as SVGGElement).releasePointerCapture(e.pointerId)
      } catch {}
    }
    setDragging(null)
  }

  // Zoom with mouse wheel
  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault()
    const delta = -e.deltaY
    const scaleChange = delta > 0 ? 1.1 : 0.9
    const newScale = Math.max(0.1, Math.min(5, viewTransform.scale * scaleChange))
    
    // Zoom towards mouse position
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    // Calculate new translation to keep zoom centered on mouse
    const newX = mouseX - (mouseX - viewTransform.x) * (newScale / viewTransform.scale)
    const newY = mouseY - (mouseY - viewTransform.y) * (newScale / viewTransform.scale)
    
    setViewTransform({ scale: newScale, x: newX, y: newY })
  }

  // Pan with right-click drag or middle-click drag
  function onSvgPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    // Only pan on right-click (button 2) or middle-click (button 1) or ctrl+left-click
    if (e.button === 2 || e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      e.preventDefault()
      setIsPanning(true)
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        transformX: viewTransform.x,
        transformY: viewTransform.y
      }
    }
  }

  function onSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (isPanning && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      setViewTransform({
        scale: viewTransform.scale,
        x: panStartRef.current.transformX + dx,
        y: panStartRef.current.transformY + dy
      })
    }
  }

  function onSvgPointerUp() {
    setIsPanning(false)
    panStartRef.current = null
  }

  // Prevent context menu on right-click
  function onContextMenu(e: React.MouseEvent<SVGSVGElement>) {
    e.preventDefault()
  }

  return (
    <div className="graph">
      <div className="graph__legend-bar">
        <div className="graph__legend-section">
          <span className="graph__legend-title">Relationships</span>
          <div className="graph__legend-item">
            <div className="graph__legend-icon" style={{ borderColor: '#61c6ff', background: '#61c6ff' }} />
            <span>Include</span>
          </div>
          <div className="graph__legend-item">
            <div className="graph__legend-icon" style={{ borderColor: '#ff6a61', background: '#ff6a61' }} />
            <span>Exclude</span>
          </div>
        </div>
        <div className="graph__legend-section">
          <span className="graph__legend-title">Node Types</span>
          <div className="graph__legend-item">
            <div className="graph__legend-icon" style={{ borderColor: '#4f8cff', background: 'rgba(79,140,255,0.15)' }}>🛡️</div>
            <span>Policy</span>
          </div>
          <div className="graph__legend-item">
            <div className="graph__legend-icon" style={{ borderColor: '#61c6ff', background: 'rgba(97,198,255,0.15)' }}>👤</div>
            <span>User</span>
          </div>
          <div className="graph__legend-item">
            <div className="graph__legend-icon" style={{ borderColor: '#ffc480', background: 'rgba(255,196,128,0.15)' }}>👥</div>
            <span>Group</span>
          </div>
          <div className="graph__legend-item">
            <div className="graph__legend-icon" style={{ borderColor: '#d486ff', background: 'rgba(212,134,255,0.15)' }}>🎛️</div>
            <span>Role</span>
          </div>
          <div className="graph__legend-item">
            <div className="graph__legend-icon" style={{ borderColor: '#7ef0c2', background: 'rgba(126,240,194,0.15)' }}>🔑</div>
            <span>App</span>
          </div>
          <div className="graph__legend-item">
            <div className="graph__legend-icon" style={{ borderColor: '#ff8888', background: 'rgba(255,136,136,0.15)' }}>📍</div>
            <span>Location</span>
          </div>
          <div className="graph__legend-item">
            <div className="graph__legend-icon" style={{ borderColor: '#f0bf5a', background: 'rgba(240,191,90,0.15)' }}>🏢</div>
            <span>Organization</span>
          </div>
        </div>
        <div className="graph__legend-section">
          <span className="graph__legend-title">Controls</span>
          <div className="graph__legend-item">🖱️ Scroll to zoom</div>
          <div className="graph__legend-item">🖱️ Right-click + drag to pan</div>
          <div className="graph__legend-item">✋ Drag nodes</div>
        </div>
      </div>
      <div className="graph__svg-container" ref={containerRef}>
        <svg 
          width={dimensions.width} 
          height={dimensions.height} 
          ref={svgRef}
          onWheel={onWheel}
          onPointerDown={onSvgPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onContextMenu={onContextMenu}
          style={{ cursor: isPanning ? 'grabbing' : 'default' }}
        >
        <g transform={`translate(${translate.x}, ${translate.y}) scale(${scale})`}>
          {displayedEdges.map((edge) => {
            const path = buildPath(edge.points)
            const color = edge.relationship.startsWith('exclude') ? '#ff6a61' : '#61c6ff'
            const mid = edge.points[Math.floor(edge.points.length / 2)] ?? { x: 0, y: 0 }

            // Humanize relationship text for labels
            const relText = (() => {
              return edge.relationship
                .replace('include:', 'Include ')
                .replace('exclude:', 'Exclude ')
                .replace('servicePrincipal', 'Application')
                .replace('namedLocation', 'Location')
                .replace('keyword', 'Keyword')
            })()

            return (
              <g key={`${edge.from}-${edge.to}-${edge.relationship}`} className="graph__edge">
                {/* High-contrast dual stroke: background glow + foreground colored line */}
                <path d={path ?? ''} className="graph__edge-bg" />
                <path d={path ?? ''} stroke={color} className="graph__edge-fg" />
                {edge.points.length > 1 && (
                  <polygon
                    className="graph__edge-arrow"
                    points="0,-6 12,0 0,6"
                    fill={color}
                    transform={`translate(${edge.points.at(-1)?.x ?? 0}, ${edge.points.at(-1)?.y ?? 0}) rotate(0)`}
                  />
                )}
                <text x={mid.x + 6} y={mid.y - 8} className="graph__edge-label">{relText}</text>
              </g>
            )
          })}

          {displayedNodes.map((node) => {
            const isSelected = node.type === 'policy' && selectedPolicyIds.has(node.id)
            const baseColor = typeColors[node.type] ?? '#61c6ff'
            const dims = nodeDims(node.type)
            const label = node.label ?? ''
            const availableWidth = dims.width - 36 // left/right padding ~18px each
            const maxLines = 3
            const basePx = 16
            let fontPx = basePx
            let lines: string[] = [label]
            const ctx = measureCtxRef.current
            function measure(text: string, px: number) {
              if (!ctx) return text.length * px * 0.6
              ctx.font = `600 ${px}px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`
              return ctx.measureText(text).width
            }
            if (ctx && label) {
              // Try to wrap into at most maxLines at decreasing sizes
              for (const size of [16, 15, 14, 13, 12, 11, 10]) {
                const words = label.split(/\s+/)
                const wrapped: string[] = []
                let current = ''
                for (const w of words) {
                  const cand = current ? current + ' ' + w : w
                  if (measure(cand, size) <= availableWidth) {
                    current = cand
                  } else {
                    if (current) wrapped.push(current)
                    current = w
                  }
                }
                if (current) wrapped.push(current)
                if (wrapped.length <= maxLines) {
                  fontPx = size
                  lines = wrapped
                  break
                }
              }
              if (lines.length > maxLines) {
                // Ellipsize last line
                const lastIdx = maxLines - 1
                let last = lines.slice(0, lastIdx)
                let end = lines[lastIdx]
                while (measure(end + '…', fontPx) > availableWidth && end.length > 1) {
                  end = end.slice(0, -1)
                }
                lines = [...last, end + '…']
              }

              // Ensure every line fits width by hard trimming with ellipsis if needed
              lines = lines.map((ln) => {
                let s = ln
                while (measure(s, fontPx) > availableWidth && s.length > 1) {
                  s = s.slice(0, -1)
                }
                if (s !== ln) {
                  while (measure(s + '…', fontPx) > availableWidth && s.length > 1) {
                    s = s.slice(0, -1)
                  }
                  return s + '…'
                }
                return s
              })
            }

            // Check if this node type should trigger the member modal
            const isClickableForMembers = node.type === 'group' || node.type === 'role'

            return (
              <g
                key={node.id}
                className={`graph__node graph__node--${node.type} ${isSelected ? 'graph__node--selected' : ''} ${isClickableForMembers ? 'graph__node--clickable' : ''}`}
                transform={`translate(${node.x - dims.width / 2}, ${node.y - dims.height / 2})`}
                style={{ cursor: isClickableForMembers ? 'pointer' : 'grab' }}
                onPointerDown={(e) => onNodePointerDown(e, node.id)}
                onPointerMove={(e) => onNodePointerMove(e, node.id)}
                onPointerUp={onNodePointerUp}
                onClick={(e) => {
                  // Only trigger click if we haven't been dragging
                  if (!dragging?.id && isClickableForMembers && onNodeClick) {
                    e.stopPropagation()
                    onNodeClick(node.id, node.type, node.label)
                  }
                }}
              >
                <rect width={dims.width} height={dims.height} rx={16} ry={16} stroke={baseColor} />
                <text x={18} y={28} className="graph__node-type">
                  {typeIcons[node.type] ?? '•'} {node.type}
                </text>
                <text x={18} y={52} className="graph__node-label" style={{ fontSize: `${fontPx}px` }}>
                  <title>{label}</title>
                  {lines.map((ln, i) => (
                    <tspan key={i} x={18} dy={i === 0 ? 0 : fontPx + 2}>
                      {ln}
                    </tspan>
                  ))}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      </div>
    </div>
  )
}
