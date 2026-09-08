import ResetPasswordForm from "./reset-password-form"

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <ResetPasswordForm initialToken={token} />
}