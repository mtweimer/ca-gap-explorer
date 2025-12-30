import './FilterBar.css'

interface FilterBarProps {
  states: string[]
  selectedStates: Set<string>
  onToggleState: (state: string) => void

  grantControls: string[]
  selectedGrants: Set<string>
  onToggleGrant: (grant: string) => void

  search: string
  onSearchChange: (value: string) => void

  expandMembership?: boolean
  onToggleExpand?: (next: boolean) => void
}

export function FilterBar({
  states,
  selectedStates,
  onToggleState,
  grantControls,
  selectedGrants,
  onToggleGrant,
  search,
  onSearchChange,
  expandMembership,
  onToggleExpand
}: FilterBarProps) {
  return (
    <div className="filterbar">
      <div className="filterbar__section">
        <span className="filterbar__label">State</span>
        <div className="filterbar__chips">
          {states.map((s) => {
            const active = selectedStates.has(s)
            return (
              <button
                key={s}
                type="button"
                className={`chip ${active ? 'chip--active' : ''}`}
                onClick={() => onToggleState(s)}
                title={s}
              >
                {s}
              </button>
            )
          })}
        </div>
      </div>

      <div className="filterbar__section">
        <span className="filterbar__label">Grant controls</span>
        <div className="filterbar__chips">
          {grantControls.map((g) => {
            const active = selectedGrants.has(g)
            return (
              <button
                key={g}
                type="button"
                className={`chip chip--ghost ${active ? 'chip--active' : ''}`}
                onClick={() => onToggleGrant(g)}
                title={g}
              >
                {g}
              </button>
            )
          })}
        </div>
      </div>

      <div className="filterbar__section">
        <span className="filterbar__label">Options</span>
        <div className="filterbar__chips">
          <button
            type="button"
            className={`chip chip--ghost ${expandMembership ? 'chip--active' : ''}`}
            onClick={() => onToggleExpand && onToggleExpand(!expandMembership)}
            title="Expand group/role members"
          >
            Expand members
          </button>
        </div>
      </div>

      <div className="filterbar__section filterbar__search">
        <input
          type="search"
          placeholder="Search policies..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  )
}


