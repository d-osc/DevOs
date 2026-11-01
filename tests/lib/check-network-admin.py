"""Read real rtnetlink state; mutations run only in a fresh root network namespace."""
import os
from pathlib import Path
import subprocess
import sys

binary = str(Path(sys.argv[1]).resolve())
if "--namespace" in sys.argv:
    assert os.geteuid() == 0, "--namespace requires root"
    for namespace in ("net", "mnt"):
        assert os.readlink(f"/proc/self/ns/{namespace}") != os.readlink(f"/proc/1/ns/{namespace}"), "use unshare -mn"
    assert [line.split(":")[0].strip() for line in Path("/proc/net/dev").read_text().splitlines()[2:]] == ["lo"]
    subprocess.run(["mount", "--make-rprivate", "/"], check=True)
    subprocess.run(["mount", "-t", "sysfs", "sysfs", "/sys"], check=True)


def run(*args, status=0):
    result = subprocess.run([binary, *args], capture_output=True, timeout=8)
    assert result.returncode == status, (args, result)
    return result.stdout.decode()


assert "lo:" in run("ip", "link", "show", "dev", "lo")
run("ip", "addr", "show", "dev", "lo")
assert "lookup local" in run("ip", "rule")
run("ip", "-6", "addr", "show", "dev", "lo")
run("ip", "route")
run("ip", "tunnel")
run("iplink", "show", "dev", "devos-no-such", status=1)
run("ip", "addr", "add", "not-an-address", "dev", "lo", status=1)
if "--namespace" not in sys.argv:
    print("rtnetlink read-only and argument checks passed; mutation checks require --namespace")
    sys.exit(0)
assert os.geteuid() == 0, "--namespace requires root"
assert len(os.listdir("/sys/class/net")) == 1, "mutations require a fresh network namespace with only lo"
oracle = os.environ.get("BUSYBOX_ORACLE", "/home/ondev/devos/busybox-1.38.0/busybox")


def system_ip(*args):
    return subprocess.check_output([oracle, "ip", *args], timeout=8).decode()


run("ip", "link", "set", "lo", "up")
run("ip", "link", "add", "devos0", "type", "dummy")
run("iplink", "set", "devos0", "mtu", "1400", "up")
assert "mtu 1400" in system_ip("link", "show", "dev", "devos0")
run("ipaddr", "add", "192.0.2.1/24", "dev", "devos0")
assert "192.0.2.1/24" in system_ip("addr", "show", "dev", "devos0")
run("ip", "-6", "addr", "add", "2001:db8::1/64", "dev", "devos0")
assert "2001:db8::1/64" in run("ip", "-6", "addr", "show", "dev", "devos0")
run("iproute", "add", "198.51.100.0/24", "via", "192.0.2.2", "dev", "devos0", "metric", "42")
assert "198.51.100.0/24 via 192.0.2.2 dev devos0" in system_ip("route")
run("iprule", "add", "priority", "1234", "from", "192.0.2.0/24", "table", "123")
assert "1234:" in system_ip("rule") and "lookup 123" in system_ip("rule")
run("iprule", "del", "priority", "1234", "from", "192.0.2.0/24", "table", "123")
assert "1234:" not in system_ip("rule")
run("brctl", "addbr", "devbr0")
run("brctl", "addif", "devbr0", "devos0")
assert "devos0" in run("brctl", "show", "devbr0")
run("brctl", "stp", "devbr0", "on")
assert Path("/sys/class/net/devbr0/bridge/stp_state").read_text().strip() == "1"
run("brctl", "setbridgeprio", "devbr0", "32768")
run("brctl", "setpathcost", "devbr0", "devos0", "123")
assert Path("/sys/class/net/devos0/brport/path_cost").read_text().strip() == "123"
run("brctl", "delif", "devbr0", "devos0")
run("brctl", "delbr", "devbr0")
run("vconfig", "set_name_type", "DEV_PLUS_VID_NO_PAD")
run("vconfig", "add", "devos0", "7")
assert "devos0.7" in system_ip("link")
run("vconfig", "set_ingress_map", "devos0.7", "1", "3")
run("vconfig", "set_flag", "devos0.7", "1", "1")
run("vconfig", "rem", "devos0.7")
run("iproute", "del", "198.51.100.0/24", "dev", "devos0")
run("ipaddr", "del", "192.0.2.1/24", "dev", "devos0")
assert "192.0.2.1/24" not in system_ip("addr", "show", "dev", "devos0")
run("iplink", "del", "devos0")
assert not Path("/sys/class/net/devos0").exists()
print("isolated kernel link/address/route/rule/bridge/VLAN mutation checks passed")
