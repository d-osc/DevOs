# Shared utilities

Place reusable, non-UI helper functions here, such as formatting, parsing and validation. Keep app-specific helpers beside their app in `src/apps/`.

Prefer pure functions with explicit inputs and outputs. Keep process startup, data processing workflows and I/O in service controllers under `src/services/` or the owning app. Shared UI belongs in `src/components/`.
