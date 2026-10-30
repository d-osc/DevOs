# Background compatibility implementation

These JS/TS modules preserve the existing `@dev-os/compat/background` and
`background-view` APIs for JS/TS clients. Native rendering and data processing
live in `src/system/org.devos.background`.

The system manifest launches `dist/native/system-background` through the session
supervisor. These modules are no longer the production desktop frontend.
Settings navigation opens `dist/native/background-settings` in its own process.
Public JS/TS SDK APIs remain available; system Settings no longer imports this page.
