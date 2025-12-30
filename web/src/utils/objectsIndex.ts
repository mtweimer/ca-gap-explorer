import type { GraphData, GraphNode, ObjectRef, ObjectsIndex, ObjectType } from '../types/graph'

function isEntityType(t: string): t is ObjectType {
  return (
    t === 'user' ||
    t === 'group' ||
    t === 'role' ||
    t === 'servicePrincipal' ||
    t === 'namedLocation' ||
    t === 'organization'
  )
}

function toRef(node: GraphNode): ObjectRef {
  return { id: node.id, label: node.label, type: node.type as ObjectType, props: node.properties as Record<string, unknown> }
}

export function buildObjectsIndex(graph: GraphData): ObjectsIndex {
  const users = new Map<string, ObjectRef>()
  const groups = new Map<string, ObjectRef>()
  const roles = new Map<string, ObjectRef>()
  const servicePrincipals = new Map<string, ObjectRef>()
  const namedLocations = new Map<string, ObjectRef>()
  const organizations = new Map<string, ObjectRef>()

  for (const n of graph.nodes) {
    if (!isEntityType(n.type)) continue
    const ref = toRef(n)
    switch (n.type) {
      case 'user':
        users.set(n.id, ref)
        break
      case 'group':
        groups.set(n.id, ref)
        break
      case 'role':
        roles.set(n.id, ref)
        break
      case 'servicePrincipal':
        servicePrincipals.set(n.id, ref)
        break
      case 'namedLocation':
        namedLocations.set(n.id, ref)
        break
      case 'organization':
        organizations.set(n.id, ref)
        break
    }
  }

  const totals: ObjectsIndex['totals'] = {
    user: users.size,
    group: groups.size,
    role: roles.size,
    servicePrincipal: servicePrincipals.size,
    namedLocation: namedLocations.size,
    organization: organizations.size
  }

  return { users, groups, roles, servicePrincipals, namedLocations, organizations, totals }
}

// Helper for keyword expansion in coverage utils (placeholder here for re-use)
export function expandAllByType(index: ObjectsIndex, type: ObjectType): string[] {
  switch (type) {
    case 'user':
      return Array.from(index.users.keys())
    case 'group':
      return Array.from(index.groups.keys())
    case 'role':
      return Array.from(index.roles.keys())
    case 'servicePrincipal':
      return Array.from(index.servicePrincipals.keys())
    case 'namedLocation':
      return Array.from(index.namedLocations.keys())
    case 'organization':
      return Array.from(index.organizations.keys())
  }
}

// Optional: merge in entities from raw conditional_access_policies.json when available
export function buildObjectsIndexMerged(graph: GraphData, rawPolicies: any | null | undefined): ObjectsIndex {
  const base = buildObjectsIndex(graph)
  if (!rawPolicies) return base

  const addEntityMap = (mapLike: any, type: ObjectType) => {
    if (!mapLike || typeof mapLike !== 'object') return
    const values: any[] = Array.isArray(mapLike) ? mapLike : Object.values(mapLike)
    for (const ent of values) {
      if (!ent) continue
      const id = String(ent.id ?? '')
      if (!id) continue
      const label = String(ent.displayName ?? ent.userPrincipalName ?? ent.appDisplayName ?? id)
      const ref: ObjectRef = { id, label, type, props: ent }
      switch (type) {
        case 'user':
          if (!base.users.has(id)) base.users.set(id, ref)
          break
        case 'group':
          if (!base.groups.has(id)) base.groups.set(id, ref)
          break
        case 'role':
          if (!base.roles.has(id)) base.roles.set(id, ref)
          break
        case 'servicePrincipal':
          if (!base.servicePrincipals.has(id)) base.servicePrincipals.set(id, ref)
          break
        case 'namedLocation':
          if (!base.namedLocations.has(id)) base.namedLocations.set(id, ref)
          break
        case 'organization':
          if (!base.organizations.has(id)) base.organizations.set(id, ref)
          break
      }
    }
  }

  // entities: users, groups, roles, servicePrincipals, namedLocations
  const entities = rawPolicies?.entities
  if (entities) {
    addEntityMap(entities.users, 'user')
    addEntityMap(entities.groups, 'group')
    addEntityMap(entities.roles, 'role')
    addEntityMap(entities.servicePrincipals, 'servicePrincipal')
    addEntityMap(entities.namedLocations, 'namedLocation')
  }

  // organizations from conditions.users.include/exclude externalTenants.members across policies
  const policies = rawPolicies?.policies
  if (Array.isArray(policies)) {
    for (const p of policies) {
      const usersCond = p?.conditions?.users
      const scans = [usersCond?.includeGuestsOrExternalUsers, usersCond?.excludeGuestsOrExternalUsers]
      for (const s of scans) {
        const members = s?.externalTenants?.members
        if (Array.isArray(members)) {
          for (const m of members) {
            const id = String(m?.id ?? m?.tenantId ?? '')
            if (!id) continue
            const label = String(m?.displayName ?? m?.name ?? id)
            if (!base.organizations.has(id)) base.organizations.set(id, { id, label, type: 'organization', props: m })
          }
        }
      }
    }
  }

  base.totals = {
    user: base.users.size,
    group: base.groups.size,
    role: base.roles.size,
    servicePrincipal: base.servicePrincipals.size,
    namedLocation: base.namedLocations.size,
    organization: base.organizations.size
  }
  return base
}


