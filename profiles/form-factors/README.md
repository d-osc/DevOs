# form-factors

Base profiles chosen from the detected form factor (`laptop`, `desktop`, `2-in-1`;
`2-in-1` maps to `convertible/`). `unknown` skips this layer. Form factor comes
from DMI `chassis_type`, the device-tree `chassis-type`, a tablet-mode switch
input device, or a battery as a last resort (see `docs/hardware-profiles.md`).
