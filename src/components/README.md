# Shared UI components

Place reusable application UI components here. App-specific views remain in `src/apps/`, and optional extension views remain in `src/extensions/`.

Components render prepared data, handle input and animate UI. Data processing and I/O belong in service controllers; pass display data and action callbacks through component props.

Use the existing GTK/React primitives from `@dev-os/core`. The shared renderer and widget primitives remain in `packages/core/`.
