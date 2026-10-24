# Hardware profiles

One directory per supported machine (`<vendor>/<model>/`), base profiles per
form factor (`form-factors/`) and a `generic` fallback. `devos-hwprofile`
identifies the running machine, picks the layers and merges them
(generic, then form factor, then model; later wins).

Layout, matching rules, boot integration and how to add a machine:
[docs/hardware-profiles.md](../docs/hardware-profiles.md).

| Profile | Status |
| --- | --- |
| `generic` | fallback |
| `form-factors/laptop`, `desktop`, `convertible` | baseline |
| `asus/ux3407na` | experimental, untested on hardware |

Run `python3 tests/hardware.test.py` after changing anything here.
