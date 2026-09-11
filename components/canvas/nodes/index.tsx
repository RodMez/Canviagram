import type { NodeTypes, EdgeTypes } from '@xyflow/react'
import { TaskNode } from './TaskNode'
import { NoteNode } from './NoteNode'
import { IdeaNode } from './IdeaNode'
import { PersonNode } from './PersonNode'
import { ResourceNode } from './ResourceNode'
import { CustomEdge } from '../edges/CustomEdge'

// Registry de tipos de nodo (mapea type → componente).
// F5.1: sin 'project' — un workspace = un proyecto.
export const nodeTypes = {
  task: TaskNode,
  note: NoteNode,
  idea: IdeaNode,
  person: PersonNode,
  resource: ResourceNode,
} satisfies NodeTypes

export const edgeTypes = {
  custom: CustomEdge,
} satisfies EdgeTypes
