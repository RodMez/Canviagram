'use client'

import { useEffect, useState } from 'react'
import {
  fetchWorkspaceMembers,
  type WorkspaceMemberOption,
} from '@/lib/canvas/node-mutations'

const cache = new Map<string, WorkspaceMemberOption[]>()

/**
 * Carga (y cachea) los miembros del workspace para avatares y selects
 * de "responsable". En demo devuelve [] (la demo no expone usuarios).
 */
export function useWorkspaceMembers(workspaceId: string): {
  members: WorkspaceMemberOption[]
  byId: Map<string, WorkspaceMemberOption>
} {
  const [members, setMembers] = useState<WorkspaceMemberOption[]>(
    () => cache.get(workspaceId) ?? []
  )

  useEffect(() => {
    if (cache.has(workspaceId)) {
      setMembers(cache.get(workspaceId) ?? [])
      return
    }
    let cancelled = false
    fetchWorkspaceMembers(workspaceId)
      .then((list) => {
        if (cancelled) return
        cache.set(workspaceId, list)
        setMembers(list)
      })
      .catch((err) => console.error('[useWorkspaceMembers] failed', err))
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const byId = new Map(members.map((m) => [m.userId, m]))
  return { members, byId }
}

export type { WorkspaceMemberOption }