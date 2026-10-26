import os, pty, sys, json, base64, select, tty
master, slave = pty.openpty()
tty.setraw(slave)
print(json.dumps({'path': os.ttyname(slave)}), flush=True)
while True:
    ready, _, _ = select.select([sys.stdin, master], [], [], 1)
    if sys.stdin in ready:
        line = sys.stdin.readline()
        if not line:
            break
        command = json.loads(line)
        if command.get('close'):
            break
        os.write(master, base64.b64decode(command['write']))
    if master in ready:
        try:
            data = os.read(master, 65536)
            print(json.dumps({'received': base64.b64encode(data).decode()}), flush=True)
        except OSError:
            pass
os.close(master)
os.close(slave)
