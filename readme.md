## `holepuncher` 🌐

Ever wanted to share a project behind NAT? TCP? UDP? You name it.

⚠️ **By no means this is production ready. Use at your own risk. This is a hobby project.**

### Server

```bash
node a.js TCP_PORT UDP_PORT [PASSWORD]
```

This also starts up an HTTP server at `:8999`.

### Client

```bash
node b.js HOSTNAME TCP_PORT UDP_PORT PASSWORD [tcp/PORT[/NAME]] [udp/PORT[/NAME]]
```

If this command ends immediately, it failed. Make sure the credentials are correct.

### Usage

```bash
node a.js 8888 8888        # this will generate a random password
node a.js 8888 8888 secret # this will set a password

node b.js 111.111.111.111 8888 8888 secret tcp/8000 udp/8001 tcp/8002/cat udp/8003/dog

curl http://111.111.111.111:8999/tcp/8000 # 222.222.222.222:33333
curl http://111.111.111.111:8999/udp/8001 # 222.222.222.222:33334
curl http://111.111.111.111:8999/cat      # 222.222.222.222:33335
curl http://111.111.111.111:8999/dog      # 222.222.222.222:33336
```

### The HTTP server returned an address, but the connection failed.

Most likely your NAT is restricted. Use a VPN instead.

### How does this work?

https://en.wikipedia.org/wiki/Hole_punching_(networking)

### I'm getting empty connections / messages every 15s.

Those are used to keep the port mappings alive.\
Otherwise the address would change every 60 seconds or so.

Please note that UDP does not have the concept of connections.\
Therefore this program maintains its own mappings for UDP sockets.

### Can share SSH?

No. `fail2ban` will fail because your server sees the packets as coming from `::1`.

```
    |------| What's my IP and port?  |------|
    | b.js | ----------------------> | a.js |
    |------|                         |------|

    |------|  222.222.222.222:33333  |------|
    | b.js | <---------------------- | a.js |
    |------|                         |------|

                                         ::1
    |--------|                         |------|                         |----------|
    | server | <---------------------> | b.js | <---------------------> | internet |
    |--------|                         |------|                         |----------|
The thing you want to share.          holepuncher                          anyone
```

### Want to learn more?

Read the source code :)

### License

MIT
