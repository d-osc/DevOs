# The image carries no Python (DevOs helpers are DevLang): drop the interpreter dependency of this package.
# Its optional Python scripts or bindings are not used by DevOs.
RDEPENDS:${PN}:remove = "python3-core python3"

# Keep the optional Python prototype generator installable without making
# every XFS filesystem user pull an interpreter into the desktop image.
PACKAGES =+ "${PN}-python"
FILES:${PN}-python = "${sbindir}/xfs_protofile ${mandir}/man8/xfs_protofile.8*"
RDEPENDS:${PN}-python = "python3-core"
