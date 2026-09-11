'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

// ============================================================
// Slot de acciones contextuales del header global.
//
// El AppHeader vive en el layout (server) y es idéntico en todas
// las páginas del área autenticada. Las páginas que necesitan
// botones a la derecha (refrescar en Hoy, crear/reordenar en el
// canvas) los inyectan con useSetHeaderActions — sin duplicar
// logo, nav ni menú de usuario.
// ============================================================

type HeaderActionsState = {
  actions: ReactNode
  setActions: (node: ReactNode) => void
}

const HeaderActionsContext = createContext<HeaderActionsState>({
  actions: null,
  setActions: () => {},
})

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null)
  // Valor memoizado: sin esto, cada render del provider re-renderiza a los
  // consumidores y el efecto de useSetHeaderActions entraría en bucle.
  const value = useMemo(() => ({ actions, setActions }), [actions])
  return (
    <HeaderActionsContext.Provider value={value}>
      {children}
    </HeaderActionsContext.Provider>
  )
}

/** Lee las acciones actuales (lo usa el AppHeader). */
export function useHeaderActions(): ReactNode {
  return useContext(HeaderActionsContext).actions
}

/**
 * Publica acciones en el header global. Al desmontar (navegación)
 * limpia el slot para no filtrar botones entre páginas.
 */
export function useSetHeaderActions(actions: ReactNode): void {
  const { setActions } = useContext(HeaderActionsContext)
  useEffect(() => {
    setActions(actions)
    return () => setActions(null)
    // actions suele ser JSX inline (nueva identidad por render);
    // re-publicar es idempotente y evita stales.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setActions, actions])
}
