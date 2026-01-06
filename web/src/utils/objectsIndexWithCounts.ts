import type { GraphData, ObjectsIndex } from '../types/graph'
import { buildObjectsIndexMerged } from './objectsIndex'

/**
 * Build objects index with actual counts from counts.json
 * This ensures we use the real totals from the tenant, not just what's in the graph
 */
export async function buildObjectsIndexWithCounts(
  graphData: GraphData,
  rawPolicies: any | null
): Promise<ObjectsIndex> {
  // Start with the base index from graph data
  const index = buildObjectsIndexMerged(graphData, rawPolicies)

  try {
    // Try to load counts from the entity dump
    const countsResponse = await fetch('/entities/counts.json', { cache: 'no-store' })
    if (countsResponse.ok) {
      const counts = await countsResponse.json()
      
      // Override totals with actual counts from the tenant
      if (counts.users) index.totals.user = counts.users
      if (counts.groups) index.totals.group = counts.groups
      if (counts.roles) index.totals.role = counts.roles
      if (counts.servicePrincipals) index.totals.servicePrincipal = counts.servicePrincipals
      if (counts.namedLocations) index.totals.namedLocation = counts.namedLocations
      if (counts.organizations) index.totals.organization = counts.organizations

      console.log('Loaded actual totals from counts.json:', index.totals)
    }
  } catch (err) {
    console.warn('Could not load counts.json, using graph data totals:', err)
  }

  return index
}

/**
 * Synchronous version that uses pre-loaded counts
 */
export function buildObjectsIndexWithCountsSync(
  graphData: GraphData,
  rawPolicies: any | null,
  counts: any | null
): ObjectsIndex {
  const index = buildObjectsIndexMerged(graphData, rawPolicies)

  if (counts) {
    // Handle both camelCase and lowercase keys from counts.json
    index.totals.user = counts.user ?? counts.users ?? index.totals.user
    index.totals.group = counts.group ?? counts.groups ?? index.totals.group
    index.totals.role = counts.role ?? counts.roles ?? index.totals.role
    index.totals.servicePrincipal = counts.serviceprincipal ?? counts.servicePrincipal ?? counts.servicePrincipals ?? index.totals.servicePrincipal
    index.totals.namedLocation = counts.namedlocation ?? counts.namedLocation ?? counts.namedLocations ?? index.totals.namedLocation
    index.totals.organization = counts.organization ?? counts.organizations ?? index.totals.organization
    // Also handle application count for resource coverage
    if (counts.application !== undefined) {
      (index.totals as Record<string, number>).application = counts.application
    }
  }

  return index
}

