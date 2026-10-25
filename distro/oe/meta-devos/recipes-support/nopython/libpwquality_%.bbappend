# The image carries no Python (DevOs helpers are DevLang): drop the interpreter dependency of this package.
# Its optional Python scripts or bindings are not used by DevOs.
RDEPENDS:${PN}:remove = "python3-core python3"
