import { useMemo } from 'react'
import type { GapHighlightItem, GraphData } from '../types/graph'
import './GapHighlights.css'

interface GapHighlightsProps {
  graph: GraphData
  onSelectPolicy: (policyId: string) => void
}

function buildHighlights(graph: GraphData): GapHighlightItem[] {
  const highlights: GapHighlightItem[] = []
  
  // Helper to check if an object has any real properties (not just empty object)
  const hasRealProperties = (obj: any): boolean => {
    if (!obj || typeof obj !== 'object') return false
    const keys = Object.keys(obj)
    if (keys.length === 0) return false
    return keys.some(key => {
      const val = obj[key]
      return val !== null && val !== undefined && (typeof val !== 'object' || Object.keys(val).length > 0)
    })
  }

  const policyEdges = new Map<string, GapHighlightItem['category'][]>()
  for (const edge of graph.edges) {
    if (!policyEdges.has(edge.from)) {
      policyEdges.set(edge.from, [])
    }
    const scope = edge.relationship.split(':')[0]
    if (scope === 'include' || scope === 'exclude') {
      policyEdges.get(edge.from)!.push(scope === 'include' ? 'coverage' : 'exclusion')
    }
    if (edge.relationship.includes('risk')) {
      policyEdges.get(edge.from)!.push('risk')
    }
  }

  for (const node of graph.nodes) {
    if (node.type !== 'policy') continue

    const relationships = policyEdges.get(node.id) ?? []
    const hasInclude = relationships.includes('coverage')
    const hasExclude = relationships.includes('exclusion')
    const hasRisk = relationships.includes('risk')
    
    const props = node.properties as any || {}
    const conditions = props.conditions || {}
    const session = props.accessControls?.session || {}

    // Original coverage gaps
    if (!hasInclude) {
      highlights.push({
        policyId: node.id,
        category: 'coverage',
        headline: `${node.label} has no include assignments`,
        description: 'This policy may never trigger. Review assignments to ensure coverage.'
      })
    }

    if (hasExclude && !hasInclude) {
      highlights.push({
        policyId: node.id,
        category: 'exclusion',
        headline: `${node.label} only contains exclusions`,
        description: 'Policy excludes targets without any include path. Confirm intended behavior.'
      })
    }

    if (hasRisk) {
      highlights.push({
        policyId: node.id,
        category: 'risk',
        headline: `${node.label} references risk levels`,
        description: 'Verify user/sign-in risk policies align with conditional access baseline.'
      })
    }

    // NEW: Insider risk without strong controls (only if there are actual levels configured)
    if (conditions.insiderRiskLevels?.configured && 
        conditions.insiderRiskLevels.levels && 
        Array.isArray(conditions.insiderRiskLevels.levels) && 
        conditions.insiderRiskLevels.levels.length > 0) {
      const hasBlockOrStrongControls = 
        (props.grantControls || []).some((gc: string) => 
          gc.includes('block') || gc.includes('mfa') || gc.includes('compliant')
        )
      if (!hasBlockOrStrongControls) {
        highlights.push({
          policyId: node.id,
          category: 'risk',
          headline: `${node.label} uses Insider Risk without strong controls`,
          description: 'Insider risk detection requires block or strong authentication controls. Consider adding MFA or device compliance.'
        })
      }
    }

    // NEW: Missing session controls for sensitive scenarios
    const hasAuthContext = props.targetResources?.applications?.includeAuthenticationContextClassReferences?.length > 0
    const hasHighRisk = conditions.userRiskLevels?.includes?.('high') || conditions.signInRiskLevels?.includes?.('high')
    const hasTokenProtection = session.tokenProtection?.isEnabled === true
    const hasCAE = session.continuousAccessEvaluation && hasRealProperties(session.continuousAccessEvaluation) && session.continuousAccessEvaluation.mode
    
    if ((hasAuthContext || hasHighRisk) && !hasTokenProtection && !hasCAE) {
      highlights.push({
        policyId: node.id,
        category: 'risk',
        headline: `${node.label} lacks enhanced session controls`,
        description: 'Policies with auth contexts or high-risk conditions should enable Token Protection or CAE for stronger security.'
      })
    }

    // NEW: No network restrictions
    const hasNetworkConditions = conditions.locations?.include?.entities?.length > 0 || 
                                 conditions.locations?.include?.keywords?.length > 0 ||
                                 conditions.locations?.exclude?.entities?.length > 0 ||
                                 conditions.locations?.exclude?.keywords?.length > 0
    
    if (hasInclude && !hasNetworkConditions && !hasAuthContext) {
      highlights.push({
        policyId: node.id,
        category: 'coverage',
        headline: `${node.label} has no network restrictions`,
        description: 'Consider adding location conditions to restrict access from untrusted networks.'
      })
    }

    // NEW: Authentication flow risks (only if there are actual methods configured)
    if (conditions.authenticationFlows?.configured && 
        conditions.authenticationFlows.transferMethods && 
        Array.isArray(conditions.authenticationFlows.transferMethods) && 
        conditions.authenticationFlows.transferMethods.length > 0) {
      const methods = conditions.authenticationFlows.transferMethods
      if (methods.includes('deviceCodeFlow')) {
        highlights.push({
          policyId: node.id,
          category: 'risk',
          headline: `${node.label} restricts device code flow`,
          description: 'Device code flow restriction is active. Verify this aligns with your security requirements.'
        })
      }
    }

    // NEW: Missing CAE for admin roles
    const hasAdminRoles = (props.assignments?.include?.roles?.entities || []).some((role: any) => 
      role.displayName?.toLowerCase().includes('admin')
    )
    const hasCAEForAdmins = session.continuousAccessEvaluation && hasRealProperties(session.continuousAccessEvaluation) && session.continuousAccessEvaluation.mode
    if (hasAdminRoles && !hasCAEForAdmins) {
      highlights.push({
        policyId: node.id,
        category: 'risk',
        headline: `${node.label} targets admins without CAE`,
        description: 'Administrator policies should enable Continuous Access Evaluation for real-time policy enforcement.'
      })
    }
  }

  return highlights
}

const categoryLabels: Record<GapHighlightItem['category'], string> = {
  coverage: 'Coverage Gap',
  exclusion: 'Exclusion Review',
  risk: 'Risk Signal'
}

export function GapHighlights({ graph, onSelectPolicy }: GapHighlightsProps) {
  const highlights = useMemo(() => buildHighlights(graph), [graph])

  if (highlights.length === 0) {
    return (
      <section className="gap-highlights gap-highlights--empty">
        <p>All policies include assignments. No high-level gaps detected.</p>
      </section>
    )
  }

  return (
    <section className="gap-highlights">
      <h2>Gap Insights</h2>
      <ul>
        {highlights.map((highlight) => (
          <li key={`${highlight.policyId}-${highlight.category}`}>
            <button type="button" onClick={() => onSelectPolicy(highlight.policyId)}>
              <span className={`gap-highlights__tag gap-highlights__tag--${highlight.category}`}>
                {categoryLabels[highlight.category]}
              </span>
              <span className="gap-highlights__headline">{highlight.headline}</span>
              <span className="gap-highlights__description">{highlight.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
