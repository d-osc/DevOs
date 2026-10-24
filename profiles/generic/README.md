# generic

Fallback layer applied to every machine, including ones with no profile.
It contains no machine specific drivers. Unknown machines boot with this layer
(plus a form-factor layer when the chassis could be classified) and the boot
log shows `DEVOS HW: unrecognised machine ...`.
