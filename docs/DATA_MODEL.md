# Data Model

## Workspace

- `id`
- `name`
- `rootPath`
- `description`
- `createdAt`
- `updatedAt`

## Pane

- `id`
- `workspaceId`
- `name`
- `role`
- `command`
- `cwd`
- `autoStart`
- `position`
- `createdAt`
- `updatedAt`

## Todo

- `id`
- `workspaceId`
- `title`
- `description`
- `status`: `todo`, `in_progress`, `done`, `cancelled`
- `priority`: `low`, `medium`, `high`
- `tags`
- `createdAt`
- `updatedAt`

## Note

- `id`
- `workspaceId`
- `title`
- `body`
- `tags`
- `source`: `human`, `agent`, `imported`
- `createdAt`
- `updatedAt`

## Memory

- `id`
- `workspaceId`
- `type`: `fact`, `decision`, `convention`, `handoff`, `setup`, `risk`
- `content`
- `source`
- `tags`
- `createdAt`
- `updatedAt`

## Future Entities

- Agent session.
- Task claim.
- File activity.
- Handoff record.
- MCP audit event.
