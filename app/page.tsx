import DemoLanding from '@/components/demo/DemoLanding'

// Demo Landing pública (F4.1): página estática — sin imports de DB,
// sin env, sin force-dynamic. El demo corre 100% en el cliente.
export default function Home() {
  return <DemoLanding />
}