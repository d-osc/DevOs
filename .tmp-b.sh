cd /mnt/c/Users/ondev/Projects/DevOs
export PATH=$HOME/.local/bin:$PATH
sh busybox-cli/build.sh 2>&1 | tail -8
