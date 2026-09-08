import type { NodeType, NodeStatus, EdgeType } from '@/lib/db/schema'

// ============================================================
// Catálogo de templates de proyecto (Fase 0 — gestión de proyectos).
//
// Definición estática (sin tabla): cada template es un subgrafo reutilizable
// (nodo project + tasks/notes + edges parent_of/depends_on con labels) que
// `applyTemplate` materializa en ZONA LIBRE del workspace. Los edges referencian
// nodos por índice dentro de `nodes` (source/target = posición en el array).
// ============================================================

export type TemplateNodeDef = {
  type: NodeType
  title: string
  content?: string | null
  status?: NodeStatus | null
}

export type TemplateEdgeDef = {
  /** Índice dentro de template.nodes (nodo origen). */
  source: number
  /** Índice dentro de template.nodes (nodo destino). */
  target: number
  type: EdgeType
  label?: string | null
}

export type TemplateDefinition = {
  id: string
  name: string
  emoji: string
  description: string
  nodes: TemplateNodeDef[]
  edges: TemplateEdgeDef[]
}

const SOFTWARE_TEMPLATE: TemplateDefinition = {
  id: 'software-dev',
  name: 'Desarrollo de software',
  emoji: '💻',
  description: 'Proyecto de desarrollo: planificación → arquitectura → implementación → entrega.',
  nodes: [
    {
      type: 'project',
      title: 'Proyecto: Desarrollo de software',
      content:
        'Plan de desarrollo de una aplicación de principio a fin. Cada tarea describe una fase y las conexiones indican la secuencia recomendada.',
    },
    {
      type: 'task',
      title: 'Planificar alcance y requisitos',
      content: 'Define objetivos, usuarios objetivo y el alcance del MVP. Escribe los requisitos funcionales y decide qué queda fuera.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Diseñar arquitectura',
      content: 'Elige stack (frontend, backend, base de datos) y estructura de módulos. Documenta las decisiones clave.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Configurar entorno y CI',
      content: 'Repositorio, entorno de desarrollo, lint/typecheck y pipeline de despliegue automático.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Implementar backend y API',
      content: 'Modelo de datos, endpoints y autenticación. Escribe tests para los flujos críticos.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Implementar frontend',
      content: 'Interfaz principal conectada a la API. Prioriza los flujos del MVP y la usabilidad móvil.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Probar y corregir bugs',
      content: 'Pruebas end-to-end de los flujos principales, regresiones y corrección de incidencias.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Desplegar en producción',
      content: 'Deploy, variables de entorno, monitoreo y verificación post-lanzamiento.',
      status: 'todo',
      },
  ],
  edges: [
    { source: 0, target: 1, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 2, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 3, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 4, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 5, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 6, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 7, type: 'parent_of', label: 'incluye' },
    { source: 1, target: 2, type: 'depends_on', label: 'requiere' },
    { source: 2, target: 3, type: 'depends_on', label: 'requiere' },
    { source: 3, target: 4, type: 'depends_on', label: 'antes de' },
    { source: 4, target: 5, type: 'depends_on', label: 'antes de' },
    { source: 5, target: 6, type: 'depends_on', label: 'antes de' },
    { source: 6, target: 7, type: 'depends_on', label: 'antes de' },
  ],
}

const MARKETING_TEMPLATE: TemplateDefinition = {
  id: 'marketing-campaign',
  name: 'Campaña de marketing',
  emoji: '📣',
  description: 'Lanzamiento de una campaña: audiencia → mensaje → creativos → canales → medición.',
  nodes: [
    {
      type: 'project',
      title: 'Proyecto: Campaña de marketing',
      content:
        'Campaña completa de principio a fin. Las tareas cubren definición, creación de contenido y publicación.',
    },
    {
      type: 'note',
      title: 'Objetivo de la campaña',
      content: 'Define una meta medible: marca, presupuesto y fecha de lanzamiento de referencia.',
    },
    {
      type: 'task',
      title: 'Definir audiencia',
      content: 'Segmenta por demografía, intereses y canal. Crea 2-3 perfiles de comprador.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Definir mensaje clave',
      content: 'Redacta el mensaje central y el llamado a la acción. Una sola idea por campaña.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Producir creativos',
      content: 'Imágenes, textos y videos por canal. Adapta el mensaje clave a cada formato.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Planificar canales y calendario',
      content: 'Elige canales (social, email, ads) y programa las publicaciones con fechas.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Publicar y monitorizar',
      content: 'Lanza la campaña, vigila métricas en tiempo real y responde a la audiencia.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Medir y reportar',
      content: 'Compara resultados contra el objetivo, extrae aprendizajes y documenta el reporte.',
      status: 'todo',
    },
  ],
  edges: [
    { source: 0, target: 1, type: 'related_to', label: 'contexto' },
    { source: 0, target: 2, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 3, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 4, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 5, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 6, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 7, type: 'parent_of', label: 'incluye' },
    { source: 2, target: 3, type: 'depends_on', label: 'requiere' },
    { source: 3, target: 4, type: 'depends_on', label: 'requiere' },
    { source: 4, target: 5, type: 'depends_on', label: 'antes de' },
    { source: 5, target: 6, type: 'depends_on', label: 'antes de' },
    { source: 6, target: 7, type: 'depends_on', label: 'antes de' },
  ],
}

const LAUNCH_TEMPLATE: TemplateDefinition = {
  id: 'product-launch',
  name: 'Lanzamiento de producto',
  emoji: '🚀',
  description: 'De la idea al lanzamiento: investigación → MVP → beta → correcciones → salida al mercado.',
  nodes: [
    {
      type: 'project',
      title: 'Proyecto: Lanzamiento de producto',
      content: 'Ruta completa para llevar un producto al mercado con iteración basada en feedback real.',
    },
    {
      type: 'note',
      title: 'Visión del producto',
      content: 'Problema que resuelve, para quién y qué lo diferencia de la competencia.',
    },
    {
      type: 'task',
      title: 'Investigar el mercado',
      content: 'Entrevistas a usuarios potenciales, análisis de competencia y validación de la idea.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Construir el MVP',
      content: 'Versión mínima que resuelve el problema central. Evita funcionalidades extra.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Beta privada',
      content: 'Comparte el MVP con un grupo pequeño, recoge feedback y prioriza correcciones.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Correcciones y pulido',
      content: 'Arregla los problemas reportados en beta y pule onboarding y rendimiento.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Lanzamiento público',
      content: 'Prepara landing, comunicación y soporte. Publica el producto.',
      status: 'todo',
    },
    {
      type: 'task',
      title: 'Iterar post-lanzamiento',
      content: 'Mide retención, recoge feedback y agenda el siguiente ciclo de mejoras.',
      status: 'todo',
    },
  ],
  edges: [
    { source: 0, target: 1, type: 'related_to', label: 'contexto' },
    { source: 0, target: 2, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 3, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 4, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 5, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 6, type: 'parent_of', label: 'incluye' },
    { source: 0, target: 7, type: 'parent_of', label: 'incluye' },
    { source: 2, target: 3, type: 'depends_on', label: 'antes de' },
    { source: 3, target: 4, type: 'depends_on', label: 'antes de' },
    { source: 4, target: 5, type: 'depends_on', label: 'antes de' },
    { source: 5, target: 6, type: 'depends_on', label: 'antes de' },
    { source: 6, target: 7, type: 'depends_on', label: 'antes de' },
  ],
}

const CATALOG: TemplateDefinition[] = [SOFTWARE_TEMPLATE, MARKETING_TEMPLATE, LAUNCH_TEMPLATE]

export function getTemplateCatalog(): TemplateDefinition[] {
  return CATALOG
}

export function getTemplateById(id: string): TemplateDefinition | undefined {
  return CATALOG.find((t) => t.id === id)
}

export function getTemplatePublicList(): Array<
  Pick<TemplateDefinition, 'id' | 'name' | 'emoji' | 'description'> & { nodeCount: number; edgeCount: number }
> {
  return CATALOG.map((t) => ({
    id: t.id,
    name: t.name,
    emoji: t.emoji,
    description: t.description,
    nodeCount: t.nodes.length,
    edgeCount: t.edges.length,
  }))
}