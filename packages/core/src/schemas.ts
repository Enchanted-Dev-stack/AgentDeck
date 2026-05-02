import { z } from "zod";

export const todoStatusSchema = z.enum(["todo", "in_progress", "done", "cancelled"]);
export const prioritySchema = z.enum(["low", "medium", "high"]);
export const noteSourceSchema = z.enum(["human", "agent", "imported"]);
export const memoryTypeSchema = z.enum([
  "fact",
  "decision",
  "convention",
  "handoff",
  "setup",
  "risk",
]);

export const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  description: z.string().default(""),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const paneSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().min(1),
  role: z.string().default("shell"),
  command: z.string().default(""),
  cwd: z.string().default("."),
  autoStart: z.boolean().default(false),
  position: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const todoSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().default(""),
  status: todoStatusSchema.default("todo"),
  priority: prioritySchema.default("medium"),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const noteSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string().min(1),
  body: z.string().default(""),
  tags: z.array(z.string()).default([]),
  source: noteSourceSchema.default("human"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const memorySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  type: memoryTypeSchema.default("fact"),
  content: z.string().min(1),
  source: z.string().default("human"),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const agentDeckStateSchema = z.object({
  version: z.literal(1),
  workspaces: z.array(workspaceSchema).default([]),
  panes: z.array(paneSchema).default([]),
  todos: z.array(todoSchema).default([]),
  notes: z.array(noteSchema).default([]),
  memories: z.array(memorySchema).default([]),
});

export type TodoStatus = z.infer<typeof todoStatusSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type NoteSource = z.infer<typeof noteSourceSchema>;
export type MemoryType = z.infer<typeof memoryTypeSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type Pane = z.infer<typeof paneSchema>;
export type Todo = z.infer<typeof todoSchema>;
export type Note = z.infer<typeof noteSchema>;
export type Memory = z.infer<typeof memorySchema>;
export type AgentDeckState = z.infer<typeof agentDeckStateSchema>;

export function createEmptyState(): AgentDeckState {
  return {
    version: 1,
    workspaces: [],
    panes: [],
    todos: [],
    notes: [],
    memories: [],
  };
}
