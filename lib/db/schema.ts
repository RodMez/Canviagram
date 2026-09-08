import {
  sqliteTable,
  text,
  real,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core'
import { sql, relations } from 'drizzle-orm'

// ============================================================
// TIPOS DE DOMINIO
// ============================================================

export const NODE_TYPES = [
  'project',
  'task',
  'note',
  'idea',
  'person',
  'resource',
] as const
export type NodeType = (typeof NODE_TYPES)[number]

export const NODE_STATUSES = ['todo', 'in_progress', 'done'] as const
export type NodeStatus = (typeof NODE_STATUSES)[number]

export const EDGE_TYPES = ['depends_on', 'parent_of', 'related_to'] as const
export type EdgeType = (typeof EDGE_TYPES)[number]

export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export const INVITATION_ROLES = ['admin', 'member', 'viewer'] as const
export type InvitationRole = (typeof INVITATION_ROLES)[number]

// ============================================================
// AUTH
// ============================================================

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    emailVerified: integer('email_verified', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date()),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  },
  (t) => ({
    emailIdx: uniqueIndex('idx_users_email').on(t.email),
    deletedAtIdx: index('idx_users_deleted_at').on(t.deletedAt),
  })
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    userIdx: index('idx_sessions_user').on(t.userId),
    tokenIdx: uniqueIndex('idx_sessions_token').on(t.tokenHash),
    expiresIdx: index('idx_sessions_expires').on(t.expiresAt),
  })
)

export const emailVerificationTokens = sqliteTable(
  'email_verification_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    tokenIdx: uniqueIndex('idx_email_verify_token').on(t.tokenHash),
    userIdx: index('idx_email_verify_user').on(t.userId),
  })
)

export const passwordResetTokens = sqliteTable(
  'password_reset_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    tokenIdx: uniqueIndex('idx_pwd_reset_token').on(t.tokenHash),
    userIdx: index('idx_pwd_reset_user').on(t.userId),
  })
)

// ============================================================
// WORKSPACES Y MEMBRESÍAS
// ============================================================

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    ownerIdx: index('idx_workspaces_owner').on(t.ownerId),
    slugIdx: uniqueIndex('idx_workspaces_slug').on(t.slug),
  })
)

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: WORKSPACE_ROLES }).notNull().default('member'),
    invitedBy: text('invited_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    joinedAt: integer('joined_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    workspaceUserIdx: uniqueIndex('idx_members_workspace_user').on(
      t.workspaceId,
      t.userId
    ),
    workspaceIdx: index('idx_members_workspace').on(t.workspaceId),
    userIdx: index('idx_members_user').on(t.userId),
  })
)

export const invitations = sqliteTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role', { enum: INVITATION_ROLES }).notNull().default('member'),
    tokenHash: text('token_hash').notNull(),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    tokenIdx: uniqueIndex('idx_invitations_token').on(t.tokenHash),
    workspaceEmailIdx: index('idx_invitations_workspace_email').on(
      t.workspaceId,
      t.email
    ),
  })
)

// ============================================================
// CANVAS
// ============================================================

export const nodes = sqliteTable(
  'nodes',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    type: text('type', { enum: NODE_TYPES }).notNull(),
    title: text('title').notNull(),
    content: text('content'),
    status: text('status', { enum: NODE_STATUSES }),
    positionX: real('position_x').notNull().default(0.0),
    positionY: real('position_y').notNull().default(0.0),
    dueDate: integer('due_date', { mode: 'timestamp' }),
    reminderOffsetMin: integer('reminder_offset_min'),
    notifiedAt: integer('notified_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date()),
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  },
  (t) => ({
    workspaceIdx: index('idx_nodes_workspace').on(t.workspaceId),
    workspaceTypeIdx: index('idx_nodes_workspace_type').on(
      t.workspaceId,
      t.type
    ),
    createdByIdx: index('idx_nodes_created_by').on(t.createdBy),
    deletedAtIdx: index('idx_nodes_deleted_at').on(t.deletedAt),
  })
)

export const edges = sqliteTable(
  'edges',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    sourceId: text('source_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    targetId: text('target_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    type: text('type', { enum: EDGE_TYPES }).notNull().default('related_to'),
    label: text('label'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    workspaceIdx: index('idx_edges_workspace').on(t.workspaceId),
    sourceIdx: index('idx_edges_source').on(t.sourceId),
    targetIdx: index('idx_edges_target').on(t.targetId),
    pairIdx: index('idx_edges_pair').on(t.sourceId, t.targetId),
  })
)

// ============================================================
// TELEGRAM
// ============================================================

/**
 * Vinculación de un chat de Telegram a una CUENTA de Canviagram.
 * - userId: cuenta a la que se vincula el chat (una cuenta = chat).
 * - activeWorkspaceId: workspace donde el usuario trabaja AHORA desde este chat
 *   (nullable; SET NULL al borrar el workspace). El chat puede re-vincularse a
 *   cualquier workspace del usuario con /usar <slug> sin desvincular la cuenta.
 * - lastActivityAt: touch en cada mensaje del bot (estado "vivo").
 * La frontera de seguridad se mantiene: workspaceId/userId NUNCA vienen del texto.
 */
export const telegramChats = sqliteTable(
  'telegram_chats',
  {
    telegramChatId: text('telegram_chat_id').notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activeWorkspaceId: text('active_workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    lastActivityAt: integer('last_activity_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.telegramChatId, t.telegramUserId] }),
    chatIdx: index('idx_telegram_chat').on(t.telegramChatId),
    activeWorkspaceIdx: index('idx_telegram_active_workspace').on(t.activeWorkspaceId),
    userIdIdx: index('idx_telegram_user').on(t.userId),
  })
)

// ============================================================
// CHAT IA (persistencia web + memoria Telegram)
// ============================================================

export const CHAT_SOURCES = ['web', 'telegram'] as const
export type ChatSource = (typeof CHAT_SOURCES)[number]

export const CHAT_ROLES = ['user', 'assistant'] as const
export type ChatRole = (typeof CHAT_ROLES)[number]

/** Longitud máxima por mensaje (en chars) — evita abuso de payload y filas gigantes. */
export const CHAT_MESSAGE_MAX_CONTENT = 4000
/** Máximo de mensajes retenidos por chatKey. Se barren los más antiguos al exceder. */
export const CHAT_MESSAGES_CAP = 200

/**
 * Historial de conversación con la IA.
 * - chatKey: web = userId; telegram = `tg:<telegramChatId>:<telegramUserId>`.
 * - source: canal donde se originó (web | telegram); se usa para memoria del bot.
 */
export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    chatKey: text('chat_key').notNull(),
    source: text('source', { enum: CHAT_SOURCES }).notNull().default('web'),
    role: text('role', { enum: CHAT_ROLES }).notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    workspaceChatIdx: index('idx_chat_messages_workspace_chat').on(
      t.workspaceId,
      t.chatKey,
      t.createdAt
    ),
    chatKeyIdx: index('idx_chat_messages_chat_key').on(t.chatKey),
  })
)

// ============================================================
// NOTIFICACIONES
// ============================================================

export const NOTIFICATION_KINDS = ['reminder', 'mention', 'system'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/**
 * Campana in-app (Fase 3): notificaciones por usuario+workspace, visibles
 * sin importar el workspace activo. El sweeper inserta una fila por miembro;
 * el lector (campana) las marca read.
 */
export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').references(() => nodes.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: NOTIFICATION_KINDS }).notNull().default('system'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    readAt: integer('read_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    userUnreadIdx: index('idx_notifications_user_unread').on(t.userId, t.readAt, t.createdAt),
  })
)

/**
 * Suscripciones Web Push (Fase 3). Una suscripción es por usuario+workspace
 * (el push se envía a todos los miembros con suscripción, sin importar el
 * workspace activo en Telegram).
 */
export const webPushSubscriptions = sqliteTable(
  'web_push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    keysAuth: text('keys_auth').notNull(),
    keysP256dh: text('keys_p256dh').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    endpointIdx: uniqueIndex('idx_webpush_endpoint').on(t.endpoint),
    userIdx: index('idx_webpush_user').on(t.userId),
  })
)

// ============================================================
// RELACIONES DRIZZLE
// ============================================================

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  workspacesOwned: many(workspaces),
  memberships: many(workspaceMembers),
  nodes: many(nodes),
  edges: many(edges),
}))

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  owner: one(users, { fields: [workspaces.ownerId], references: [users.id] }),
  members: many(workspaceMembers),
  invitations: many(invitations),
  nodes: many(nodes),
  edges: many(edges),
  telegramChats: many(telegramChats),
  chatMessages: many(chatMessages),
}))

export const workspaceMembersRelations = relations(
  workspaceMembers,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceMembers.workspaceId],
      references: [workspaces.id],
    }),
    user: one(users, {
      fields: [workspaceMembers.userId],
      references: [users.id],
    }),
  })
)

export const nodesRelations = relations(nodes, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [nodes.workspaceId],
    references: [workspaces.id],
  }),
  creator: one(users, {
    fields: [nodes.createdBy],
    references: [users.id],
  }),
  outgoingEdges: many(edges, { relationName: 'source' }),
  incomingEdges: many(edges, { relationName: 'target' }),
}))

export const edgesRelations = relations(edges, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [edges.workspaceId],
    references: [workspaces.id],
  }),
  creator: one(users, {
    fields: [edges.createdBy],
    references: [users.id],
  }),
  source: one(nodes, {
    fields: [edges.sourceId],
    references: [nodes.id],
    relationName: 'source',
  }),
  target: one(nodes, {
    fields: [edges.targetId],
    references: [nodes.id],
    relationName: 'target',
  }),
}))

export const telegramChatsRelations = relations(telegramChats, ({ one }) => ({
  user: one(users, {
    fields: [telegramChats.userId],
    references: [users.id],
  }),
  activeWorkspace: one(workspaces, {
    fields: [telegramChats.activeWorkspaceId],
    references: [workspaces.id],
  }),
}))

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [chatMessages.workspaceId],
    references: [workspaces.id],
  }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [notifications.workspaceId],
    references: [workspaces.id],
  }),
  node: one(nodes, {
    fields: [notifications.nodeId],
    references: [nodes.id],
  }),
}))

export const webPushSubscriptionsRelations = relations(webPushSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [webPushSubscriptions.userId],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [webPushSubscriptions.workspaceId],
    references: [workspaces.id],
  }),
}))

// ============================================================
// TIPOS INFERIDOS
// Usar en canvas-service.ts, route handlers y schemas de Zod.
// Nunca duplicar tipos a mano — siempre inferir desde aquí.
// ============================================================

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert

export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect
export type NewEmailVerificationToken = typeof emailVerificationTokens.$inferInsert

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert

export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert

export type WorkspaceMember = typeof workspaceMembers.$inferSelect
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert

export type Invitation = typeof invitations.$inferSelect
export type NewInvitation = typeof invitations.$inferInsert

export type Node = typeof nodes.$inferSelect
export type NewNode = typeof nodes.$inferInsert

export type Edge = typeof edges.$inferSelect
export type NewEdge = typeof edges.$inferInsert

export type TelegramChat = typeof telegramChats.$inferSelect
export type NewTelegramChat = typeof telegramChats.$inferInsert

export type ChatMessage = typeof chatMessages.$inferSelect
export type NewChatMessage = typeof chatMessages.$inferInsert

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert

export type WebPushSubscription = typeof webPushSubscriptions.$inferSelect
export type NewWebPushSubscription = typeof webPushSubscriptions.$inferInsert