import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { resolveWorkspaceBySlug } from '@/lib/canvas/workspace-by-slug'
import { ForbiddenError } from '@/lib/errors'
import SettingsClient from './settings-client'

// CRÍTICO: depende de la cookie de sesión en server component → no estático.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function SettingsPage({
  params,
}: {
  params: { slug: string }
}) {
  const session = await getSession()
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/w/${params.slug}/settings`)}`)
  }

  let workspace
  let role
  try {
    const resolved = await resolveWorkspaceBySlug(params.slug, session.userId)
    workspace = resolved.workspace
    role = resolved.role
  } catch (error) {
    if (error instanceof ForbiddenError) {
      redirect('/')
    }
    throw error
  }

  // key={workspace.slug}: si el slug cambia en General, router.push remonta el client
  // con estado fresco (los useState se inicializan desde props).
  return (
    <SettingsClient
      key={workspace.slug}
      workspace={{ ...workspace, role }}
      userId={session.userId}
    />
  )
}