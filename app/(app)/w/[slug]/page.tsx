import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { getUserProfile } from '@/lib/auth/user-profile'
import { resolveWorkspaceBySlug } from '@/lib/canvas/workspace-by-slug'
import { ForbiddenError } from '@/lib/errors'
import WorkspaceClient from './workspace-client'

// CRÍTICO: depende de la cookie de sesión en server component → no estático.
export const dynamic = 'force-dynamic'

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const session = await getSession()
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/w/${slug}`)}`)
  }

  let workspace
  let role
  try {
    const resolved = await resolveWorkspaceBySlug(slug, session.userId)
    workspace = resolved.workspace
    role = resolved.role
  } catch (error) {
    if (error instanceof ForbiddenError) {
      redirect('/')
    }
    throw error
  }

  // Perfil del usuario para el menú del Toolbar (avatar real, no el del workspace).
  const profile = await getUserProfile(session.userId)

  // NUNCA fetchea nodos/edges aquí (decisión b — el client los carga).
  return (
    <WorkspaceClient
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      userId={session.userId}
      role={role}
      userName={profile?.displayName ?? null}
      userEmail={profile?.email ?? null}
    />
  )
}