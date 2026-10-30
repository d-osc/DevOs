# JSX for react-devlang

Write DevLang functions with JSX in `.devx` files. The converter is a lexer/parser,
not a regex replacement or a JavaScript engine. It leaves ordinary DevLang code,
strings, comments, generic types and comparisons intact.

```dev
use "react_devlang/ui" as ui

struct CounterProps { initial: i64 }

fn Counter(context: *ui.Context, props: CounterProps): ui.Node {
    let count = ui.useState(context, props.initial)
    return <Box spacing={16} className="counter">
        <Label>Count: {count.value}</Label>
        <Button onClick={() => count.set(count.get() + 1)}>
            Increment
        </Button>
    </Box>
}

fn App(context: *ui.Context): ui.Node {
    return <Counter initial={0} />
}

return ui.run("Counter", 480, 320, App) ? 0 : 1
```

Build on Linux/WSL:

```sh
sh tools/build/react-devlang.sh packages/react-devlang/examples/counter.devx build/react-devlang/counter-jsx
./build/react-devlang/counter-jsx
```

For a separate project, use the package's own `tools/build.sh SOURCE OUTPUT`.
The JSX converter and compiler driver are written in DevLang and run with `d`
and its source runtime (`devrun`). Python is not required. The executable needs
GTK shared libraries. The DevLang compiler itself is unchanged.

## Elements and props

Available tags are `Box`, `Label`, `TextLabel`, `Button`, `Entry`, `PasswordEntry`, `SearchEntry`, `Icon`, `CheckBox`,
`Scroll`, `Progress`, `Separator`, `Fragment`, and custom function components.
`<ui.Box>` also works with the imported UI alias.

Layout props: `id`, `className`, `key`, `spacing`, `expand`, `vertical`,
`orientation="vertical|horizontal"`, `sensitive`, `disabled`, `visible`, `width`,
`height`, `widthRequest`, `heightRequest`, `margin`, `halign`, `valign`. Alignment
accepts `"fill"`, `"start"`, `"end"`, `"center"`, or `"baseline"` (or an i32
expression with GTK alignment values 0–4). Bare Boolean props mean true.
Label props include `xalign`, `widthChars`, `wrap` and `ellipsize`. Entries accept
`placeholder`, `value`, `onChange`, and `onActivate`. `PasswordEntry` masks input
and sets GTK's password input purpose and no-spellcheck hint. Its controlled
value remains application-owned; clear the state after authentication completes.
`onActivate` is a zero-argument callback for Enter. For plain DevLang use
`ui.onActivate(ui.PasswordEntry(options, value, changed), activated)`.
`Icon` accepts a theme icon `name` (`iconName` alias) and `iconSize` (`pixelSize`
alias, default 16). Use `ui.Select` inside expressions for dropdown controls.

```dev
<Box orientation="vertical" halign="center" valign="center" margin={24} spacing={12}>
    <Icon iconName="dialog-password-symbolic" pixelSize={32} />
    <PasswordEntry value={password.value} placeholder="OS password"
        onChange={value => password.set(value)} onActivate={() => submit()} />
</Box>
```
Attribute values are quoted strings or `{DevLang expressions}`. Text and quoted
attributes decode HTML entities. Decoded literal `${...}` text (for example,
braces written as entities) is escaped in the generated DevLang instead of being
evaluated. Multiline text removes indentation and joins content lines.

```dev
<Box {...layout} spacing={12}>
    <Label id="heading">Hello &amp; สวัสดี</Label>
    <Button disabled={!ready.value} onClick={fn() { save() }}>Save</Button>
</Box>
```

`{...layout}` spreads a complete `ui.Props` value; later layout props override
earlier values. This is typed DevLang, so JavaScript object spread and inline
style objects are not supported. Use `className` and `ui.runStyled` for GTK CSS.
Unsupported props, unknown local components, duplicate props and malformed tags
produce diagnostics with source file, line and column.

`Label` accepts scalar text children (strings, numbers, Boolean values), mixing
literal text and expressions. `TextLabel` accepts owned `ui.Text` expressions:

```dev
<Label>{props.title}: {count.value}</Label>
<TextLabel>{name.value}</TextLabel>
<Label text={props.title} />
```

Do not use both a text/value prop and nested text. `Button` supports either text
children or nested widget children, such as `<Button><Box>...</Box></Button>`.
Switching a button between text-only and widget-child representations replaces
that button. `Scroll` wraps its children in a layout box to satisfy GTK's
single-child contract.

## Events and controlled inputs

```dev
<Button onClick={() => count.set(count.get() + 1)}>Add</Button>
<Button onClick={() => { count.set(0) }}>Reset</Button>
<Entry value={name.value} onChange={value => name.set(value)} />
<CheckBox checked={enabled.value} onChange={value => enabled.set(value)}>
    Enabled
</CheckBox>
<Progress fraction={0.5} />
```

- `Button.onClick`: no arguments.
- `Entry.onChange`: an owned `ui.Text`, not a DOM event.
- `CheckBox.onChange`: the actual checked `bool`, including repeated toggles
  before a render. `onClick` also works without arguments.
- `onClicked` / `onChanged` are aliases; `active` aliases `checked`.

Use a DevLang `fn` value or a function reference for handlers. Built-in event
attributes also accept `() => expression`, `() => { statements }`, and
`value => expression` / `value => { statements }`. The converter supplies the
event parameter type. This shorthand does not introduce general JavaScript
arrow functions elsewhere in DevLang. Custom props callbacks use normal typed
DevLang `fn` expressions.

Entry values are owned `ui.Text`; quoted literal `value="initial"` is converted
automatically. Convert a dynamic `str` using `ui.text(value)` explicitly.

## Custom components

A local component is a named function returning `ui.Node`, taking a
`*ui.Context` and optionally one typed props struct. The converter generates
the component type tag, hook boundary and props constructor automatically.

```dev
struct CardProps {
    title: str
    children: Vec<ui.Node>
}

fn Card(context: *ui.Context, props: CardProps): ui.Node {
    return <Box>
        <Label>{props.title}</Label>
        <Box>{...props.children}</Box>
    </Box>
}

# Inside a parent's return:
# <Card title="Settings"><Label>Content</Label></Card>
```

All fields are required; a declared `children` field defaults to an empty vector
when there are no nested children. Other missing or unknown props are errors.
Props structs can use comma or newline field separators. The reserved `key`
attribute controls identity and is not forwarded as a custom prop. Keys are
nonnegative `i64` values, matching the runtime.

An existing complete props struct can be passed with `<Card props={value} />`
or `<Card {...value} />`, followed by typed field overrides. The props/spread
must be the first non-key attribute. Attributes evaluate once in their written
order, followed by nested children. A nested child requires the custom props
struct to declare `children: Vec<ui.Node>`.

Relative imports can use `.devx`:

```dev
use "./card.devx" as card
# <card.Card title="Imported"><Label>Content</Label></card.Card>
```

Named props are inferred for local components and resolvable relative imports.
For externally namespaced components whose schema is not available to the
converter, use an explicit typed `props={...}` value. Such functions must follow
the same context/props calling convention; the native compiler checks types.
JSX does not support arbitrary dynamically selected component values or TSX
generic tag syntax in this release.

## Children, lists and conditions

```dev
<>
    {show.value && <Label>Visible</Label>}
    {show.value ? <Label>Yes</Label> : <Label>No</Label>}
    {show.value ? <Label>Optional</Label> : null}
    <Box>{items.map(fn(item: Item): ui.Node {
        return <Label key={item.id}>{item.title}</Label>
    })}</Box>
    <Box>{...existingNodes}</Box>
    {/* JSX comments do not produce widgets */}
</>
```

`<>...</>` and `<Fragment>` are layout-box fragments, not zero-widget React DOM
fragments. Expressions in containers normally return `ui.Node`. Direct `.map`
calls and `Vec<...>` literals are flattened; use `{...nodes}` for other
`Vec<ui.Node>` expressions. Scalar expressions belong inside `Label` or
`TextLabel`. Conditional `false` / `true` / `null` children produce no widget.
Use explicit stable keys for dynamic/conditional lists when state must persist.

## Generated code and diagnostics

Check JSX and native DevLang types before building:

```sh
sh tools/check/react-devlang.sh path/to/app.devx
```

The check command needs DevLang, but no GTK headers, C linking or running
display. For JSX syntax/props validation using only the DevLang source runtime:

```sh
d packages/react-devlang/tools/devx.dev -- check path/to/app.devx --syntax-only
```

Syntax-only checking validates JSX structure and known component props; it does
not prove expression types or native FFI compatibility.

`tools/build.sh` detects `.devx`, converts the entry and relative `.devx` imports,
then invokes the normal native compiler. Ordinary `.dev` dependencies retain
their canonical module identity unless a JSX dependency requires rewriting.
Generated `.dev` files, source-map manifests and compiler caches stay under the
output directory. Original source files are not rewritten.

Compiler file/line/column diagnostics are mapped back to the original `.devx`
expressions. You can inspect the output explicitly:

```sh
d packages/react-devlang/tools/devx.dev -- emit path/to/app.devx --out-dir build/devx
```

`__rdx_` is reserved for generated identifiers. JSX depth is limited to 100 and
source files to 2 MiB. JSX namespace/package resolution, expression typing and
native FFI remain subject to the documented DevLang/native library limits. This
feature does not implement JavaScript modules, the browser DOM or React JS/npm
package compatibility, and it does not add `.devx` language-server support.
