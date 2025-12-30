import type { PolicySummaryItem } from '../types/graph'
import './PolicySummary.css'

interface PolicySummaryProps {
  policies: PolicySummaryItem[]
  selectedPolicyIds: Set<string>
  onTogglePolicy: (policyId: string) => void
  onShowDetails?: (policyId: string) => void
  onSelectAll?: () => void
  onSelectNone?: () => void
}

export function PolicySummary({ policies, selectedPolicyIds, onTogglePolicy, onShowDetails, onSelectAll, onSelectNone }: PolicySummaryProps) {
  if (policies.length === 0) {
    return (
      <div className="policy-summary policy-summary--empty">
        <p>No policies found in the export.</p>
      </div>
    )
  }

  return (
    <div className="policy-summary">
      <div className="policy-summary__header">
        <h2>Policies</h2>
        <div className="policy-summary__actions">
          {onSelectAll && (
            <button type="button" className="policy-summary__action-btn" onClick={onSelectAll} title="Select all filtered">
              Select all
            </button>
          )}
          {onSelectNone && (
            <button type="button" className="policy-summary__action-btn" onClick={onSelectNone} title="Clear selection">
              Select none
            </button>
          )}
        <span className="policy-summary__count">{policies.length}</span>
        </div>
      </div>

      <ul>
        {policies.map((policy) => {
          const isSelected = selectedPolicyIds.has(policy.id)
          const badgeClass = `policy-summary__state policy-summary__state--${policy.stateKey}`

          return (
            <li key={policy.id} className={isSelected ? 'policy-summary__item policy-summary__item--selected' : 'policy-summary__item'}>
              <button type="button" onClick={() => onTogglePolicy(policy.id)}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  readOnly
                  className="policy-summary__checkbox"
                />
                <span 
                  className="policy-summary__label"
                  onClick={(e) => {
                    if (onShowDetails) {
                      e.stopPropagation()
                      onShowDetails(policy.id)
                    }
                  }}
                  style={onShowDetails ? { cursor: 'pointer' } : undefined}
                  title={policy.label}
                >
                  {policy.label}
                </span>
                <span className={badgeClass}>{policy.stateLabel}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
