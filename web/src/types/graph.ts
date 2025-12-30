export type NodeType =
  | 'policy'
  | 'user'
  | 'group'
  | 'role'
  | 'servicePrincipal'
  | 'namedLocation'
  | 'device'
  | 'keyword'
  | 'organization'
  | 'authenticationContext'
  | 'condition'

export interface GraphNode {
  id: string
  label: string
  type: NodeType
  properties?: Record<string, unknown>
}

export interface GraphEdge {
  from: string
  to: string
  relationship: string
  properties?: {
    policyName?: string
    targetDisplayName?: string
    via?: string[]
    description?: string
    [key: string]: unknown
  }
}

export interface GraphMetadata {
  account?: string
  tenantId?: string
  scopes?: string[]
  profile?: string
  policyCount?: number
}

export interface GraphData {
  generatedAt: string
  metadata: GraphMetadata
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface PolicySummaryItem {
  id: string
  label: string
  stateKey: string
  stateLabel: string
}

export interface GapHighlightItem {
  policyId: string
  category: 'coverage' | 'exclusion' | 'risk'
  headline: string
  description: string
}

// Objects index for Objects tab and coverage builder
export type ObjectType = 'user' | 'group' | 'role' | 'servicePrincipal' | 'namedLocation' | 'organization'

export interface ObjectRef {
  id: string
  label: string
  type: ObjectType
  props?: Record<string, unknown>
}

export interface ObjectsIndex {
  users: Map<string, ObjectRef>
  groups: Map<string, ObjectRef>
  roles: Map<string, ObjectRef>
  servicePrincipals: Map<string, ObjectRef>
  namedLocations: Map<string, ObjectRef>
  organizations: Map<string, ObjectRef>
  totals: Record<ObjectType, number>
}
