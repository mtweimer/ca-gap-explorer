import type { GraphData } from '../types/graph'

const GRAPH_PATH = '/conditional_access_graph.json'
const SAMPLE_PATH = '/sample-graph-data.json'

async function fetchJson(path: string): Promise<GraphData | null> {
  try {
    const response = await fetch(path, { cache: 'no-store' })
    if (!response.ok) {
      return null
    }
    return (await response.json()) as GraphData
  } catch (error) {
    console.warn(`Failed to fetch ${path}`, error)
    return null
  }
}

export async function loadGraphData(): Promise<GraphData> {
  const primary = await fetchJson(GRAPH_PATH)
  if (primary) {
    return primary
  }

  const sample = await fetchJson(SAMPLE_PATH)
  if (sample) {
    return sample
  }

  throw new Error(
    'Unable to load graph data. Ensure conditional_access_graph.json exists in the output directory or copy scripts/sample-graph-data.json into web/public.'
  )
}
