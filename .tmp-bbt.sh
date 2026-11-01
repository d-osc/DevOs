cd /mnt/c/Users/ondev/Projects/DevOs
export PATH=$HOME/.local/bin:$PATH
d tests/busybox-cli.test.dev 2>&1 | cut -c1-900 | head -60
