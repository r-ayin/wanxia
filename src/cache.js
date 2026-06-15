class TTLCache {
  constructor(ttlMs = 30 * 60 * 1000) {
    this.ttlMs = ttlMs
    this.store = new Map()
    this.loading = new Set()
  }

  get(key) {
    const entry = this.store.get(key)
    if (!entry) return null
    const ttl = entry.ttl || this.ttlMs
    if (Date.now() - entry.ts > ttl) return { data: entry.data, stale: true }
    return { data: entry.data, stale: false, age: Date.now() - entry.ts }
  }

  set(key, data, ttlMs) {
    this.store.set(key, { data, ts: Date.now(), ttl: ttlMs })
    this.loading.delete(key)
  }

  isLoading(key) {
    return this.loading.has(key)
  }

  setLoading(key) {
    this.loading.add(key)
  }

  clearLoading(key) {
    this.loading.delete(key)
  }
}

export const cache = new TTLCache()
export default cache
