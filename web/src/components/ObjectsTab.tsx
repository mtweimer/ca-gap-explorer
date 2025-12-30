import { useEffect, useMemo, useState } from 'react'
import type { GraphData, ObjectType } from '../types/graph'
import { buildObjectsIndex, buildObjectsIndexMerged } from '../utils/objectsIndex'

type ObjectsTabProps = {
  graphData: GraphData
}

const TYPE_ORDER: ObjectType[] = ['user', 'group', 'role', 'servicePrincipal', 'namedLocation', 'organization']
const LABELS: Record<ObjectType, string> = {
  user: 'Users',
  group: 'Groups',
  role: 'Roles',
  servicePrincipal: 'Applications',
  namedLocation: 'Locations',
  organization: 'Organizations'
}

export function ObjectsTab({ graphData }: ObjectsTabProps) {
  const [activeType, setActiveType] = useState<ObjectType>('user')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 100
  const [rawPolicies, setRawPolicies] = useState<any | null>(null)

  useEffect(() => {
    // Try to load the raw conditional access policies for full entity counts
    fetch('/conditional_access_policies.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setRawPolicies(j))
      .catch(() => setRawPolicies(null))
  }, [])

  // Optional: if entities dump exists, prefer that for totals and paging per type
  const [rawCounts, setRawCounts] = useState<any | null>(null)
  const [rawCache, setRawCache] = useState<Record<string, any[]>>({})
  useEffect(() => {
    fetch('/entities/counts.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setRawCounts(j))
      .catch(() => setRawCounts(null))
  }, [])

  const index = useMemo(() => buildObjectsIndexMerged(graphData, rawPolicies), [graphData, rawPolicies])
  const items = useMemo(() => {
    // If raw dump available for this type, use it to list full dataset
    const typeToFile: Record<ObjectType, string> = {
      user: 'users.json',
      group: 'groups.json',
      role: 'roles.json',
      servicePrincipal: 'service_principals.json',
      namedLocation: 'named_locations.json',
      organization: 'organizations.json'
    }

    let arr: { id: string; label: string }[] = []
    const rawArr = rawCache[typeToFile[activeType]]
    if (rawCounts && rawArr) {
      arr = rawArr.map((e: any) => {
        // Handle both PascalCase (from PowerShell Select-Object) and camelCase
        const id = String(e.id ?? e.Id ?? '')
        const label = String(
          e.displayName ?? e.DisplayName ??
          e.userPrincipalName ?? e.UserPrincipalName ??
          e.appDisplayName ?? e.AppDisplayName ??
          e.appId ?? e.AppId ??
          e.name ?? e.Name ??
          id
        )
        return { id, label }
      })
    } else {
      const map =
        activeType === 'user'
          ? index.users
          : activeType === 'group'
          ? index.groups
          : activeType === 'role'
          ? index.roles
          : activeType === 'servicePrincipal'
          ? index.servicePrincipals
          : activeType === 'namedLocation'
          ? index.namedLocations
          : index.organizations
      arr = Array.from(map.values()).map((r) => ({ id: r.id, label: r.label }))
    }
    const q = query.trim().toLowerCase()
    if (q) arr = arr.filter((r) => r.label.toLowerCase().includes(q))
    return arr
  }, [index, activeType, query, rawCounts, rawCache])

  const start = (page - 1) * pageSize
  const pageItems = items.slice(start, start + pageSize)
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))

  return (
    <div className="objects" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="objects__toolbar" style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div className="objects__types">
          {TYPE_ORDER.map((t) => (
            <button
              key={t}
              className={`chip chip--ghost ${t === activeType ? 'chip--active' : ''}`}
              onClick={() => {
                setActiveType(t)
                setPage(1)
                // Lazy load raw file for this type if available and not yet loaded
                if (rawCounts) {
                  const file =
                    t === 'user'
                      ? 'users.json'
                      : t === 'group'
                      ? 'groups.json'
                      : t === 'role'
                      ? 'roles.json'
                      : t === 'servicePrincipal'
                      ? 'service_principals.json'
                      : t === 'namedLocation'
                      ? 'named_locations.json'
                      : 'organizations.json'
                  if (!rawCache[file]) {
                    fetch(`/entities/${file}`, { cache: 'no-store' })
                      .then((r) => (r.ok ? r.json() : []))
                      .then((j) => setRawCache((prev) => ({ ...prev, [file]: Array.isArray(j) ? j : [] })))
                      .catch(() => {})
                  }
                }
              }}
            >
              {LABELS[t]} ({getCount(t, rawCounts, index)})
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder={`Search ${LABELS[activeType]}...`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(1)
          }}
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(12,18,28,0.5)',
            color: '#cfe0ff',
            fontSize: '14px',
            outline: 'none',
            minWidth: '200px'
          }}
        />
        <button
          className="chip"
          onClick={() => exportCsv(pageItems, activeType)}
          title="Export current page as CSV"
        >
          Export CSV
        </button>
      </div>

      <div className="objects__list" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
        {pageItems.map((ref) => (
          <div key={ref.id} className="objects__item" style={{ padding: '10px 12px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, background: 'rgba(12,18,28,0.75)', color: '#cfe0ff' }}>
            <div className="objects__item-label" style={{ fontWeight: 600 }}>{ref.label}</div>
            <div className="objects__item-id" style={{ opacity: 0.7, fontSize: 12 }}>{ref.id}</div>
          </div>
        ))}
        {pageItems.length === 0 && <div className="objects__empty">No results</div>}
      </div>

      <div className="objects__pager" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          Prev
        </button>
        <span>
          Page {page} / {totalPages}
        </span>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
          Next
        </button>
      </div>
    </div>
  )
}

function getCount(t: ObjectType, rawCounts: any, index: ReturnType<typeof buildObjectsIndex>): number {
  if (!rawCounts) return index.totals[t]
  // rawCounts keys: users, groups, roles, servicePrincipals, applications (use servicePrincipals), namedLocations
  const key =
    t === 'user'
      ? 'users'
      : t === 'group'
      ? 'groups'
      : t === 'role'
      ? 'roles'
      : t === 'servicePrincipal'
      ? 'servicePrincipals'
      : t === 'namedLocation'
      ? 'namedLocations'
      : t === 'organization'
      ? 'organizations'
      : 'users'
  return rawCounts[key] ?? index.totals[t]
}

function exportCsv(items: { id: string; label: string }[], type: ObjectType) {
  const rows = [['type', 'id', 'label'], ...items.map((i) => [type, i.id, i.label])]
  const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n')
  
  // Use blob for better compatibility (same as Gaps page)
  const filename = `${type}-objects-${new Date().toISOString().split('T')[0]}.csv`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 100)
}


