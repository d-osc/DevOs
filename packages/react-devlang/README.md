# react-devlang

React-style function components for **native DevLang + GTK 3**. Version 0.4.0.
`ui.DrawingArea(options, draw)` provides native Cairo drawing. The callback receives
`(cr: *void, width: i32, height: i32)`; the context is borrowed from GTK and must
not be destroyed. Property updates schedule drawing; `ui.queueDraw(context, id)`
also invalidates a canvas for animation without a component state update.
The renderer, hooks and reconciliation are DevLang. A small C ABI backend owns
GTK widgets and forwards events through one managed callback per root. The
result is a native executable; GJS, Node, React JS and a JavaScript bridge are
not part of the executable.

JSX is supported in **`.devx`** files. The DevLang build-time converter emits ordinary
DevLang, then the native compiler links GTK. See the [JSX guide](docs/jsx.md) and
the runnable [JSX counter](examples/counter.devx). Plain `.dev` source remains
supported, including the original [function-call counter](examples/counter.dev).

This package builds independently of DevOs. The first production consumer is
the native [Task Manager](../../src/apps/org.devos.taskmanager/native.devx),
with an asynchronous DevLang data service in a separate process.

## Build and run

On Linux/WSL, install GTK 3 development files, `pkg-config`, a C11 compiler and
DevLang `d` + `devc` + `devrun`. The JSX converter, build/check driver and test
suites are DevLang; Python is not required. Tested with `d 0.5.4`.
The converter runs in the DevLang source runtime; the resulting GTK application
is a native executable.

From the DevOs root:

```sh
sh tools/build/react-devlang.sh
./build/react-devlang/counter
sh tools/check/react-devlang.sh
d tests/react-devlang.test.dev
d tests/react-devlang-jsx.test.dev
d tools/test/react-devlang-smoke.dev --
```

Build the DevOs native app before running the Wayland smoke suite:
`sh tools/build/native-apps.sh`. See [migration status](../../docs/devlang-app-migration.md).

## Separate data services

`react_devlang/channel` connects a native GTK component to a source-runtime
DevLang worker. GTK receives owned UTF-8 frames asynchronously on its main
thread. `connect` returns an effect cleanup; retain it with `useEffect` so closing
the component cancels I/O and stops the child.
`failed(handle)` distinguishes a transport/process failure from a worker's
domain error response. The channel watches both stdout and process termination,
including CLI drivers whose interpreter child still holds the output pipe.
`interval(handle, milliseconds)` sets a read-only polling cadence (100–60000 ms);
zero restores the normal active/inactive cadence. Paused or hidden windows still
stop polling. The panel clock uses a one-second cadence without formatting on GTK.

`connectWithLibrary(context, program, script, root, library, receive, opened)`
adds an explicit `--ffi-lib` to the worker command. Native codec/helper libraries
run in the data process, keeping blocking work off GTK's main thread.

`send` updates the latest polling request; rapid updates coalesce. `command`
queues one-shot operations separately and never repeats them on the poll timer.
The queue allows 64 commands, requests up to 64 KiB, and response frames up to
4 MiB. `pause` suspends polling. Windows poll every 2 seconds while focused,
8 seconds while inactive, and stop polling while minimized. Lines are terminated
by a newline; the service must answer each request with exactly one line.

The channel runs executables using separate arguments. Processing, formatting,
filtering and sorting belong to the worker; the native component owns display,
selection, confirmation and other transient UI state.

The package also builds independently of the DevOs directory layout:

```sh
sh packages/react-devlang/tools/build.sh /absolute/path/app.dev /absolute/path/app
```

That script compiles the C backend and links the DevLang source with GTK. Set
`DEVLANG_D` or `CC` to select the toolchain, and `DEVLANG_RUN` to override the
DevLang source-runtime command for JSX tooling. No compiler is needed to run the
resulting executable, but the target needs GTK 3 shared libraries. Build for the
target architecture; these are native binaries, not architecture-neutral files.

The module namespace is `react_devlang` because DevLang package identifiers use
underscores. The library/product name and directory are `react-devlang`.
`package.don` declares the source package; the build script supplies the native
GTK link dependencies. Source execution with plain `d app.dev` is not the
supported build/run path for this package.

## A component

```dev
use "react_devlang/ui" as ui

fn Counter(context: *ui.Context): ui.Node {
    let count = ui.useState(context, 0)
    return ui.Box(ui.props(), Vec<ui.Node>(
        ui.Label("Count: ${count.value}"),
        ui.Button(ui.named("increment"), "Increment", fn() {
            ui.update(count, fn(previous: i64): i64 { return previous + 1 })
        })
    ))
}

fn main(): i32 {
    return ui.run("Counter", 480, 320, Counter) ? 0 : 1
}
return main()
```

All widget updates happen on the GTK main thread. Setters coalesce rendering
onto a GLib idle callback. `value` is the render snapshot; `get()` reads the
latest value for multiple updates in one event. Equal state values do not queue
another render. Do not call state setters while rendering.

## Props, children and identity

`ui.props()` creates default layout props. Change `vertical`, `spacing`, `expand`,
`sensitive`, `visible`, `width`, `height`, `id` and `className` before passing them
to a widget. `ui.named("id")` and `ui.keyed(42)` are convenience constructors.
Labels also support `xalign`, `widthChars`, `wrap` and `ellipsize`; entries support
`placeholder`. `SearchEntry` and `Select` are available through the function API.
Use `ui.withProps(node, options)` for widgets such as `Label`.

Custom props are ordinary DevLang structs captured by a component factory:

```dev
struct RowProps { id: i64, title: str }

fn Row(context: *ui.Context, props: RowProps): ui.Node {
    let count = ui.useState(context, 0)
    return ui.Button(ui.props(), props.title, fn() {
        count.set(count.get() + 1)
    })
}

# Inside a parent's render:
# ui.component(10, ui.keyed(item.id), fn(child: *ui.Context): ui.Node {
#     return Row(child, item)
# })
```

Use a stable numeric **type tag** (`10` above) for each component type, and a
unique nonnegative sibling key for each item. Changing a component's type tag or
key resets its hooks. Reordering stable keys preserves hooks and native widgets.
Negative keys mean positional identity. Duplicate sibling keys are rejected.
An explicit component node owns its hook frame and a GTK box; it is not a
fragment. Calling a helper directly shares its caller's hook frame instead.

## Hooks

| Hook | State / result |
| --- | --- |
| `useState(context, initial)` | `i64` value, `get()` and `set(i64)` |
| `update(state, transform)` | Functional update using the latest integer state |
| `useBool(context, initial)` | Boolean value and `set(bool)` |
| `useText(context, initial)` | Owned UTF-8 `Text`, `get()`, `set(Text)`, `revision` |
| `useReducer(context, initial, reducer)` | Integer state and `dispatch(i64)` |
| `useRef(context, initial)` | Mutable integer `get()` / `set()` without rendering |
| `useEffect(context, setup, dependencies)` | Post-commit setup returning a cleanup function |

Hooks must be called in the same order and count in every render. Effects take
`Vec<i64>` dependency values; use a text state's `revision` when tracking text
changes. An empty vector runs setup once per mount. Cleanup runs before the next
changed setup, on unmount, and on root shutdown. Removed hook frames release
their managed values and closures. Setters for removed component generations are
ignored while the root is alive.

State/ref handles and context pointers belong to the blocking `run` call. Do not
store them for use after `run` returns, pass them to other threads, or call GTK
from a worker. This version does not provide a cross-thread dispatcher. Native
resources created by an effect must be unregistered in its cleanup.

`Text` stores UTF-8 bytes in a managed `Vec<u8>`, so state does not borrow temporary
entry buffers. Use `ui.text("ภาษาไทย")`, `TextLabel(value)` and controlled
`Entry(props, value, setter)`. Low-level string props should remain valid for
their use; owned `Text` is the durable form for dynamic text.

## Widgets and styling

Available widgets: `Box`, `Label`, `TextLabel`, `Button`, `Entry`, `CheckBox`,
`Switch` (boolean `active`/`onChange`), `TextArea` (owned multiline UTF-8
`value`/`onChange`, with wrapping),
`Scroll` (one child), `Progress`, `Separator`, and explicit `component` nodes.
Native event handlers are replaced when the node rerenders, without adding
another GTK signal connection. Existing compatible widgets are updated in place.

`runStyled(title, width, height, css, render)` installs a scoped-lifetime GTK CSS
provider; `Props.className` selects classes. Invalid CSS or an unavailable GTK
display makes `run`/`runStyled` return false. Provider and pending idle sources
are removed at shutdown. UI state stays in this process; keep blocking data work
in a separate service when integrating real apps.

`find`, `click`, `change` and `readText` are small native-widget inspection helpers
used by the integration tests. They operate on widgets in the current root.

## Compatibility and validation

This is a new React-style library, not the React JS implementation or an npm
compatibility layer. JSX attributes contain DevLang expressions; supported event
arrow shorthand is translated at build time. TSX/JavaScript source, browser DOM,
generic arbitrary-object state, Context API, Suspense,
concurrent rendering and list virtualization are not implemented. The keyed
reconciler currently uses linear searches, so large lists need a separate design.
Linux GTK 3 is the validated backend; Windows/macOS backends are not provided.

The native integration tests exercise real GTK events, UTF-8 state, controlled
inputs, reducers, refs, keyed reorder/remount, effect setup/cleanup, 1,000 repeated
updates without accumulating widgets, root teardown, scroll-child replacement,
CSS lifetime, duplicate-key rejection and hook-order diagnostics. They enable
fatal GTK warnings and confirm that the executable is ELF, links GTK and does
not link SpiderMonkey. AddressSanitizer validation was also run on the lifecycle
test with leak detection disabled for system GTK allocations; this is not a
general proof of zero leaks.

JSX tests also cover the lexer, nested expressions, props validation, imports,
source-mapped compiler errors, fragments, keyed lists, conditional children and
real native JSX events. Generated files and manifests stay in the build directory.

The Wayland smoke command requires the normal DevOs build and native tests to
have run first. It launches a private compositor and runs the native lifecycle
and widget tests there; it does not restart or modify the active desktop.

## Native popovers

`ui.Popover(props, anchorId, child, dismissed)` creates a GTK popover anchored to a
named widget. `anchorId` is `ui.Text`; the child is one native node. Conditionally
render the popover while open and clear that state from `dismissed`. Its contents
participate in reconciliation, events and `ui.find` like ordinary nodes. The
popover points to the anchor while its ownership follows the root, allowing a
reconciled anchor to disappear without destroying still-managed child nodes.
Set the returned node's `active` field to `false` for a nonmodal hover preview;
the default is modal. `ui.onPointer(node, handler)` opts into `ui.Text` events
`enter`, `leave`, `primary` and `context`. A context press is consumed; primary
presses retain normal GTK activation. Crossing into a child is filtered out.
Popovers can extend beyond their parent window. Native panel hosts use
`rd_popover_direction(root, above)` to select the desktop side of a panel edge.
Reconciliation updates an open popover without replaying its opening animation.
