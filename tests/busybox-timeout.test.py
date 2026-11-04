import subprocess, time, pathlib
b=str(pathlib.Path(__file__).resolve().parents[1] / 'build/busybox-cli/busybox')
cases=[(['true'],0),(['false'],1),(['timeout','-k','1','5','/bin/sh','-c','exit 7'],7),(['timeout','1','sleep','10'],124),(['timeout','-k','1','1','/bin/sh','-c',"trap '' TERM; exec sleep 10"],137),(['timeout','0','/bin/sh','-c','exit 3'],3),(['timeout','--bad'],125),(['timeout','1','/not-existing'],127)]
for args,expected in cases:
 t=time.monotonic(); r=subprocess.run([b]+args,timeout=6); assert r.returncode==expected,(args,r.returncode,expected); print(args, r.returncode,round(time.monotonic()-t,2))
