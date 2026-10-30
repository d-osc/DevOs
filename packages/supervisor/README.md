# @dev-os/supervisor

GJS supervisor library for Dev OS. Import from `@dev-os/supervisor` or its exported subpaths. Set `DEV_OS_ROOT` to the host assets directory when using an installed package.

`runSupervisor(options)` delegates to the installed DevLang supervisor, while
keeping the calling GJS main loop responsive and forwarding TERM/INT. Restart,
process-group cleanup and version selection are implemented in
`lib/session-supervisor.dev`. The host runtime supplies `devrun` and the compiled
`dist/native/libsupervisor.so`; build it with `sh tools/build/native-supervisor.sh`.

Build the archive with `npm run supervisor:pack`.
