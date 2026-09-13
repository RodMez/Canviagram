import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import DemoLanding from '@/components/demo/DemoLanding'

// Landing pública: si ya hay sesión, redirige a la página del usuario (/today).
// Sin sesión: DemoLanding estática (sin DB/env, 100% cliente).
export default async function Home() {
  const session = await getSession()
  if (session) {
    redirect('/today')
  }
  return <DemoLanding />
}