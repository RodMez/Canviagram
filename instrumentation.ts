export async function register() {
  // Solo en runtime de servidor Node (no en edge).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startReminderSweeper } = await import('@/lib/reminders/engine')
    startReminderSweeper()
  }
}