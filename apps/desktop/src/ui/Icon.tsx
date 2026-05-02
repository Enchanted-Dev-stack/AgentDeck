import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  Brain02Icon,
  CommandLineIcon,
  DatabaseIcon,
  Delete02Icon,
  DragDropIcon,
  FolderOpenIcon,
  GridViewIcon,
  InsertColumnRightIcon,
  InsertRowDownIcon,
  LayoutGridIcon,
  MoreHorizontalIcon,
  NoteIcon,
  Search01Icon,
  ServerStack01Icon,
  Settings02Icon,
  SparklesIcon,
  Task01Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";

const iconRegistry = {
  add: Add01Icon,
  brain: Brain02Icon,
  command: CommandLineIcon,
  database: DatabaseIcon,
  delete: Delete02Icon,
  drag: DragDropIcon,
  folder: FolderOpenIcon,
  grid: GridViewIcon,
  splitDown: InsertRowDownIcon,
  splitRight: InsertColumnRightIcon,
  layout: LayoutGridIcon,
  more: MoreHorizontalIcon,
  note: NoteIcon,
  search: Search01Icon,
  server: ServerStack01Icon,
  settings: Settings02Icon,
  sparkles: SparklesIcon,
  task: Task01Icon,
  terminal: TerminalIcon,
} satisfies Record<string, IconSvgElement>;

export type AgentDeckIconName = keyof typeof iconRegistry;

export interface AgentDeckIconProps {
  name: AgentDeckIconName;
  label?: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function AgentDeckIcon({
  name,
  label,
  size = 18,
  strokeWidth = 1.75,
  className,
}: AgentDeckIconProps) {
  return (
    <HugeiconsIcon
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={className}
      color="currentColor"
      icon={iconRegistry[name]}
      role={label ? "img" : undefined}
      size={size}
      strokeWidth={strokeWidth}
    />
  );
}
